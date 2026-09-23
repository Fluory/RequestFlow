#!/usr/bin/env bash
# verify:changed – the inner loop (AGENTS.md): lint + typecheck + the unit tests related to the
# touched files. Paths as arguments, otherwise the files changed against the merge base with
# origin/main plus uncommitted and untracked files.
#   pnpm verify:changed                       # everything touched on this branch
#   pnpm verify:changed -- src/features/intake
# Integration tests are not part of the inner loop; `pnpm verify` runs them.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "$#" -gt 0 ]; then
  mapfile -t files < <(for arg in "$@"; do [ "$arg" = "--" ] || find "$arg" -type f; done)
else
  base="$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)"
  mapfile -t files < <({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
fi

ts=()
for f in "${files[@]}"; do
  case "$f" in
    tests/fixtures/*|services/*) ;;
    *.ts|*.tsx|*.mjs|*.cjs) [ -f "$f" ] && ts+=("$f") ;;
  esac
done

if [ "${#ts[@]}" -eq 0 ]; then
  echo "verify:changed – no TypeScript files touched."
  exit 0
fi

echo "verify:changed – ${#ts[@]} file(s)"
pnpm exec eslint --max-warnings 0 "${ts[@]}"
pnpm exec tsc --noEmit
pnpm exec vitest related --run --project unit --passWithNoTests "${ts[@]}"
