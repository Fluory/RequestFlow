#!/usr/bin/env bash
# =============================================================================
# Checkpoint guard – fluory-system (PreToolUse hook, matcher: Bash)
# Template: Entwicklungsplan/templates/base/.claude/hooks/guard-checkpoint.sh
#
# Risky operations need a git reset point first (SYSTEM.md §4): data migrations, generator
# runs, dependency upgrades, mass file operations (git mv, find -exec, sed -i over globs, rm -r,
# codemods, formatters over directories or the whole tree – a single file is not a mass
# operation) and commands that discard changes (git reset --hard, checkout or restore of the
# tree, clean, stash drop). Chains, pipes, subshells, env prefixes, wrappers (bash -c, eval, xargs)
# and multi-line commands are unwrapped; xargs feeding sed -i, rm, mv or a formatter is a mass
# operation. With uncommitted changes in the working tree such a call is blocked (exit 2) until
# a checkpoint exists:
#   git add -A && git commit -m "chore: checkpoint before <operation>"   (push if the work matters)
# /rewind is no substitute: it restores neither Bash, generator, database nor subagent changes.
# Deliberate exception for one call: prefix FLUORY_NO_CHECKPOINT=1 and name the reason in the PR.
# Fail open without jq/python3/node. Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
set -f
INPUT="$(cat 2>/dev/null || true)"

json_get() { # $1 = path like .tool_input.command
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$INPUT" | python3 -c '
import json, sys
keys = [k for k in sys.argv[1].split(".") if k]
try:
    v = json.load(sys.stdin)
    for k in keys:
        v = v[k]
except Exception:
    sys.exit(0)
if isinstance(v, bool):
    print("true" if v else "false")
elif v is not None:
    print(v)
' "$1" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$INPUT" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  try { let v = JSON.parse(s); for (const k of process.argv[1].split(".").filter(Boolean)) v = v[k];
        if (v !== undefined && v !== null) console.log(String(v)); } catch (e) {} });' "$1" 2>/dev/null
  fi
}
have_json_tool() {
  command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || command -v node >/dev/null 2>&1
}
strip_heredocs() { # heredoc bodies (<<EOF … EOF) are data, not commands – never scan them
  awk '
    hd != "" { if ($0 ~ ("^[[:space:]]*" hd "[[:space:]]*$")) hd = ""; next }
    {
      if (match($0, /<<-?[[:space:]]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
        tag = substr($0, RSTART, RLENGTH); sub(/^<<-?[[:space:]]*/, "", tag); gsub(/["\047]/, "", tag); hd = tag
      }
      print
    }'
}
block() {
  {
    echo "[fluory-system checkpoint guard] BLOCKED: $1"
    echo "$2"
    echo "Way out: git add -A && git commit -m \"chore: checkpoint before <operation>\" (push if the work matters), then run the command again. Deliberate exception for this one call: prefix FLUORY_NO_CHECKPOINT=1 and name the reason in the PR. /rewind is no substitute for git (SYSTEM.md §4)."
  } >&2
  exit 2
}

have_json_tool || exit 0
cmd="$(json_get .tool_input.command)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *FLUORY_NO_CHECKPOINT=1*) exit 0 ;; esac

cwd="$(json_get .cwd)"
{ [ -n "$cwd" ] && [ -d "$cwd" ]; } || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

segments="$(printf '%s\n' "$cmd" | strip_heredocs | awk '{ gsub(/&&|\|\||;|\||\$\(|`/, "\n"); print }')"
risky=""; what=""
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -n "$seg" ] || continue
  s="$seg"; via_xargs=0
  for _ in 1 2; do   # two passes: bash -c "npx prisma …", eval "…", $(…), env prefixes, wrappers
    s="${s#\$(}"; s="${s#\`}"; s="${s#(}"; s="${s#\"}"; s="${s#\'}"; s="${s%\"}"; s="${s%\'}"; s="${s%)}"; s="${s%\`}"
    s="$(printf '%s' "$s" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)+//')"
    case "$s" in xargs\ *) via_xargs=1 ;; esac
    s="$(printf '%s' "$s" | sed -E 's/^((command|sudo|exec|time|nohup|env|builtin|eval|xargs|bash|sh|zsh|dash|ksh|npx|bunx|pnpm exec|pnpm dlx|yarn dlx|yarn exec|poetry run|pipenv run|uv run|bundle exec|python3? -m)( -[A-Za-z0-9=.,_-]+)* +)+//')"
  done
  if [ "$via_xargs" -eq 1 ] && printf '%s' "$s" | grep -qE '^(sed -i|perl -[a-zA-Z]*i|rm |mv |git mv|prettier --write|eslint --fix|black|ruff format|gofmt -w)'; then
    risky=1; what="mass file operation via xargs"
  elif printf '%s' "$s" | grep -qE '^(prisma (migrate|db push|db execute|generate)|alembic (upgrade|downgrade)|knex migrate|typeorm migration:(run|revert)|drizzle-kit (push|migrate|generate)|supabase db (push|reset)|rails (db:migrate|db:reset|generate|g) |flyway (migrate|clean)|liquibase (update|rollback)|dotnet ef database update|php artisan migrate|sequelize db:migrate|django-admin migrate|manage\.py migrate)'; then
    risky=1; what="migration or generator run"
  elif printf '%s' "$s" | grep -qE '^(openapi-generator|graphql-codegen|swagger-codegen|protoc |codegen|orval|kubb|nx g |ng (generate|g) |yo |hygen |plop)'; then
    risky=1; what="code generator run"
  elif printf '%s' "$s" | grep -qE '^(npm (update|upgrade)|pnpm (up|update|upgrade)|yarn (upgrade|up)|pip install .*(-U|--upgrade)|poetry update|cargo update|bundle update|go get -u|ncu -u|npm-check-updates -u|composer update)'; then
    risky=1; what="dependency upgrade"
  elif printf '%s' "$s" | grep -qE '^(git mv |find .* -exec |find .* -delete|sed -i[^ ]* .*(\*|\$\(|`)|rm -[A-Za-z]*[rR]|jscodeshift|codemod|(prettier --write|eslint --fix)( -[^ ]+)* (\.|[^ ]*\*[^ ]*|[^ .]+)( |$)|black( -[^ ]+)* \.|ruff format( -[^ ]+)*( \.| [^ .]+|$)|gofmt -w( \.| [^ .]+)|cargo fmt|rustfmt$)'; then
    risky=1; what="mass file operation"
  elif printf '%s' "$s" | grep -qE '^git (reset --hard|checkout -- |checkout \.|restore( --staged)? \.|restore( --staged)? -- |clean -[a-zA-Z]*f|stash (drop|clear))'; then
    risky=1; what="discarding changes"
  fi
  [ -n "$risky" ] && break
done <<< "$segments"
[ -n "$risky" ] || exit 0

git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
dirty="$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
[ "${dirty:-0}" -gt 0 ] || exit 0
block "$what with $dirty uncommitted file(s): $cmd" \
  "Rule (SYSTEM.md §4): before a data migration, generator run, dependency upgrade, mass file operation or discarding changes a git checkpoint must exist – a clean commit, a clear stash or a documented baseline commit."
