#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${STACK_NAME:?}" "${CF_EXECUTION_ROLE_ARN:?}"
[[ "$STACK_NAME" == maytu-production && "${AWS_REGION:?}" == us-east-1 ]]
[[ "$CF_EXECUTION_ROLE_ARN" == arn:aws:iam::048834125079:role/* ]]
mkdir -p .artifacts

snapshot() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" > .artifacts/stack.json
}

case "${1:?prepare, deploy or verify}" in
  prepare)
    snapshot
    jq -e '.Stacks | length == 1' .artifacts/stack.json > /dev/null
    jq -e '.Stacks[0].StackStatus | IN("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE")' .artifacts/stack.json > /dev/null
    jq -e '.Stacks[0].Parameters | any(.ParameterKey == "DatabaseSecretArn" and (.ParameterValue | startswith("arn:aws:secretsmanager:us-east-1:048834125079:secret:")))' .artifacts/stack.json > /dev/null
    # UsePreviousValue preserves all existing parameters, including future ones.
    jq '[.Stacks[0].Parameters[] | if .ParameterKey == "AllowedOrigin" then {ParameterKey, ParameterValue: "https://www.maytu.app"} else {ParameterKey, UsePreviousValue: true} end]' .artifacts/stack.json > .artifacts/production-parameters.json
    jq -e 'any(.ParameterKey == "AllowedOrigin")' .artifacts/production-parameters.json > /dev/null
    ;;
  deploy)
    change_set="github-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
    aws cloudformation create-change-set --stack-name "$STACK_NAME" \
      --change-set-name "$change_set" --change-set-type UPDATE \
      --template-body file://.artifacts/production.yaml \
      --parameters file://.artifacts/production-parameters.json \
      --role-arn "$CF_EXECUTION_ROLE_ARN" \
      --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND > /dev/null
    if ! aws cloudformation wait change-set-create-complete --stack-name "$STACK_NAME" --change-set-name "$change_set"; then
      aws cloudformation describe-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set" > .artifacts/change-set.json
      if jq -e '.Status == "FAILED" and (.StatusReason | test("didn.t contain changes|No updates are to be performed"))' .artifacts/change-set.json > /dev/null; then
        echo 'No infrastructure changes; stack and HTTP checks still required.'
        exit 0
      fi
      echo 'Change set creation failed; inspect CloudFormation events.' >&2
      exit 1
    fi
    # This pipeline updates existing resources only. Replacements/additions/deletions
    # need a reviewed infrastructure change and revised bootstrap permissions.
    aws cloudformation describe-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set" > .artifacts/change-set.json
    jq -e 'all(.Changes[]; .Type == "Resource" and .ResourceChange.Action == "Modify" and .ResourceChange.Replacement == "False")' .artifacts/change-set.json > /dev/null
    aws cloudformation execute-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set"
    aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME"
    ;;
  verify)
    snapshot
    jq -e '.Stacks[0].StackStatus | IN("CREATE_COMPLETE", "UPDATE_COMPLETE")' .artifacts/stack.json > /dev/null
    jq -e '.Stacks[0].Parameters | any(.ParameterKey == "AllowedOrigin" and .ParameterValue == "https://www.maytu.app")' .artifacts/stack.json > /dev/null
    api_url=$(jq -er '.Stacks[0].Outputs[] | select(.OutputKey == "ApiUrl") | .OutputValue' .artifacts/stack.json)
    node scripts/check-production-http.cjs "$api_url"
    ;;
  *) exit 2 ;;
esac
