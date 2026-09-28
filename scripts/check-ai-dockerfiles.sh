#!/usr/bin/env bash
# Keeps services/ai/Dockerfile.vercel in step with services/ai/Dockerfile (#79): every block between
# "# >>> shared" and "# <<< shared" must be identical in both files, in the same order. Comment and
# blank lines inside a block are ignored; everything outside the blocks may differ (documented in the
# head comment of Dockerfile.vercel). Runs in seconds on every PR (CI job `check`).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
base="$root/services/ai/Dockerfile"
vercel="$root/services/ai/Dockerfile.vercel"
[ -f "$base" ] && [ -f "$vercel" ] || { echo "SKIP  AI Dockerfiles not present"; exit 0; }

shared() {
  awk '/^# >>> shared/ { on = 1; print; next } /^# <<< shared/ { on = 0; next } on && !/^[[:space:]]*#/ && NF' "$1"
}

if [ -z "$(shared "$base")" ]; then
  echo "FAIL  no '# >>> shared' block in services/ai/Dockerfile"
  exit 1
fi
if ! diff -u <(shared "$base") <(shared "$vercel"); then
  echo "FAIL  the shared blocks of services/ai/Dockerfile and Dockerfile.vercel differ – change both (#79)"
  exit 1
fi
echo "OK    AI Dockerfiles: $(shared "$base" | grep -c '^# >>> shared') shared block(s) identical"
