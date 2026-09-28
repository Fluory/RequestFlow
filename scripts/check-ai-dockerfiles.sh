#!/usr/bin/env bash
# Keeps services/ai/Dockerfile.vercel in step with services/ai/Dockerfile (#79). Runs in seconds on
# every PR (CI job `check`). Three rules:
#   1. Both files carry the shared blocks build, user, runtime ("# >>> shared: <name>" … "# <<< shared"),
#      in this order, and the blocks are identical (comment and blank lines inside are ignored).
#   2. Outside the shared blocks only the documented differences exist: the optional model prefetch in
#      Dockerfile, PORT in Dockerfile.vercel, and each file's CMD (#94 review).
#   3. Both CMDs start the same app with the same uvicorn options (only the port source differs).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
base="$root/services/ai/Dockerfile"
vercel="$root/services/ai/Dockerfile.vercel"
if [ ! -f "$base" ] && [ ! -f "$vercel" ]; then
  echo "SKIP  no AI Dockerfiles"
  exit 0
fi
for file in "$base" "$vercel"; do
  [ -f "$file" ] || { echo "FAIL  ${file#"$root"/} is missing – both AI Dockerfiles belong together (#79)"; exit 1; }
done
fail=0

# CRLF-safe reading: every line without a trailing carriage return.
clean() { tr -d '\r' < "$1"; }

block_names() { clean "$1" | sed -n 's/^# >>> shared: \([a-z]*\).*/\1/p' | tr '\n' ' '; }
shared() { clean "$1" | awk '/^# >>> shared/ { on = 1; print; next } /^# <<< shared/ { on = 0; next } on && !/^[[:space:]]*#/ && NF'; }
# Instructions outside the shared blocks: unindented lines starting with an upper-case keyword.
outside() { clean "$1" | awk '/^# >>> shared/ { on = 1; next } /^# <<< shared/ { on = 0; next } !on && /^[A-Z]+ /'; }
# The CMD instruction with its continuation lines joined.
cmd_of() { clean "$1" | awk '/^CMD / { on = 1 } on { line = line " " $0; if ($0 !~ /\\$/) exit } END { print line }'; }
uvicorn_signature() {
  local cmd; cmd="$(cmd_of "$1")"
  printf '%s\n' "$(grep -oE 'requestflow_ai\.[a-z_.]+:[a-z_]+' <<<"$cmd" | head -1)" \
    "$(grep -oE -- '--[a-z-]+' <<<"$cmd" | grep -vx -- '--port' | sort | tr '\n' ' ')"
}

expected="build user runtime "
for file in "$base" "$vercel"; do
  names="$(block_names "$file")"
  if [ "$names" != "$expected" ]; then
    echo "FAIL  ${file#"$root"/}: shared blocks '${names% }' – expected '${expected% }'"
    fail=1
  fi
done

if ! diff -u <(shared "$base") <(shared "$vercel"); then
  echo "FAIL  the shared blocks of both AI Dockerfiles differ – change both (#79)"
  fail=1
fi

check_outside() {
  local file="$1"; shift
  local line allowed pattern
  while IFS= read -r line; do
    allowed=0
    for pattern in "$@"; do
      if [[ "$line" =~ $pattern ]]; then allowed=1; break; fi
    done
    if [ "$allowed" = 0 ]; then
      echo "FAIL  ${file#"$root"/}: '${line}' is outside the shared blocks and not a documented difference"
      fail=1
    fi
  done < <(outside "$file")
}
check_outside "$base" '^ARG PREFETCH_(LAYOUT_MODEL|OCR_MODELS)=' '^ENV DOCLING_ARTIFACTS_PATH=' '^RUN mkdir -p /opt/docling-models ' '^CMD '
check_outside "$vercel" '^ENV PORT=8080$' '^CMD '

if [ "$(uvicorn_signature "$base")" != "$(uvicorn_signature "$vercel")" ]; then
  echo "FAIL  the CMDs start a different app or with different uvicorn options:"
  echo "      Dockerfile:        $(uvicorn_signature "$base" | tr '\n' ' ')"
  echo "      Dockerfile.vercel: $(uvicorn_signature "$vercel" | tr '\n' ' ')"
  fail=1
fi

[ "$fail" = 0 ] || exit 1
echo "OK    AI Dockerfiles: shared blocks ${expected% } identical, only documented differences, same uvicorn options"
