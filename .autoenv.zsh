autostash ns
autostash MAYTU_NS_ROOT="${autoenv_env_file:A:h}"
unalias ns 2>/dev/null || true

function ns() (
  cd -q -- "$MAYTU_NS_ROOT" && pnpm db:up && pnpm db:migrate && pnpm dev "$@"
)
