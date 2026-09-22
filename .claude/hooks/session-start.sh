#!/usr/bin/env bash
# =============================================================================
# Session card – fluory-system (SessionStart hook: startup, resume, clear, compact)
# Template: Entwicklungsplan/templates/base/.claude/hooks/session-start.sh
#
# Prints the rule context into the session at every start, resume and AFTER EVERY CONTEXT
# COMPACTION (stdout → context): repo/branch, safety state, profile version, size of the
# mandatory reading, guard status, open PRs and the short rules from AGENTS.md (section
# "## Rules (short form)"; "## Regeln (Kurzfassung)" is still accepted). After a compaction or
# resume it replays the local work snapshot written by pre-compact.sh and, from the second
# compaction on, the checkpoint questions (SYSTEM.md §6). In the control center additionally:
# drift-check summary and age of the portfolio state. Runs in seconds, changes nothing.
# =============================================================================

PROTECTED="${FLUORY_PROTECTED_BRANCHES:-main master}"
INPUT="$(cat 2>/dev/null || true)"

json_get() { # $1 = path like .source
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
is_protected() { local b; for b in $PROTECTED; do [ "$1" = "$b" ] && return 0; done; return 1; }
lines() { wc -l < "$1" | tr -d ' '; }
days_since() { # $1 = YYYY-MM-DD
  local t
  t=$(date -d "$1" +%s 2>/dev/null || date -j -f '%Y-%m-%d' "$1" +%s 2>/dev/null) || return 1
  echo $(( ( $(date +%s) - t ) / 86400 ))
}
gh_cmd() { if command -v timeout >/dev/null 2>&1; then timeout 8 gh "$@"; else gh "$@"; fi; }
W()  { printf ' ⚠ %s' "$1"; }          # append a warning to a line
WL() { printf -- '- ⚠ %s\n' "$1"; }    # warning as its own line

src="$(json_get .source)"; [ -n "$src" ] || src="startup"
sid="$(json_get .session_id)"; [ -n "$sid" ] || sid="unknown"
cwd="$(json_get .cwd)"
root="${CLAUDE_PROJECT_DIR:-}"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$cwd"
{ [ -n "$root" ] && [ -d "$root" ]; } || root="$PWD"
cd "$root" 2>/dev/null || exit 0

echo "## Session card · fluory-system · $src"
name="$(basename "$root")"

# --- Repo & safety ------------------------------------------------------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  l="- Repo: $name · branch: $branch"
  is_protected "$branch" && l="$l$(W "on $branch – never commit here: git switch -c claude/<type>-<topic>-<issue-nr> (rule 1)")"
  echo "$l"
  dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"; up="yes"
  else
    ahead=0; up="no"
  fi
  wt="$(git worktree list 2>/dev/null | wc -l | tr -d ' ')"
  l="- Safety: $dirty uncommitted · $ahead unpushed · upstream: $up · worktrees: $wt"
  [ "${dirty:-0}" -gt 0 ] && l="$l$(W "uncommitted work – commit and push early (rule 4)")"
  [ "${ahead:-0}" -gt 0 ] && l="$l$(W "unpushed commits")"
  echo "$l"
else
  echo "- Repo: $name (not a git working tree)"
fi

# --- Profile ------------------------------------------------------------------------------
if [ -f project-profile.yml ]; then
  stage="$(sed -n 's/^[[:space:]]*stage:[[:space:]]*\([a-z]*\).*/\1/p' project-profile.yml | head -1)"
  ver="$(sed -n 's/^[[:space:]]*fluory_system_version:[[:space:]]*"\{0,1\}\([0-9][0-9.]*\)"\{0,1\}.*/\1/p' project-profile.yml | head -1)"
  rev="$(sed -n 's/^[[:space:]]*last_system_review:[[:space:]]*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\).*/\1/p' project-profile.yml | head -1)"
  l="- Profile: stage ${stage:-?} · fluory-system ${ver:-?}"
  [ -n "$ver" ] || l="$l$(W "system: version missing in the profile (§3)")"
  if [ -n "$rev" ]; then
    d="$(days_since "$rev" 2>/dev/null || true)"
    if [ -n "$d" ]; then
      l="$l · last system review $rev ($d days)"
      [ "$d" -gt 90 ] && l="$l$(W "over 90 days – reconcile with Entwicklungsplan/templates/VERSION (§12)")"
    fi
  else
    l="$l$(W "last_system_review not set – set it at the next reconciliation (§12)")"
  fi
  echo "$l"
fi

# --- Mandatory reading --------------------------------------------------------------------
if [ -f AGENTS.md ]; then
  n="$(lines AGENTS.md)"
  l="- Mandatory reading: AGENTS.md $n lines"
  [ "$n" -gt 150 ] && l="$l$(W "over 150 – condense instead of extending (§9)")"
  for a in docs/ARCHITEKTUR.md docs/technical/architecture.md; do
    if [ -f "$a" ]; then
      m="$(lines "$a")"; l="$l · $a $m lines"
      [ "$m" -gt 150 ] && l="$l$(W "over ~3 screens – condense (§9)")"
    fi
  done
  echo "$l"
fi

# --- Guards -------------------------------------------------------------------------------
if have_json_tool; then g="push guard active"; else g="$(W "push guard INACTIVE – install jq, python3 or node")"; fi
if [ -f scripts/doku-check.sh ]; then dc="doku-check present"; else dc="doku-check missing"; fi
[ -f scripts/check-drift.sh ] && dc="check-drift present"
if [ -f .claude/hooks/pre-compact.sh ] || [ -f templates/base/.claude/hooks/pre-compact.sh ]; then sn="compaction snapshot active"
else sn="$(W "pre-compact.sh missing – no snapshot before compaction (§6)")"; fi
if [ -f .claude/settings.json ] && grep -qE '"autoMemoryEnabled":[[:space:]]*false' .claude/settings.json; then am="auto memory off"
else am="$(W "auto memory ON – set autoMemoryEnabled: false in .claude/settings.json (§10)")"; fi
echo "- Guards: $g · stop check active · $dc · $sn · $am"

# --- Control-center extras ----------------------------------------------------------------
if [ -f scripts/check-drift.sh ]; then
  echo "- $(bash scripts/check-drift.sh --summary 2>/dev/null || echo 'drift check not executable')"
fi
if [ -f PROJEKTE.md ]; then
  st="$(sed -n 's/.*Stand: \([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\).*/\1/p' PROJEKTE.md | head -1)"
  if [ -n "$st" ]; then
    d="$(days_since "$st" 2>/dev/null || true)"
    if [ -n "$d" ]; then
      l="- Portfolio: PROJEKTE.md state $st ($d days)"
      [ "$d" -gt 45 ] && l="$l$(W "older than 45 days – verify the rows at the source, orchestration level only (§3)")"
      echo "$l"
    fi
  fi
fi

# --- Open PRs (best effort) ---------------------------------------------------------------
if command -v gh >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  prs="$(gh_cmd pr list --state open --limit 5 --json number,title,isDraft \
        --jq '.[] | "#\(.number)\(if .isDraft then " (draft)" else "" end) \(.title)"' 2>/dev/null \
        | paste -sd '|' - | sed 's/|/ · /g')"
  [ -n "$prs" ] && echo "- Open PRs: $prs"
fi

# --- Short rules from AGENTS.md -----------------------------------------------------------
if [ -f AGENTS.md ]; then
  rules="$(awk '/^## (Regeln|Rules)/{f=1; next} /^## /{f=0} f' AGENTS.md | sed -e '/<!--.*-->/d' -e '/<!--/,/-->/d' | cat -s | sed '/./,$!d')"
  if [ -n "$(printf '%s' "$rules" | tr -d '[:space:]')" ]; then
    echo
    echo "### Rules (short form) – from AGENTS.md"
    printf '%s\n' "$rules"
  else
    WL "section \"## Rules (short form)\" (or \"## Regeln (Kurzfassung)\") not found in AGENTS.md – restore the heading (template: templates/base/AGENTS.md)"
  fi
else
  WL "AGENTS.md missing – adopt the project card from Entwicklungsplan/templates/base/ (§3)"
fi

# --- Work snapshot after compaction or resume (§6) ----------------------------------------
STATE="${FLUORY_STATE_DIR:-$HOME/.claude/fluory-state}"
key="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$root")"
key="$(printf '%s' "$key" | sed 's#[^A-Za-z0-9._-]#_#g')"
dir="$STATE/$key"
snap="$dir/snapshot-$sid.md"
cnt=0; [ -f "$dir/compactions-$sid" ] && cnt="$(tr -dc '0-9' < "$dir/compactions-$sid")"; cnt="${cnt:-0}"
if [ "$src" = "compact" ] || [ "$src" = "resume" ]; then
  echo
  if [ -f "$snap" ]; then
    echo "### Work snapshot (written by pre-compact.sh before the compaction – ephemeral, not a handover)"
    head -60 "$snap"
  else
    echo "- No work snapshot for this session found ($src) – re-orient from issue, draft PR and git diff."
  fi
  if [ "$cnt" -ge 2 ]; then
    echo
    echo "### Checkpoint after the second compaction (SYSTEM.md §6)"
    echo "Answer before continuing: 1. Is the next smallest step clear? 2. Is the draft PR (Arbeitsstand) current? 3. Is there a green focused proof (verify:changed)? 4. Is an architecture or risk decision open?"
    echo "If any answer is no or unclear: update the draft PR and start a new session. Otherwise continue focused."
  fi
fi

echo
echo "Re-orientation before editing: issue → draft PR (Arbeitsstand) → git diff → affected tests → area rule (SYSTEM.md §6). Before the end: /finish-work – verify + scripts/doku-check.sh, plain-language section in the PR, commit + push, handover comment when handing off."
exit 0
