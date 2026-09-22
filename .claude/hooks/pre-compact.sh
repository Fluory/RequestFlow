#!/usr/bin/env bash
# =============================================================================
# Compaction snapshot – fluory-system (PreCompact hook: manual and auto)
# Template: Entwicklungsplan/templates/base/.claude/hooks/pre-compact.sh
#
# Before every context compaction this hook writes a small, local, ephemeral snapshot of the
# work state OUTSIDE the repository (SYSTEM.md §6): session id, branch, draft PR, issue, changed
# files, affected tests, last verify result, the PR section "Arbeitsstand" and the agent's last
# message – all verbatim from git, gh and the transcript; missing information is marked unknown,
# nothing is inferred. No file contents; secrets are redacted. session-start.sh replays the snapshot after the
# compaction. The snapshot is neither a handover document nor project knowledge and is never
# committed – handover lives in the draft PR (section "Arbeitsstand").
#
# Location: ${FLUORY_STATE_DIR:-$HOME/.claude/fluory-state}/<repo-key>/snapshot-<session>.md
# Snapshots older than 14 days are removed. Never blocks a compaction: always exit 0.
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
INPUT="$(cat 2>/dev/null || true)"

json_get() { # $1 = path like .trigger
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
last_note() { # $1 = transcript (jsonl) → last assistant text, max. 700 characters
  [ -f "$1" ] || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY' 2>/dev/null
import json, sys
last = ''
for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
    try:
        o = json.loads(line)
    except Exception:
        continue
    if o.get('type') != 'assistant':
        continue
    c = (o.get('message') or {}).get('content')
    if isinstance(c, str):
        t = c
    elif isinstance(c, list):
        t = '\n'.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
    else:
        continue
    if t.strip():
        last = t
print(last.strip()[-700:])
PY
  elif command -v jq >/dev/null 2>&1; then
    jq -R -r 'fromjson? | select(.type=="assistant") | (.message // {}).content | if type=="string" then . elif type=="array" then (map(select(.type=="text") | .text) | join("\n")) else empty end' "$1" 2>/dev/null | awk 'NF' | tail -n 8 | tail -c 700
  elif command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs"); let last = "";
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
  let o; try { o = JSON.parse(line); } catch (e) { continue; }
  if (o.type !== "assistant") continue;
  const c = (o.message || {}).content; let t = "";
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) t = c.filter(b => b && b.type === "text").map(b => b.text || "").join("\n");
  else continue;
  if (t.trim()) last = t;
}
process.stdout.write(last.trim().slice(-700));' "$1" 2>/dev/null
  fi
}
redact() { # secrets never enter the snapshot – not even through the agent's own notes
  local kw='([Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww]([Oo][Rr])?[Dd]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Bb][Ee][Aa][Rr][Ee][Rr])'
  sed -E \
    -e 's/(-----BEGIN [A-Z ]*PRIVATE KEY-----).*/\1 [redacted]/' \
    -e 's/(^|[^A-Za-z0-9])(AKIA|ASIA)[0-9A-Z]{16}/\1[redacted]/g' \
    -e 's/(^|[^A-Za-z0-9])(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/\1[redacted]/g' \
    -e 's/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/\1[redacted]/g' \
    -e 's/(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/\1[redacted]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[redacted]/g' \
    -e "s/(${kw}[A-Za-z0-9_-]*[[:space:]]*[=:][[:space:]]*)[^[:space:]]+/\\1[redacted]/g"
}
gh_cmd() { if command -v timeout >/dev/null 2>&1; then timeout 8 gh "$@"; else gh "$@"; fi; }

have_json_tool || exit 0
sid="$(json_get .session_id)";        [ -n "$sid" ] || sid="unknown"
trigger="$(json_get .trigger)";       [ -n "$trigger" ] || trigger="unknown"
custom="$(json_get .custom_instructions)"
transcript="$(json_get .transcript_path)"
cwd="$(json_get .cwd)"
{ [ -n "$cwd" ] && [ -d "$cwd" ]; } || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || exit 0

STATE="${FLUORY_STATE_DIR:-$HOME/.claude/fluory-state}"
key="$(printf '%s' "$root" | sed 's#[^A-Za-z0-9._-]#_#g')"
dir="$STATE/$key"
mkdir -p "$dir" 2>/dev/null || exit 0
find "$dir" -type f -mtime +14 -delete 2>/dev/null
snap="$dir/snapshot-$sid.md"
count_file="$dir/compactions-$sid"
n=0; [ -f "$count_file" ] && n="$(tr -dc '0-9' < "$count_file")"; n=$(( ${n:-0} + 1 )); printf '%s\n' "$n" > "$count_file"

branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
issue="$(printf '%s' "$branch" | sed -nE 's/.*-([0-9]+)$/#\1/p')"; [ -n "$issue" ] || issue="(no issue number in the branch name)"
up="$(git -C "$root" rev-parse --abbrev-ref '@{u}' 2>/dev/null || true)"
if [ -n "$up" ]; then
  ahead="$(git -C "$root" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  behind="$(git -C "$root" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
  sync="upstream $up · $ahead ahead · $behind behind"
else
  sync="no upstream – never pushed"
fi
last="$(git -C "$root" log -1 --format='%h %s' 2>/dev/null || echo '(no commits)')"
dirty="$(git -C "$root" status --porcelain 2>/dev/null | head -40)"
ndirty="$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
changed="$( { git -C "$root" diff --name-only HEAD 2>/dev/null; git -C "$root" ls-files --others --exclude-standard 2>/dev/null; [ -n "$up" ] && git -C "$root" diff --name-only "$up...HEAD" 2>/dev/null; } | awk 'NF' | sort -u | head -60)"
tests="$(printf '%s\n' "$changed" | grep -E '(^|/)(tests?|__tests__|e2e|spec)/|\.(test|spec)\.[A-Za-z]+$|_test\.(go|py|rs)$' || true)"
pr="unknown (gh not available)"
if command -v gh >/dev/null 2>&1; then
  pr="$(gh_cmd pr list --head "$branch" --state open --json number,isDraft,url --jq '.[] | "#\(.number)\(if .isDraft then " (draft)" else "" end) \(.url)"' 2>/dev/null | head -1)"
  [ -n "$pr" ] || pr="none open for $branch – open a draft PR (SYSTEM.md §6)"
fi
verify="(none recorded – run verify:changed or verify through scripts/quiet-run.sh)"
[ -f "$dir/last-verify.txt" ] && verify="$(head -6 "$dir/last-verify.txt")"
note="$(last_note "$transcript")"; [ -n "$note" ] || note="unknown (no transcript available)"
prstate="unknown (gh not available)"
if command -v gh >/dev/null 2>&1; then
  prstate="$(gh_cmd pr view --json body -q .body 2>/dev/null | awk '/^## Arbeitsstand/{f=1; next} /^## /{f=0} f' | awk 'NF' | head -12)"
  [ -n "$prstate" ] || prstate="unknown (no open PR for this branch or no Arbeitsstand section)"
fi

{
  echo "# Work snapshot · fluory-system"
  echo "- Written: $(date '+%Y-%m-%d %H:%M:%S') · trigger: $trigger · compaction no. $n in this session"
  echo "- Session-ID: $sid"
  echo "- Repo: $root"
  echo "- Branch: $branch · $sync · last commit: $last"
  echo "- Draft-PR: $pr"
  echo "- Issue: $issue"
  echo "- Uncommitted: $ndirty file(s)"
  [ -n "$dirty" ] && printf '%s\n' "$dirty" | sed 's/^/    /'
  echo "- Changed files (working tree and commits ahead of upstream):"
  if [ -n "$changed" ]; then printf '%s\n' "$changed" | sed 's/^/    /'; else echo "    (none)"; fi
  echo "- Affected tests (by path):"
  if [ -n "$tests" ]; then printf '%s\n' "$tests" | sed 's/^/    /'; else echo "    (none among the changed files – pick the focused test for the touched module)"; fi
  echo "- Last verify result (scripts/quiet-run.sh):"
  printf '%s\n' "$verify" | sed 's/^/    /'
  echo "- Compaction instructions given: ${custom:-(none)}"
  echo "- Draft PR section \"Arbeitsstand\" (verbatim – the only durable source for goal, open items and next step):"
  printf '%s\n' "$prstate" | sed 's/^/    /'
  echo "- Last message of the agent before the compaction (verbatim from the transcript, not interpreted):"
  printf '%s\n' "$note" | sed 's/^/    /'
  echo "- Hypothesis, risk and next smallest step: nothing is inferred here. If the two sources above do not state them, they are unknown – re-orient from issue → PR → diff → tests before editing (SYSTEM.md §6)."
} | redact > "$snap"
echo "[fluory-system] compaction snapshot written: $snap"
exit 0
