const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = resolve(__dirname, '..')
const script = join(root, 'scripts/production-stack.sh')
const config = join(root, 'scripts/check-production-database.cjs')
const http = join(root, 'scripts/check-production-http.cjs')
const run = (command, args, env) =>
  spawnSync(command, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

function fixture(t, scenario = 'success') {
  const dir = mkdtempSync(join(tmpdir(), 'camping-delivery-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, '.artifacts'))
  mkdirSync(join(dir, 'bin'))
  copyFileSync(script, join(dir, 'scripts/production-stack.sh'))
  writeFileSync(
    join(dir, 'bin/aws'),
    `#!/usr/bin/env python3
import os,sys,json
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f: f.write(' '.join(args)+'\\n')
scenario=os.environ['SCENARIO']
if args[1]=='describe-stacks':
 print(json.dumps({'Stacks':[{'StackStatus':'UPDATE_IN_PROGRESS' if scenario=='busy' else 'UPDATE_COMPLETE','Parameters':[{'ParameterKey':'AllowedOrigin','ParameterValue':'https://old.example'},{'ParameterKey':'DatabaseSecretArn','ParameterValue':'arn:aws:secretsmanager:us-east-1:048834125079:secret:camping/production/database-abcdef'},{'ParameterKey':'ReservedConcurrency','ParameterValue':'3'},{'ParameterKey':'FutureParameter','ParameterValue':'keep'}]}]}))
elif args[1]=='wait' and args[2]=='change-set-create-complete' and scenario in ['noop','failed']: sys.exit(1)
elif args[1]=='describe-change-set':
 if scenario in ['noop','failed']:
  print(json.dumps({'Status':'FAILED','StatusReason':"The submitted information didn't contain changes." if scenario=='noop' else 'Access denied'}))
 else:
  print(json.dumps({'Changes':[{'Type':'Resource','ResourceChange':{'Action':'Add' if scenario=='addition' else 'Modify','Replacement':'True' if scenario=='replacement' else 'False'}}]}))
`,
    { mode: 0o755 },
  )
  return {
    dir,
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      CALLS: join(dir, 'calls'),
      SCENARIO: scenario,
      STACK_NAME: 'maytu-production',
      AWS_REGION: 'us-east-1',
      CF_EXECUTION_ROLE_ARN: 'arn:aws:iam::048834125079:role/test',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
    },
  }
}

test('admin URL requires production session pooler and verified TLS without leaking input', () => {
  const valid =
    'postgresql://postgres.xpnleaxbatypnbbwzeku:fake-sensitive-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  const env = {
    DATABASE_ADMIN_URL: valid,
    DATABASE_SSL: 'true',
    NODE_EXTRA_CA_CERTS: join(root, 'api/certs/supabase-ca.crt'),
  }
  assert.equal(run(process.execPath, [config], env).status, 0)
  for (const url of [
    '',
    valid.replace('5432', '6543'),
    valid.replace('xpnleaxbatypnbbwzeku', 'other'),
    `${valid}?sslmode=no-verify`,
    valid.replace('pooler.supabase.com', 'evil.example'),
  ]) {
    const result = run(process.execPath, [config], {
      ...env,
      DATABASE_ADMIN_URL: url,
    })
    assert.equal(result.status, 1)
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /fake-sensitive-password/,
    )
  }
  assert.equal(
    run(process.execPath, [config], { ...env, DATABASE_SSL: 'false' }).status,
    1,
  )
})

test('prepare retains every existing parameter except canonical origin', (t) => {
  const { dir, env } = fixture(t)
  assert.equal(
    run('bash', [join(dir, 'scripts/production-stack.sh'), 'prepare'], env)
      .status,
    0,
  )
  const parameters = JSON.parse(
    readFileSync(join(dir, '.artifacts/production-parameters.json')),
  )
  assert.deepEqual(parameters[0], {
    ParameterKey: 'AllowedOrigin',
    ParameterValue: 'https://www.maytu.app',
  })
  assert.deepEqual(
    parameters.slice(1).map((p) => [p.ParameterKey, p.UsePreviousValue]),
    [
      ['DatabaseSecretArn', true],
      ['ReservedConcurrency', true],
      ['FutureParameter', true],
    ],
  )
})

test('busy stack blocks before migrations/deployment', (t) => {
  const { dir, env } = fixture(t, 'busy')
  assert.notEqual(
    run('bash', [join(dir, 'scripts/production-stack.sh'), 'prepare'], env)
      .status,
    0,
  )
})

for (const scenario of [
  'success',
  'noop',
  'failed',
  'addition',
  'replacement',
]) {
  test(`change set: ${scenario}`, (t) => {
    const { dir, env } = fixture(t, scenario)
    const result = run(
      'bash',
      [join(dir, 'scripts/production-stack.sh'), 'deploy'],
      env,
    )
    assert.equal(
      result.status === 0,
      ['success', 'noop'].includes(scenario),
      result.stderr,
    )
    const calls = readFileSync(env.CALLS, 'utf8')
    assert.equal(calls.includes('execute-change-set'), scenario === 'success')
    assert.equal(
      calls.includes('stack-update-complete'),
      scenario === 'success',
    )
  })
}

test('HTTP verification checks read-only session/CORS and rejects foreign mutation', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'camping-http-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const preload = join(dir, 'fetch.cjs')
  writeFileSync(
    preload,
    `
    const assert = require('node:assert/strict');
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push([url, options.method ?? 'GET', options.headers.Origin]);
      if (options.headers.Origin === 'https://foreign.example') {
        assert.equal(options.method, 'POST');
        assert.ok(url.endsWith('/auth/logout'));
        return new Response(JSON.stringify({code:'ORIGIN_NOT_ALLOWED'}), {status:403});
      }
      const headers = {'access-control-allow-origin':'https://www.maytu.app', 'access-control-allow-credentials':'true'};
      return options.method === 'OPTIONS' ? new Response(null,{status:204,headers}) : new Response(JSON.stringify({code:'UNAUTHORIZED'}),{status:401,headers});
    };
    process.on('exit', () => assert.equal(calls.length,3));
  `,
  )
  const result = run(process.execPath, [
    '--require',
    preload,
    http,
    'https://abc123.execute-api.us-east-1.amazonaws.com/api',
  ])
  assert.equal(result.status, 0, result.stderr)
})
