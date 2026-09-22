#!/usr/bin/env bash
# =============================================================================
# Docs guard – fluory-system (SYSTEM.md §2, §3, §6, §8, §9, §10, §12)
# Template: Entwicklungsplan/templates/base/scripts/doku-check.sh
#
# Checks the documentation truth of a project repo mechanically – seconds, no dependencies.
# Runs in the CI docs check on every PR (ci.yml) and in /finish-work.
#   FAIL → exit 1 (blocks)   WARN → hint   OK → one line
# Usage:   scripts/doku-check.sh [--warn-only]
# Budgets: DOKU_AGENTS_WARN=150 DOKU_AGENTS_MAX=200 DOKU_ARCH_WARN=150 DOKU_UNRELEASED_WARN=100
#          DOKU_RULE_WARN=60
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
WARN_ONLY=0; [ "${1:-}" = "--warn-only" ] && WARN_ONLY=1
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

AGENTS_WARN="${DOKU_AGENTS_WARN:-150}"; AGENTS_MAX="${DOKU_AGENTS_MAX:-200}"
ARCH_WARN="${DOKU_ARCH_WARN:-150}";     UNRELEASED_WARN="${DOKU_UNRELEASED_WARN:-100}"
RULE_WARN="${DOKU_RULE_WARN:-60}"
fails=0; warns=0
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warns=$((warns+1)); }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails+1)); }
lines() { wc -l < "$1" | tr -d ' '; }
all_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard
  else
    find . -type f -not -path './.git/*' | sed 's#^\./##'
  fi
}

# --- 1 AGENTS.md – mandatory reading (§8, §9) --------------------------------------------
if [ -f AGENTS.md ]; then
  n="$(lines AGENTS.md)"
  if [ "$n" -gt "$AGENTS_MAX" ]; then
    fail "AGENTS.md has $n lines (> $AGENTS_MAX) – condense instead of extending (§9 mandatory-reading guard)"
  elif [ "$n" -gt "$AGENTS_WARN" ]; then
    warn "AGENTS.md has $n lines (guideline ≤ $AGENTS_WARN) – open a condensing issue"
  else
    ok "AGENTS.md $n lines"
  fi
  grep -qE '^## (Rules|Regeln)' AGENTS.md || fail "AGENTS.md has no section \"## Rules (short form)\" – the session-start card re-injects exactly this section"
  grep -qE '<(Project name|command|verify command|Projektname|Befehl|verify-Kommando)' AGENTS.md && warn "AGENTS.md still contains template placeholders (<Project name>, <command>, <verify command …>)"
else
  fail "AGENTS.md missing – adopt it from Entwicklungsplan/templates/base/ (§3)"
fi

# --- 2 CLAUDE.md imports AGENTS.md -------------------------------------------------------
if [ -f CLAUDE.md ]; then
  if grep -qE '^@AGENTS\.md[[:space:]]*$' CLAUDE.md; then ok "CLAUDE.md imports AGENTS.md"
  else fail "CLAUDE.md does not import AGENTS.md (line \"@AGENTS.md\" missing) – Claude Code does not read AGENTS.md otherwise"; fi
  grep -q '^# Compact instructions' CLAUDE.md || fail "CLAUDE.md has no \"# Compact instructions\" section – a compaction would drop the work state (§6; template: templates/base/CLAUDE.md)"
else
  fail "CLAUDE.md missing (template: templates/base/CLAUDE.md – contains the @AGENTS.md import)"
fi

# --- 3 Profile (§3, §10, §12) -------------------------------------------------------------
if [ -f project-profile.yml ]; then
  ver="$(sed -n 's/^[[:space:]]*fluory_system_version:[[:space:]]*"\{0,1\}\([0-9][0-9.]*\)"\{0,1\}.*/\1/p' project-profile.yml | head -1)"
  if [ -n "$ver" ]; then ok "project-profile.yml: fluory-system $ver"
  else fail "project-profile.yml without a valid fluory_system_version (system: block, §3)"; fi
  rev="$(sed -n 's/^[[:space:]]*last_system_review:[[:space:]]*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\).*/\1/p' project-profile.yml | head -1)"
  [ -n "$rev" ] || warn "project-profile.yml: last_system_review not set (YYYY-MM-DD) – set it at the next version review (§12)"
  grep -qE '^[[:space:]]*name:[[:space:]]*<' project-profile.yml && warn "project-profile.yml: placeholder <projektname> not replaced"
else
  fail "project-profile.yml missing (§10)"
fi

# --- 4 Forbidden status/handover files (§2: duplicates drift) -----------------------------
forbidden="$(all_files | grep -Ei '(^|/)(todo|status|notes|handoff[^/]*|handover[^/]*|session[-_]?log[^/]*)\.md$|(^|/)docs/(sessions|archive|handoff|handover)(/|$)' || true)"
if [ -n "$forbidden" ]; then
  fail "forbidden status/handover files (§2, §9 – state belongs in issue/PR, history comes from git):"
  printf '%s\n' "$forbidden" | sed 's/^/        /'
else
  ok "no status/handover files"
fi

# --- 5 CHANGELOG (§9, §12) ----------------------------------------------------------------
if [ -f CHANGELOG.md ]; then
  if grep -q '^## \[Unreleased\]' CHANGELOG.md; then
    un="$(awk '/^## \[Unreleased\]/{f=1; next} /^## /{f=0} f' CHANGELOG.md | wc -l | tr -d ' ')"
    if [ "$un" -gt "$UNRELEASED_WARN" ]; then
      warn "CHANGELOG [Unreleased] has $un lines (> $UNRELEASED_WARN) – release due or condense (§12 CHANGELOG guard)"
    else
      ok "CHANGELOG [Unreleased] $un lines"
    fi
  else
    fail "CHANGELOG.md without a section \"## [Unreleased]\" (Keep a Changelog, §9/§12)"
  fi
else
  fail "CHANGELOG.md missing (§3)"
fi

# --- 6 Architecture map (§9, §10) ---------------------------------------------------------
arch=""
for a in docs/ARCHITEKTUR.md docs/technical/architecture.md; do
  if [ -f "$a" ]; then arch="$a"; break; fi
done
if [ -n "$arch" ]; then
  m="$(lines "$arch")"
  if [ "$m" -gt "$ARCH_WARN" ]; then warn "$arch has $m lines (> ~3 screens) – condense (§9)"
  else ok "$arch $m lines"; fi
else
  fail "architecture map missing: docs/ARCHITEKTUR.md (P0) or docs/technical/architecture.md (from P1) – §10"
fi

# --- 7 Guards installed (§5, §6) ----------------------------------------------------------
if [ -f .claude/settings.json ]; then
  ok ".claude/settings.json present"
  grep -qE '"autoMemoryEnabled":[[:space:]]*false' .claude/settings.json || fail ".claude/settings.json: autoMemoryEnabled is not false – auto memory would carry project knowledge past GitHub (§10)"
  for r in 'Read(.env)' 'Read(secrets/**)' 'Read(credentials/**)' 'Read(private-keys/**)' 'Read(production-dumps/**)'; do
    grep -qF "\"$r\"" .claude/settings.json || fail ".claude/settings.json: permissions.deny lacks \"$r\" (§10; template: templates/base/.claude/settings.json)"
  done
else warn ".claude/settings.json missing – adopt the guard hooks, read locks and auto-memory switch from templates/base/.claude/ (§5, §6, §10)"; fi
for h in session-start.sh guard-git.sh stop-check.sh pre-compact.sh filter-test-output.sh guard-checkpoint.sh guard-read.sh; do
  if [ -f ".claude/hooks/$h" ]; then
    [ -x ".claude/hooks/$h" ] || warn ".claude/hooks/$h is not executable (chmod +x)"
  elif [ -f .claude/settings.json ]; then
    warn ".claude/hooks/$h missing although settings.json references it"
  fi
done

if [ -f scripts/quiet-run.sh ]; then [ -x scripts/quiet-run.sh ] || warn "scripts/quiet-run.sh is not executable (chmod +x)"
else warn "scripts/quiet-run.sh missing – test output filter and verify recording inactive (§11; template: templates/base/scripts/)"; fi

if [ -f scripts/pr-check.sh ]; then [ -x scripts/pr-check.sh ] || warn "scripts/pr-check.sh is not executable (chmod +x)"
else warn "scripts/pr-check.sh missing – PR guard (plan gate, docs decision, proof) inactive (§6; template: templates/base/scripts/)"; fi
if [ -f .github/PULL_REQUEST_TEMPLATE.md ]; then
  for k in "Arbeitsstand" "Klartext" "Plan-Pflicht" "Nachweis" "Doku-Entscheidung" "Dateigrößen"; do
    grep -q "$k" .github/PULL_REQUEST_TEMPLATE.md || warn ".github/PULL_REQUEST_TEMPLATE.md has no \"$k\" section – outdated (template: templates/base/PULL_REQUEST_TEMPLATE.md)"
  done
else
  warn ".github/PULL_REQUEST_TEMPLATE.md missing (§6)"
fi

# --- 8 Dated folders (§3, §9) -------------------------------------------------------------
for d in docs/input docs/reports; do
  [ -d "$d" ] || continue
  bad="$(find "$d" -type f ! -name 'README.md' ! -name '.gitkeep' 2>/dev/null | grep -vE "^$d/[0-9]{4}-[0-9]{2}-[0-9]{2}-" || true)"
  if [ -n "$bad" ]; then
    warn "$d/: files without date prefix YYYY-MM-DD- (§9):"
    printf '%s\n' "$bad" | sed 's/^/        /'
  fi
done

# --- 9 Path-scoped rules (§8): scoped, small, not a second project card ------------------
if [ -d .claude/rules ]; then
  nr=0; unscoped=0
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    nr=$((nr+1))
    if [ "$(head -1 "$r")" = "---" ] && sed -n '2,/^---$/p' "$r" | grep -q '^paths:'; then :
    else unscoped=$((unscoped+1)); warn "$r has no paths: frontmatter – it loads in every session; scope it to the files it is about (§8)"; fi
    rl="$(lines "$r")"
    [ "$rl" -gt "$RULE_WARN" ] && warn "$r has $rl lines (guideline ≤ $RULE_WARN) – a rule file is a checklist, not a handbook (§8)"
  done < <(find .claude/rules -type f -name '*.md' | sort)
  [ "$nr" -gt 0 ] && ok ".claude/rules: $nr rule files, $((nr-unscoped)) path-scoped" || warn ".claude/rules/ is empty – area rules from templates/base/.claude/rules/ (§8)"
else
  warn ".claude/rules/ missing – area rules from templates/base/.claude/rules/ load only when matching files are read (§8)"
fi

# --- Summary ------------------------------------------------------------------------------
echo "----"
if [ "$fails" -gt 0 ]; then
  echo "Docs guard: $fails FAIL, $warns WARN"
  [ "$WARN_ONLY" -eq 1 ] && exit 0
  exit 1
fi
echo "Docs guard: green ($warns WARN)"
exit 0
