#!/usr/bin/env bash
# =============================================================================
# Push guard – fluory-system (PreToolUse hook, matcher: Bash)
# Template: Entwicklungsplan/templates/base/.claude/hooks/guard-git.sh
#
# Blocks in EVERY Claude Code session of this repo (SYSTEM.md §5, rules 1 + 8):
#   - git push to main/master – explicit, via refspec (HEAD:main, x:main, +main),
#     via upstream default (bare `git push` on main), --all/--mirror
#   - force push (--force, -f, +refspec); --force-with-lease only on non-main branches
#   - deleting main/master on the remote
#   - git commit/merge/rebase/cherry-pick/revert/am ON main/master (once commits exist)
#   - --no-verify (commit -n, push --no-verify)
#
# Behaviour: exit 2 + reason on stderr → Claude sees the reason and takes the rule path.
# Without jq/python3/node: fail open (exit 0) – the session card warns visibly.
# Protected branches: FLUORY_PROTECTED_BRANCHES="main master" (space separated).
# Chains, pipes, subshells, env prefixes and wrappers (bash -c, sh -c, eval, xargs) are unwrapped;
# heredoc bodies are never scanned. Known limit: variable indirection (c="git push …"; $c).
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
set -f   # no glob expansion while tokenising the command

PROTECTED="${FLUORY_PROTECTED_BRANCHES:-main master}"
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
is_protected() { local b; for b in $PROTECTED; do [ "$1" = "$b" ] && return 0; done; return 1; }
current_branch() { git -C "$1" rev-parse --abbrev-ref HEAD 2>/dev/null || true; }
has_commits() { git -C "$1" rev-parse --verify -q HEAD >/dev/null 2>&1; }
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
    echo "[fluory-system push guard] BLOCKED: $1"
    echo "$2"
    echo "False alarm? Open an issue in the control center (Entwicklungsplan) – never bypass or disable the hook."
  } >&2
  exit 2
}

have_json_tool || exit 0
cmd="$(json_get .tool_input.command)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *git*) ;; *) exit 0 ;; esac

cwd="$(json_get .cwd)"
if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="${CLAUDE_PROJECT_DIR:-$PWD}"; fi

# split command chains into single commands (&&, ||, ;, |, newline) – without heredoc bodies
segments="$(printf '%s\n' "$cmd" | strip_heredocs | awk '{ gsub(/&&|\|\||;|\||\$\(|`/, "\n"); print }')"

check_push() { # $1 = index of the first token after "push"; uses toks, branch
  local j t force=0 lease=0 noverify=0 delete=0 all=0 remote="" dst src
  local refspecs=() targets=()
  for (( j=$1; j<${#toks[@]}; j++ )); do
    t="${toks[$j]}"
    case "$t" in
      --) ;;
      --force) force=1 ;;
      --force-with-lease|--force-with-lease=*|--force-if-includes) lease=1 ;;
      --no-verify) noverify=1 ;;
      --delete) delete=1 ;;
      --all|--mirror|--branches) all=1 ;;
      --repo=*|--receive-pack=*|--exec=*|--push-option=*|--signed=*|--recurse-submodules=*) ;;
      --repo|--receive-pack|--exec|-o|--push-option) j=$((j+1)) ;;
      --*) ;;
      -*) case "$t" in *f*) force=1 ;; esac
          case "$t" in *d*) delete=1 ;; esac ;;
      *) if [ -z "$remote" ]; then remote="$t"; else refspecs+=("$t"); fi ;;
    esac
  done
  if [ "$all" -eq 1 ]; then
    block "git push --all/--mirror (would push $PROTECTED too)." \
      "Rule 1: main only via PR – push only your own branch: git push -u origin <branch>."
  fi
  if [ ${#refspecs[@]} -eq 0 ]; then
    if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then targets+=("$branch"); fi
  else
    for t in "${refspecs[@]}"; do
      case "$t" in +*) force=1; t="${t#+}" ;; esac
      case "$t" in
        *:*) src="${t%%:*}"; dst="${t#*:}"; [ -n "$dst" ] || dst="$src"; [ -n "$src" ] || delete=1 ;;
        *)   dst="$t" ;;
      esac
      [ "$dst" = "HEAD" ] && dst="$branch"
      dst="${dst#refs/heads/}"
      targets+=("$dst")
    done
  fi
  if [ "$noverify" -eq 1 ]; then
    block "git push --no-verify." "Checks are never bypassed (SYSTEM.md §11, rule 16)."
  fi
  if [ "$force" -eq 1 ]; then
    block "force push (git ${toks[*]})." \
      "Force push is blocked – the history of a pushed branch is never rewritten (§6: handover runs through commits). After a rebase on your own claude/ branch: --force-with-lease, noted in the PR."
  fi
  if [ ${#targets[@]} -gt 0 ]; then
    for dst in "${targets[@]}"; do
      if is_protected "$dst"; then
        if [ "$delete" -eq 1 ]; then
          block "deleting '$dst' on the remote." "Rule 1: $dst is the only verified product state."
        fi
        block "git push to '$dst'." \
          "Rule 1 (AGENTS.md): $dst only via PR. Way: git switch -c claude/<type>-<topic>-<issue-nr> → git push -u origin <branch> → draft PR → review by the reviewer role."
      fi
    done
  fi
}

while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"   # strip leading whitespace
  [ -n "$seg" ] || continue
  # shellcheck disable=SC2206  # deliberate: naive tokenisation is enough for git commands
  toks=( $seg )
  for k in "${!toks[@]}"; do                     # strip subshell/quote remnants around tokens
    t="${toks[$k]}"; t="${t%)}"; t="${t%\`}"; t="${t%\"}"; t="${t%\'}"; t="${t#\"}"; t="${t#\'}"; toks[$k]="$t"
  done
  n=${#toks[@]}
  i=0
  while [ "$i" -lt "$n" ]; do                    # skip prefixes: env assignments, wrappers, shells (bash -c), eval, xargs and their options
    case "${toks[$i]}" in
      [A-Za-z_]*=*) ;;
      command|sudo|exec|time|nohup|env|builtin|eval|xargs|bash|sh|zsh|dash|ksh|*/bash|*/sh|*/zsh|*/dash) ;;
      -*) ;;
      *) break ;;
    esac
    i=$((i+1))
  done
  [ "$i" -lt "$n" ] || continue
  case "${toks[$i]}" in git|*/git) ;; *) continue ;; esac
  i=$((i+1))
  gitdir="$cwd"
  while [ "$i" -lt "$n" ]; do                    # global git options
    case "${toks[$i]}" in
      -C) i=$((i+1)); d="${toks[$i]}"
          case "$d" in /*) gitdir="$d" ;; *) gitdir="$cwd/$d" ;; esac ;;
      -c|--git-dir|--work-tree|--namespace|--exec-path) i=$((i+1)) ;;
      -*) ;;
      *) break ;;
    esac
    i=$((i+1))
  done
  [ "$i" -lt "$n" ] || continue
  sub="${toks[$i]}"; i=$((i+1))
  branch="$(current_branch "$gitdir")"
  case "$sub" in
    push) check_push "$i" ;;
    commit|merge|rebase|cherry-pick|revert|am)
      for (( j=i; j<n; j++ )); do
        t="${toks[$j]}"
        if [ "$t" = "--no-verify" ] || { [ "$sub" = "commit" ] && [ "$t" = "-n" ]; }; then
          block "git $sub --no-verify." "Checks (pre-commit hooks, verify) are never bypassed (SYSTEM.md §11, rule 16)."
        fi
      done
      if is_protected "$branch" && has_commits "$gitdir"; then
        block "git $sub on '$branch'." \
          "Rule 1 (AGENTS.md): $branch only via PR. Way: git switch -c claude/<type>-<topic>-<issue-nr>, commit there, push, open a draft PR."
      fi ;;
  esac
done <<< "$segments"

exit 0
