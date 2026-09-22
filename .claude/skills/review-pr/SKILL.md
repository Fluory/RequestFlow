---
name: review-pr
description: Reviews a pull request against issue, tests, module boundaries and docs as a fresh, independent session. Use on "Review PR #N", "Is this mergeable?", "Check against issue #N" or whenever the reviewer role is taken. Delivers at most 8 prioritised findings, never changes code.
---

# /review-pr – fresh review against the contract

## Reads only

The issue with its acceptance criteria · the PR description (Arbeitsstand, Impact Manifest, Nachweis, Doku-Entscheidung) and the diff · the affected tests · the area rule in `.claude/rules/` for the touched paths · relevant ADRs and the relevant lines of the architecture map. Not the whole repo, no exploration.

## Checks

- Acceptance criteria met? Non-goals violated? Hidden scope creep?
- Proof matches the pyramid: focused tests for the change, `verify` green (CI), E2E only where UI, browser or system integration is affected, manual proof with step and result where automation makes no sense; no weakened, skipped or fake tests.
- Plan gate answered honestly: a trigger (module boundary, public API, migration, auth/rights, payment/data/infra path, more than two modules, architecture variants, hard to reverse) means an Impact Manifest that matches the diff.
- Module boundaries kept, new files assigned to a module of the architecture map, no deep imports.
- New dependency justified? Security or privacy impact handled? No secrets in the diff?
- Docs decision: exactly one, and the chosen docs really updated in this PR; removed or renamed things grepped.
- Plain-language section understandable for the human.
- Full checklist: `Entwicklungsplan/templates/review-checkliste.md`.

## Result (max. 8 findings, prioritised)

```
[Blocker]   – location – problem – impact – recommendation
[Important] – location – problem – impact – recommendation
[Note]      – location – problem – impact – recommendation
```

Close with a verdict: mergeable per risk matrix · changes requested · needs human approval. Post it as a PR comment and link it in the PR section "Nachweis".

## Limits

- No code changes, no unasked refactors, no change to the requirement – reviewer, not second implementer.
- Merge only per risk matrix (SYSTEM.md §5); hard to reverse or P2 → human approval.
