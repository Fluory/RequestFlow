#!/usr/bin/env bash
# =============================================================================
# Read guard – fluory-system (PreToolUse hook, matchers: Read and Bash)
# Template: Entwicklungsplan/templates/base/.claude/hooks/guard-read.sh
#
# Two classes of paths are not context (SYSTEM.md §10):
#   ALWAYS blocked – secrets: .env and environment files (.env.example/.sample/.template stay
#     readable), credentials/, secrets/, private-keys/, production-dumps/, key and access files
#     (*.pem, *.key, *.p12, *.pfx, *.jks, *.keystore, *.ppk, id_rsa*/id_dsa*/id_ecdsa*/
#     id_ed25519*, .netrc, .pgpass, .git-credentials, .htpasswd, secrets.*/credentials.* config
#     files, *service-account*.json, *.tfstate), customer data exports (*kundendaten*,
#     *customer-data*, *.dump, *.sql.gz). permissions.deny in .claude/settings.json blocks them
#     as well; this hook adds the reason and covers more programs. No exception.
#   NORMALLY blocked – build artifacts: node_modules/, dist/, build/, coverage/, .next/,
#     .turbo/, .cache/. Exception for one task, explicitly: FLUORY_ALLOW_ARTIFACTS=1 as command
#     prefix (Bash) or in the session environment (Read tool) – name the reason in the PR.
# Checked: reading programs (cat, head, tail, sed, awk, grep, rg, source, editors …: secrets
# and artifacts), carriers that copy, encode, move or transmit a file (cp, base64, gzip, tar,
# dd, openssl, curl, mv, ln, interpreters with a path argument …: secrets only) and git
# subcommands that print or stage file contents (show, cat-file, diff, log, blame, grep,
# restore, checkout: both classes; add: secrets) – through symlinks, globs (cat .env*),
# subshells, bash -c / eval, xargs pipelines and name=value arguments (dd if=, --file=,
# -F f=@). Test and build commands (npm test, npm run build, vitest, node …) are never touched.
# Known limits – a text guard cannot see them; from P1 the sandbox option (filesystem.denyRead)
# is the enforcement: interpreter one-liners (python3 -c, node -e), variable indirection
# (c="cat .env"; $c) and searches without a file name (rg SECRET . – rg honours .gitignore,
# so keep .env ignored).
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
block() { { echo "[fluory-system read guard] BLOCKED: $1"; echo "$2"; } >&2; exit 2; }
SECRET_MSG="Secrets are never read, printed, copied or committed (SYSTEM.md §10, rule 7). No exception – variable names live in .env.example; runtime values come from the secret manager."
ARTIFACT_MSG="node_modules, dist, build, coverage, .next, .turbo and .cache are not context (SYSTEM.md §10). Needed for this task? Bash: prefix FLUORY_ALLOW_ARTIFACTS=1 · Read tool: start the session with FLUORY_ALLOW_ARTIFACTS=1 (or set it under env in .claude/settings.local.json) – and name the reason in the PR."

is_secret() { # $1 = path in any form
  local p="$1" b l; b="${p##*/}"; l="$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')"
  case "$b" in .env.example|.env.sample|.env.template|.env.dist|.env.schema) return 1 ;; esac
  case "$b" in .env|.env.*) return 0 ;; esac
  case "$p" in */credentials/*|credentials/*|*/secrets/*|secrets/*|*/private-keys/*|private-keys/*|*/production-dumps/*|production-dumps/*) return 0 ;; esac
  case "$b" in *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*.ppk|id_rsa*|id_dsa*|id_ecdsa*|id_ed25519*|*.dump|*.sql.gz|*.tfstate|*.tfstate.backup) return 0 ;; esac
  case "$b" in .netrc|_netrc|.pgpass|.git-credentials|.htpasswd|credentials|secrets.json|secrets.yml|secrets.yaml|secrets.toml|secrets.ini|secrets.properties|secret.json|secret.yml|secret.yaml|credentials.json|credentials.yml|credentials.yaml|credentials.toml|credentials.ini|credentials.xml) return 0 ;; esac
  case "$l" in *kundendaten*|*customer-data*|*customerdata*|*service-account*.json|*service_account*.json|*serviceaccount*.json) return 0 ;; esac
  return 1
}
is_artifact() {
  case "$1" in
    */node_modules/*|node_modules/*|*/dist/*|dist/*|*/build/*|build/*|*/coverage/*|coverage/*|*/.next/*|.next/*|*/.turbo/*|.turbo/*|*/.cache/*|.cache/*) return 0 ;;
  esac
  return 1
}
is_reader() { # programs that print or open file contents – secrets and artifacts are checked
  case "$1" in cat|head|tail|less|more|bat|sed|awk|grep|rg|ag|egrep|fgrep|strings|xxd|od|hexdump|cut|sort|uniq|nl|tac|diff|source|.|vim|vi|nvim|nano|emacs|view) return 0 ;; esac
  return 1
}
is_carrier() { # programs that copy, encode, move or transmit a file – secrets are checked, artifacts may be handled
  case "$1" in cp|scp|rsync|sftp|mv|ln|install|base64|base32|gzip|gunzip|zcat|bzip2|bzcat|xz|xzcat|zstd|zip|unzip|tar|7z|7za|dd|openssl|split|iconv|paste|join|comm|curl|wget|nc|ncat|socat|python|python2|python3|node|deno|bun|ruby|perl|php) return 0 ;; esac
  return 1
}
is_git_reader() { # git subcommands that print file contents from history or the tree
  case "$1" in show|cat-file|diff|log|blame|grep|archive|restore|checkout) return 0 ;; esac
  return 1
}
clean() { # strip subshell, backtick, parenthesis and quote characters around a token
  local c="$1"
  c="${c#\$(}"; c="${c#\`}"; c="${c#(}"; c="${c#\"}"; c="${c#\'}"
  c="${c%\`}"; c="${c%)}"; c="${c%\"}"; c="${c%\'}"
  printf '%s' "$c"
}
resolve() { # symlinks: the real target counts too
  local p="$1" r=""
  case "$p" in /*) ;; *) p="$cwd/$p" ;; esac
  [ -e "$p" ] || { printf '%s' "$1"; return; }
  r="$(readlink -f "$p" 2>/dev/null || realpath "$p" 2>/dev/null || true)"
  printf '%s' "${r:-$1}"
}
secret_path() { is_secret "$1" || is_secret "$(resolve "$1")"; }
expand() { # a glob reads the files it matches – check those, not only the pattern text
  case "$1" in
    *\**|*\?*|*\[*) ( cd "$cwd" 2>/dev/null || exit 0; set +f; for m in $1; do [ -e "$m" ] && printf '%s\n' "$m"; done; printf '%s\n' "$1" ) ;;
    *) printf '%s\n' "$1" ;;
  esac
}

have_json_tool || exit 0
tool="$(json_get .tool_name)"
allow_art=0; [ "${FLUORY_ALLOW_ARTIFACTS:-0}" = "1" ] && allow_art=1
cwd="$(json_get .cwd)"
{ [ -n "$cwd" ] && [ -d "$cwd" ]; } || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ "$tool" = "Read" ]; then
  f="$(json_get .tool_input.file_path)"; [ -n "$f" ] || exit 0
  secret_path "$f" && block "reading a secret file: $f" "$SECRET_MSG"
  if [ "$allow_art" -eq 0 ] && is_artifact "$f"; then block "reading a build artifact: $f" "$ARTIFACT_MSG"; fi
  exit 0
fi

cmd="$(json_get .tool_input.command)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *FLUORY_ALLOW_ARTIFACTS=1*) allow_art=1 ;; esac
segments="$(printf '%s\n' "$cmd" | strip_heredocs | awk '{ gsub(/&&|\|\||;|\||\$\(|`/, "\n"); print }')"
# shellcheck disable=SC2206  # deliberate: naive tokenisation is enough for path arguments
all_toks=( $(printf '%s' "$segments" | tr '\n' ' ') )   # xargs: the file names arrive from other segments
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -n "$seg" ] || continue
  # shellcheck disable=SC2206
  toks=( $seg )
  reader=0; carrier=0; prog=""; in_git=0; via_xargs=0
  for t in "${toks[@]}"; do
    c="$(clean "$t")"
    case "$c" in xargs) via_xargs=1; continue ;; esac
    case "$c" in [A-Za-z_]*=*|command|sudo|exec|time|nohup|env|builtin|timeout|nice) continue ;; esac
    if is_reader "$c"; then reader=1; [ -n "$prog" ] || prog="$c"; fi
    if is_carrier "$c"; then carrier=1; [ -n "$prog" ] || prog="$c"; fi
    [ "$c" = "git" ] && in_git=1
    if [ "$in_git" -eq 1 ]; then
      if is_git_reader "$c"; then reader=1; prog="git $c"; fi
      case "$c" in add|stage) carrier=1; prog="git $c" ;; esac
    fi
  done
  [ "$reader" -eq 1 ] || [ "$carrier" -eq 1 ] || continue
  scan=("${toks[@]}"); [ "$via_xargs" -eq 1 ] && scan=("${all_toks[@]}")
  for t in "${scan[@]}"; do
    c="$(clean "$t")"
    case "$c" in -*=*|[A-Za-z_]*=*) c="${c#*=}" ;; -*|"") continue ;; esac   # dd if=.env, --file=.env, -F f=@.env
    c="${c#@}"
    case "$c" in *:*) c="${c#*:}" ;; esac                                     # git show <rev>:<path>, host:path
    [ -n "$c" ] || continue
    for p in $(expand "$c"); do
      secret_path "$p" && block "secret file as argument of $prog: $p" "$SECRET_MSG"
      if [ "$reader" -eq 1 ] && [ "$allow_art" -eq 0 ] && is_artifact "$p"; then block "reading a build artifact with $prog: $p" "$ARTIFACT_MSG"; fi
    done
  done
done <<< "$segments"
exit 0
