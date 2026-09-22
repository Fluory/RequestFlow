#!/usr/bin/env bash
# =============================================================================
# PR guard – fluory-system (SYSTEM.md §4, §6, §7, §9, §11)
# Template: Entwicklungsplan/templates/base/scripts/pr-check.sh
#
# Checks the PR DESCRIPTION mechanically. ci.yml passes the body as PR_BODY on every PR:
#   - plain-language section "Was ist passiert (Klartext)" filled, no template placeholder
#   - "Doku-Entscheidung": exactly one top-level decision; "docs affected" needs ≥ 1 kind
#   - "Plan-Pflicht": exactly one box; "trigger applies" needs a filled Impact Manifest
#   - draft PR: "Arbeitsstand" names the next smallest step
#   - non-draft PR: "Nachweis" reports verify green (no ready-for-review without it)
#   - file size gate (§7): >300 hint, >500 decision, >800 justified exception, >1000 architecture
#     finding in P1/P2 (issue or ADR); test files are hint-only; exemptions for generated code,
#     lockfiles, fixtures, migrations, schemas, resources, docs, build output, config
#     (extra globs: SIZE_IGNORE="a|b")
#   - before creating: new shared/utility/adapter/service files need a documented search
#   - PR_EXACTLY_ONE / PR_AT_LEAST_ONE: extra sections with checkbox rules (control center)
# It cannot judge whether a decision is right – that stays a review task.
# Env:  PR_BODY (required)  PR_DRAFT=true|false  PR_TITLE  BASE_REF=origin/main  PR_REQUIRED_SECTIONS="A|B"
#       PR_EXACTLY_ONE="A|B"  PR_AT_LEAST_ONE="A|B"        FAIL → exit 1, --warn-only → exit 0
# Local: PR_BODY="$(gh pr view --json body -q .body)" PR_DRAFT=true scripts/pr-check.sh
# Self-test: Entwicklungsplan/scripts/test-hooks.sh
# =============================================================================
WARN_ONLY=0; [ "${1:-}" = "--warn-only" ] && WARN_ONLY=1
REQUIRED="${PR_REQUIRED_SECTIONS-Was ist passiert (Klartext)|Doku-Entscheidung}"
EXACTLY_ONE="${PR_EXACTLY_ONE-}"
AT_LEAST_ONE="${PR_AT_LEAST_ONE-}"
fails=0; warns=0
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warns=$((warns+1)); }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails+1)); }
finish() {
  echo "----"
  if [ "$fails" -gt 0 ]; then echo "PR guard: $fails FAIL, $warns WARN"; [ "$WARN_ONLY" -eq 1 ] && exit 0; exit 1; fi
  echo "PR guard: green ($warns WARN)"; exit 0
}

body="$(printf '%s\n' "${PR_BODY:-}" | sed 's/\r$//')"
if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
  fail "PR_BODY is empty – the PR has no description (template: .github/PULL_REQUEST_TEMPLATE.md)"; finish
fi
has_section() { printf '%s\n' "$body" | awk -v h="$1" 'index($0, "## " h) == 1 { f = 1 } END { exit !f }'; }
section() { # text of "## <prefix>…" up to the next "## " heading, HTML comments removed
  printf '%s\n' "$body" | awk -v h="$1" '
    /^## / { if (f) exit; if (index($0, "## " h) == 1) { f = 1; next } }
    f' | sed -e '/<!--.*-->/d' -e '/<!--/,/-->/d'
}
checked_top()  { section "$1" | grep -cE '^- \[[xX]\]'; }
checked_top_text() { section "$1" | grep -E '^- \[[xX]\]' | head -1; }
checked_sub()  { section "$1" | grep -cE '^ {2,}- \[[xX]\]'; }
filled() { # $1 = text: at least 20 visible characters and no obvious template placeholder
  local t; t="$(printf '%s' "$1" | grep -vE '^[[:space:]]*$' || true)"
  [ "$(printf '%s' "$t" | tr -d '[:space:]' | wc -c | tr -d ' ')" -ge 20 ] || return 1
  printf '%s' "$t" | grep -qE '<Pflicht|<…>|<\.\.\.>|<ein Satz>|<what|<why' && return 1
  return 0
}
field() { # $1 = section  $2 = bold field name → value after "**name:**"
  section "$1" | sed -nE "s#^- \*\*$2:\*\*[[:space:]]*(.*)\$#\1#p" | head -1
}
field_filled() { local v; v="$(field "$1" "$2")"; [ -n "$(printf '%s' "$v" | tr -d '[:space:]')" ] && ! printf '%s' "$v" | grep -qE '^<.*>$'; }

# --- language: PR titles are English (SYSTEM.md "Sprache und Portfolio") ------------------------
if [ -n "${PR_TITLE:-}" ] && printf '%s' "$PR_TITLE" | grep -qE '[äöüÄÖÜß]| (und|oder|für|mit|nicht|neue[rs]?|wird) '; then
  warn "PR title looks German – technical artefacts, commits and PR titles are English: $PR_TITLE"
fi

# --- required sections --------------------------------------------------------------------
IFS='|' read -r -a req <<< "$REQUIRED"
for h in "${req[@]}"; do
  [ -n "$h" ] || continue
  has_section "$h" || fail "section \"## $h\" missing – PR template outdated? (templates/base/PULL_REQUEST_TEMPLATE.md)"
done

# --- plain language -----------------------------------------------------------------------
if has_section "Was ist passiert (Klartext)"; then
  if filled "$(section 'Was ist passiert (Klartext)')"; then ok "plain-language section filled"
  else fail "\"Was ist passiert (Klartext)\" is empty or still the template placeholder (SYSTEM.md §6)"; fi
fi

# --- docs decision: exactly one ------------------------------------------------------------
if has_section "Doku-Entscheidung"; then
  n="$(checked_top 'Doku-Entscheidung')"
  if [ "$n" -ne 1 ]; then fail "Doku-Entscheidung: exactly one decision required, found $n (SYSTEM.md §9)"
  else
    t="$(checked_top_text 'Doku-Entscheidung')"; s="$(checked_sub 'Doku-Entscheidung')"
    if printf '%s' "$t" | grep -qiE 'betroffen und|docs affected'; then
      [ "$s" -ge 1 ] && ok "docs decision: docs affected, $s kind(s) named" || fail "Doku-Entscheidung: \"docs affected\" but no kind of documentation checked below it"
    else
      [ "$s" -eq 0 ] && ok "docs decision: no long-lived docs affected" || fail "Doku-Entscheidung: \"no docs affected\" contradicts $s checked kind(s) below"
    fi
  fi
fi

# --- plan gate + impact manifest -----------------------------------------------------------
if has_section "Plan-Pflicht"; then
  n="$(checked_top 'Plan-Pflicht')"
  if [ "$n" -ne 1 ]; then fail "Plan-Pflicht: exactly one answer required, found $n (SYSTEM.md §4)"
  elif checked_top_text 'Plan-Pflicht' | grep -qiE 'zutreffend|applies'; then
    miss=""
    for f in "Betroffene Module" "Schnittstellen / Datenänderungen" "Akzeptanzkriterien" "Testplan" "Risiken und Rollback"; do
      field_filled 'Plan-Pflicht' "$f" || miss="$miss \"$f\""
    done
    [ -z "$miss" ] && ok "plan gate: trigger applies, impact manifest filled" || fail "Plan-Pflicht: trigger applies but the Impact Manifest is incomplete –$miss (SYSTEM.md §4)"
  else
    ok "plan gate: no trigger"
  fi
fi

# --- draft: next smallest step -------------------------------------------------------------
if [ "${PR_DRAFT:-false}" = "true" ]; then
  if ! has_section "Arbeitsstand"; then fail "draft PR without \"## Arbeitsstand\" – the next session reads it first (SYSTEM.md §6)"
  elif field_filled 'Arbeitsstand' 'Nächster kleinster Schritt'; then ok "draft: next smallest step named"
  else fail "draft PR: \"Nächster kleinster Schritt\" in Arbeitsstand is empty (SYSTEM.md §6)"; fi
fi

# --- ready for review: verify green --------------------------------------------------------
if [ "${PR_DRAFT:-false}" != "true" ] && has_section "Nachweis"; then
  v="$(section 'Nachweis' | grep -E '^- `verify`:' | head -1)"
  if [ -z "$v" ]; then fail "Nachweis: line \"- \`verify\`: …\" missing (SYSTEM.md §11)"
  elif printf '%s' "$v" | grep -qiE 'gr(ü|ue)n|green|pass'; then ok "proof: verify green"
  else fail "ready for review without green verify: $v (SYSTEM.md §11)"; fi
fi

# --- file size gate and before-creating (§7) ------------------------------------------------
base="${BASE_REF:-}"
if [ -z "$base" ]; then
  for c in origin/main origin/master main master; do git rev-parse --verify -q "$c" >/dev/null 2>&1 && { base="$c"; break; }; done
fi
exempt() { # generated code, lockfiles, fixtures, migrations, schemas, resources, docs, build output, config
  case "$1" in
    */generated/*|*.generated.*|*/__generated__/*|*.g.ts|*.pb.go|*_pb2.py|*.d.ts) return 0 ;;
    package-lock.json|pnpm-lock.yaml|yarn.lock|Cargo.lock|poetry.lock|Pipfile.lock|composer.lock|Gemfile.lock|go.sum|*.lock) return 0 ;;
    */fixtures/*|*/__fixtures__/*|*/testdata/*|*/__snapshots__/*|*.snap) return 0 ;;
    */migrations/*|*.sql) return 0 ;;
    *.schema.*|*/schema/*|openapi*|*.graphql|*.proto|*.prisma) return 0 ;;
    */locales/*|*/i18n/*|*.json|*.csv|*.xml|*.yaml|*.yml|*.toml|*.ini) return 0 ;;
    *.md|*.mdx|*.rst|*.txt|docs/*) return 0 ;;
    dist/*|build/*|vendor/*|node_modules/*|*.min.*|public/*|*.config.*) return 0 ;;
  esac
  if [ -n "${SIZE_IGNORE:-}" ]; then
    local g; IFS='|' read -r -a ig <<< "$SIZE_IGNORE"
    for g in "${ig[@]}"; do [ -n "$g" ] || continue; case "$1" in $g) return 0 ;; esac; done
  fi
  return 1
}
big500=""; big800=""; big1000=""; hint=""; newshared=""
if [ -n "$base" ] && git rev-parse --verify -q "$base" >/dev/null 2>&1 && git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  stage="$(sed -n 's/^[[:space:]]*stage:[[:space:]]*\([a-z]*\).*/\1/p' project-profile.yml 2>/dev/null | head -1)"
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    exempt "$f" && continue
    n="$(wc -l < "$f" | tr -d ' ')"
    case "$f" in *.test.*|*.spec.*|*/tests/*|*/test/*|*/__tests__/*|tests/*|test/*)   # test files: hint only
      [ "$n" -gt 300 ] && hint="$hint $f($n,test)"; continue ;;
    esac
    if [ "$n" -gt 1000 ]; then big1000="$big1000 $f($n)"
    elif [ "$n" -gt 800 ]; then big800="$big800 $f($n)"
    elif [ "$n" -gt 500 ]; then big500="$big500 $f($n)"
    elif [ "$n" -gt 300 ]; then hint="$hint $f($n)"; fi
  done < <(git diff --name-only "$base...HEAD" 2>/dev/null)
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in *.test.*|*.spec.*|*/tests/*|*/test/*|*/__tests__/*) continue ;; esac
    exempt "$f" && continue
    if printf '%s' "$f" | grep -qiE '(^|/)(shared|utils?|helpers?|lib|adapters?|services?|validators?)/|(util|helper|adapter|service|validator)s?\.[a-z]+$'; then newshared="$newshared $f"; fi
  done < <(git diff --diff-filter=A --name-only "$base...HEAD" 2>/dev/null)
  [ -n "$hint" ] && warn "files over 300 lines touched – check cohesion before adding logic (§7):$hint"
  [ -n "$big500$big800$big1000" ] && ok "files over 500 lines in the diff:$big500$big800$big1000"
else
  warn "size gate skipped: no base ref (set BASE_REF=origin/<base>)"
fi
if has_section "Dateigrößen"; then
  sec="$(section 'Dateigrößen')"
  A="$(printf '%s\n' "$sec" | awk '/^Über 800/{exit} {print}')"
  B="$(printf '%s\n' "$sec" | awk '/^Neue Shared/{f=1} f')"
  over="$(printf '%s\n' "$sec" | grep -E '^Über 800' | head -1 | sed -E 's/^Über 800.*\(P1\/P2\):[[:space:]]*//')"
  na="$(printf '%s\n' "$A" | grep -cE '^- \[[xX]\]')"; at="$(printf '%s\n' "$A" | grep -E '^- \[[xX]\]' | head -1)"
  nb="$(printf '%s\n' "$B" | grep -cE '^- \[[xX]\]')"; bt="$(printf '%s\n' "$B" | grep -E '^- \[[xX]\]' | head -1)"
  [ "$na" -eq 1 ] || fail "Dateigrößen: exactly one decision for files over 500 lines required, found $na (§7)"
  [ "$nb" -eq 1 ] || fail "Dateigrößen: exactly one answer for new shared component / utility / adapter / service required, found $nb (§7)"
  if [ -n "$big500$big800$big1000" ] && printf '%s' "$at" | grep -qiE '\] *keine'; then
    fail "Dateigrößen: the diff touches files over 500 lines but \"keine\" is checked – decide: keep deliberately (reason), split in this PR, or follow-up issue (§7):$big500$big800$big1000"
  fi
  if [ -n "$big800$big1000" ]; then
    if [ -z "$(printf '%s' "$over" | tr -d '[:space:]')" ] || printf '%s' "$over" | grep -qiE '^(nicht betroffen|<)'; then
      fail "Dateigrößen: files over 800 lines touched –$big800$big1000 – a justified exception or an accompanying split is required (§7)"
    elif [ -n "$big1000" ] && { [ "$stage" = "internal" ] || [ "$stage" = "production" ]; } && ! printf '%s' "$over" | grep -qE '#[0-9]+|ADR'; then
      fail "Dateigrößen: files over 1000 lines in a P1/P2 project are an architecture finding – name the issue (#nr) or ADR:$big1000 (§7)"
    else
      ok "size gate: files over 800 lines justified: $over"
    fi
  elif [ -n "$big1000" ]; then
    warn "files over 1000 lines touched (P0 – no finding required yet):$big1000"
  fi
  if [ -n "$newshared" ]; then
    if printf '%s' "$bt" | grep -qiE '\] *nein'; then
      fail "before creating: new shared/utility/adapter/service file(s) added –$newshared – but \"nein\" is checked; search for existing functionality and state what you searched and found (§7)"
    else
      v="$(printf '%s' "$bt" | sed -E 's/.*gesucht nach:[[:space:]]*//')"
      if [ -z "$(printf '%s' "$v" | tr -d '[:space:]')" ] || printf '%s' "$v" | grep -q '^<'; then fail "before creating: \"ja\" needs what was searched and what was found (§7)"
      else ok "before creating: search documented for$newshared"; fi
    fi
  fi
elif [ -n "$big500$big800$big1000$newshared" ]; then
  fail "section \"## Dateigrößen\" missing although the diff touches large or new shared files – PR template outdated? (§7)"
fi

# --- extra checkbox rules (control center) --------------------------------------------------
IFS='|' read -r -a ex1 <<< "$EXACTLY_ONE"
for h in "${ex1[@]}"; do
  [ -n "$h" ] && has_section "$h" || continue
  n="$(checked_top "$h")"; [ "$n" -eq 1 ] && ok "$h: exactly one" || fail "$h: exactly one box must be checked, found $n"
done
IFS='|' read -r -a al1 <<< "$AT_LEAST_ONE"
for h in "${al1[@]}"; do
  [ -n "$h" ] && has_section "$h" || continue
  n="$(checked_top "$h")"; [ "$n" -ge 1 ] && ok "$h: $n checked" || fail "$h: at least one box must be checked"
done
finish
