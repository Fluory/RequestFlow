#!/usr/bin/env bash
# =============================================================================
# Stop check – fluory-system (Stop hook)
# Template: Entwicklungsplan/templates/base/.claude/hooks/stop-check.sh
#
# Stops a session exactly ONCE when unsaved work exists at the end (SYSTEM.md §6, rules 4 + 5):
# uncommitted files, unpushed commits, a branch without upstream, a branch without an open PR
# (only checkable when `gh` is installed and logged in). Claude then has to save – or tell the
# human in the chat why not. On the second stop (stop_hook_active = true) the hook lets the
# session end: no endless loop. Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================

PROTECTED="${FLUORY_PROTECTED_BRANCHES:-main master}"
INPUT="$(cat 2>/dev/null || true)"

json_get() { # $1 = path like .cwd
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
is_protected() { local b; for b in $PROTECTED; do [ "$1" = "$b" ] && return 0; done; return 1; }
gh_cmd() { if command -v timeout >/dev/null 2>&1; then timeout 8 gh "$@"; else gh "$@"; fi; }

[ "$(json_get .stop_hook_active)" = "true" ] && exit 0   # second stop: let the session end

cwd="$(json_get .cwd)"
if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="${CLAUDE_PROJECT_DIR:-$PWD}"; fi
cd "$cwd" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
findings=""
add() { findings="${findings}- $1"$'\n'; }

dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
[ "${dirty:-0}" -gt 0 ] && add "$dirty uncommitted/untracked file(s) – git status"

if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
    [ "${ahead:-0}" -gt 0 ] && add "$ahead unpushed commit(s) on '$branch'"
    if ! is_protected "$branch" && command -v gh >/dev/null 2>&1; then
      n="$(gh_cmd pr list --head "$branch" --state open --json number --jq 'length' 2>/dev/null || true)"
      [ "$n" = "0" ] && add "no open PR for '$branch' – open a draft PR (rule 5)"
    fi
  elif ! is_protected "$branch" && git rev-parse --verify -q HEAD >/dev/null 2>&1; then
    add "branch '$branch' has no upstream – never pushed (git push -u origin $branch)"
  fi
fi

[ -z "$findings" ] && exit 0

{
  echo "[fluory-system stop check] Unsaved work – SYSTEM.md rules 4/5:"
  printf '%s' "$findings"
  if is_protected "$branch"; then
    echo "You are on '$branch': create the branch claude/<type>-<topic>-<issue-nr> first, then save there."
  fi
  echo "Now: commit + push + update the PR description (Arbeitsstand, plain-language section) – /finish-work."
  echo "If this deliberately should NOT happen (read-only session, someone else's local changes), tell the human in the chat in one sentence what stays unsaved and why – then end."
} >&2
exit 2
