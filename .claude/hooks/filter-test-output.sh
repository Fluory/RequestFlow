#!/usr/bin/env bash
# =============================================================================
# Test-output filter – fluory-system (PreToolUse hook, matcher: Bash)
# Template: Entwicklungsplan/templates/base/.claude/hooks/filter-test-output.sh
#
# Routes UNAMBIGUOUS test/verify commands (npm|pnpm|yarn|bun test/verify*, vitest, jest, mocha,
# playwright test, cypress run, pytest -- also behind the Python runners uv|poetry|pdm|hatch|rye,
# go test, cargo test, make/just test|verify) through
# scripts/quiet-run.sh, which trims success output, keeps failures and preserves the exit code
# (SYSTEM.md §11). The command itself is executed unchanged inside the wrapper.
# Suite policy (§11): an UNSCOPED suite run (npm test without a path, vitest/jest/pytest without
# file or filter, playwright test without a spec, go test ./..., cargo test) is
#   - P0 (stage experiment or unknown): allowed, rewritten, with a hint as additional context
#   - P1/P2 (stage internal|production): BLOCKED (exit 2) – run the affected tests, verify:changed,
#     verify or verify:full; deliberate full run once: prefix FLUORY_FULL_SUITE=1, reason in the PR.
#   The policy also applies to commands already wrapped in quiet-run.sh (no bypass via the wrapper).
# Never rewritten: commands with FLUORY_FULL_OUTPUT=1, chains (&&, ||, ;, |), redirections,
# subshells, multi-line commands, anything already wrapped, or when quiet-run.sh is missing.
# Output: JSON with updatedInput (docs: hooks reference, PreToolUse). Fail open: exit 0.
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
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
emit() { # $1 = wrapped command, $2 = additional context (optional) → JSON with tool_input + {command}
  local reason="fluory-system: test output filtered by scripts/quiet-run.sh (exit code preserved; prefix FLUORY_FULL_OUTPUT=1 for the full output)"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq --arg c "$1" --arg r "$reason" --arg x "${2:-}" '{hookSpecificOutput: ({hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: $r, updatedInput: (.tool_input + {command: $c})} + (if $x == "" then {} else {additionalContext: $x} end))}'
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$INPUT" | python3 -c '
import json, sys
d = json.load(sys.stdin); ti = dict(d.get("tool_input") or {}); ti["command"] = sys.argv[1]
o = {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": sys.argv[2], "updatedInput": ti}
if sys.argv[3]: o["additionalContext"] = sys.argv[3]
print(json.dumps({"hookSpecificOutput": o}, indent=2))
' "$1" "$reason" "${2:-}"
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$INPUT" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const d = JSON.parse(s); const ti = Object.assign({}, d.tool_input || {}); ti.command = process.argv[1];
  const o = {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: process.argv[2], updatedInput: ti};
  if (process.argv[3]) o.additionalContext = process.argv[3];
  console.log(JSON.stringify({hookSpecificOutput: o}, null, 2)); });' "$1" "$reason" "${2:-}"
  fi
}
block_suite() {
  {
    echo "[fluory-system test filter] BLOCKED: unscoped suite run in a P1/P2 project: $1"
    echo "Rule (SYSTEM.md §11): locally the agent works focused – run the affected tests (path, -k or spec), verify:changed, or the canonical verify / verify:full. Deliberate full run once: prefix FLUORY_FULL_SUITE=1 and name the reason in the PR."
  } >&2
  exit 2
}

have_json_tool || exit 0
cmd="$(json_get .tool_input.command)"
[ -n "$cmd" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-}"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$(json_get .cwd)"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$PWD"
qr=""
for c in "$root/scripts/quiet-run.sh" "$root/templates/base/scripts/quiet-run.sh"; do
  [ -f "$c" ] && { qr="$c"; break; }
done
[ -n "$qr" ] || exit 0

# exceptions: full output requested, chains, pipes, redirections, subshells, newlines
case "$cmd" in *FLUORY_FULL_OUTPUT=*) exit 0 ;; esac
case "$cmd" in *'&&'*|*'||'*|*';'*|*'|'*|*'>'*|*'<'*|*'`'*|*'$('*|*$'\n'*) exit 0 ;; esac

# already wrapped: never rewrite, but the suite policy still applies to the inner command
wrapped=0; m="$cmd"
case "$cmd" in
  *quiet-run.sh*) wrapped=1; m="$(printf '%s' "$cmd" | sed -E "s/^.*quiet-run\.sh[\"']?[[:space:]]+//; s/^[\"']//; s/[\"']\$//")" ;;
esac
m="$(printf '%s' "$m" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)+//')"   # env prefixes stay in the executed command

runner='^((pnpm|npm|yarn|bun)( run)? (test|verify)(:[a-z-]+)?( --)?( [^ ]+)*|(npx |pnpm exec |pnpm dlx |yarn )?(vitest|jest|mocha|playwright test|cypress run)( [^ ]+)*|(uv run |poetry run |pdm run |hatch run |rye run )?(python3? -m )?pytest( [^ ]+)*|go test( [^ ]+)*|cargo test( [^ ]+)*|(make|just) (test|verify)([:-][a-z-]+)?( [^ ]+)*)$'
printf '%s' "$m" | grep -qE "$runner" || exit 0

flags='( --| --?[A-Za-z-]+(=[^ ]+)?)*$'
broad=0
case "$m" in
  *verify*) ;;   # verify:changed / verify / verify:full are the canonical, scoped-by-design commands
  *)
    if   printf '%s' "$m" | grep -qE "^(pnpm|npm|yarn|bun)( run)? test$flags"; then broad=1
    elif printf '%s' "$m" | grep -qE "^(npx |pnpm exec |pnpm dlx |yarn )?(vitest|jest|mocha)( run)?$flags"; then broad=1
    elif printf '%s' "$m" | grep -qE "^(npx |pnpm exec |pnpm dlx |yarn )?(playwright test|cypress run)$flags"; then broad=1
    elif printf '%s' "$m" | grep -qE "^(uv run |poetry run |pdm run |hatch run |rye run )?(python3? -m )?pytest$flags"; then broad=1
    elif printf '%s' "$m" | grep -qE '^go test( -[a-z]+)*( \./\.\.\.)?$'; then broad=1
    elif printf '%s' "$m" | grep -qE "^cargo test$flags"; then broad=1
    fi ;;
esac
stage="$(sed -n 's/^[[:space:]]*stage:[[:space:]]*\([a-z]*\).*/\1/p' "$root/project-profile.yml" 2>/dev/null | head -1)"
if [ "$broad" -eq 1 ] && { [ "$stage" = "internal" ] || [ "$stage" = "production" ]; }; then
  case "$cmd" in *FLUORY_FULL_SUITE=1*) ;; *) block_suite "$cmd" ;; esac
fi
[ "$wrapped" -eq 1 ] && exit 0

ctx=""
[ "$broad" -eq 1 ] && ctx="fluory-system: unscoped suite run (allowed in P0) – prefer verify:changed or the affected test file; in P1/P2 this is blocked (SYSTEM.md §11)."
quoted="$(printf '%s' "$cmd" | sed "s/'/'\\\\''/g")"
emit "bash \"$qr\" '$quoted'" "$ctx"
exit 0
