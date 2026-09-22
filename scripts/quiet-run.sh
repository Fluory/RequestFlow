#!/usr/bin/env bash
# =============================================================================
# quiet-run – fluory-system output filter for test and verify runs (SYSTEM.md §11)
# Template: Entwicklungsplan/templates/base/scripts/quiet-run.sh
#
# Runs a command, trims SUCCESS output to a header and the summary, keeps FAILURE output
# (test names, error, diff, context, last lines), never changes the exit code, and records the
# result for the compaction snapshot (pre-compact.sh). The full log is always kept as a file.
#   scripts/quiet-run.sh pnpm verify:changed
#   FLUORY_FULL_OUTPUT=1 scripts/quiet-run.sh pnpm verify     # once, when the cause is unclear
# The hook .claude/hooks/filter-test-output.sh routes unambiguous test commands through this
# script automatically. Knobs: FLUORY_QUIET_TAIL=15 FLUORY_QUIET_MAX=200 FLUORY_STATE_DIR
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
cmd="$*"
[ -n "$cmd" ] || { echo "usage: scripts/quiet-run.sh <command …>" >&2; exit 64; }
TAIL="${FLUORY_QUIET_TAIL:-15}"; MAX="${FLUORY_QUIET_MAX:-200}"

STATE="${FLUORY_STATE_DIR:-$HOME/.claude/fluory-state}"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
key="$(printf '%s' "$root" | sed 's#[^A-Za-z0-9._-]#_#g')"
dir="$STATE/$key"
mkdir -p "$dir" 2>/dev/null || dir="$(mktemp -d)"
find "$dir" -type f -name 'quiet-run-*.log' -mtime +2 -delete 2>/dev/null
log="$dir/quiet-run-$(date +%Y%m%d-%H%M%S)-$$.log"

record() { # $1 = exit code – last result for the compaction snapshot
  {
    echo "$(date '+%Y-%m-%d %H:%M:%S') · exit $1 · $cmd"
    [ -f "$log" ] && awk 'NF' "$log" | tail -n 3
  } > "$dir/last-verify.txt" 2>/dev/null
}

if [ "${FLUORY_FULL_OUTPUT:-0}" = "1" ]; then
  bash -c "$cmd" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  record "$rc"
  exit "$rc"
fi

bash -c "$cmd" > "$log" 2>&1
rc=$?
total="$(wc -l < "$log" | tr -d ' ')"
if [ "$rc" -eq 0 ]; then
  echo "[quiet-run] OK · exit 0 · $cmd · $total lines (full log: $log)"
  if [ "$total" -le $((TAIL * 2)) ]; then cat "$log"; else echo "…"; tail -n "$TAIL" "$log"; fi
else
  echo "[quiet-run] FAILED · exit $rc · $cmd · $total lines (full log: $log)"
  if [ "$total" -le "$MAX" ]; then
    cat "$log"
  else
    echo "[quiet-run] relevant lines (pattern match with context, capped at $MAX):"
    grep -n -E -B2 -A8 '(FAIL|✗|✘|×|Error|error:|Exception|Assertion|expected|Expected|received|Received|Traceback|panic:|failed|not ok|Cannot |Unhandled|TypeError|ReferenceError)' "$log" | head -n "$MAX"
    echo "[quiet-run] last 30 lines:"
    tail -n 30 "$log"
  fi
fi
record "$rc"
exit "$rc"
