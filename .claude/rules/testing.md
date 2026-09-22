---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/*_test.*"
  - "tests/**"
  - "test/**"
  - "**/__tests__/**"
  - "**/test_*.py"
  - "services/ai/tests/**"
  - "services/ai/evals/**"
---

# Testing rules (loaded when tests are read)

- Local work is focused: `verify:changed` after every small change (format, typecheck, tests of the touched files); `verify` before ready-for-review; `verify:full` before a release, for P2 or after risky refactors. Never run the whole suite reflexively after every edit.
- Pyramid: unit for business logic, calculations, permissions and parsers; integration only where the change touches a real system boundary (API, DB, adapter, queue); architecture checks (imports, cycles, layers) in `verify` from P1; E2E only for affected user flows (see frontend-e2e.md); manual proof with step and result in the PR where automation makes no sense.
- Test-first is mandatory for business logic, permission logic, calculations and parsers, reproducible bugfixes and stable API/service contracts; preferred for adapters, DB access, API handlers and providers; a proof of check suffices for UI text, styling, docs, infra/provider config and prototypes.
- No fake tests: a test that cannot fail proves nothing. Mocks only at external I/O boundaries (network, filesystem, time, third parties), never around the logic under test.
- Never weaken, skip or delete a test to get green; a switch that disables a production safeguard for the whole suite is an ADR (SYSTEM.md §11). A failing test follows the stuck protocol (§4), not more attempts with the same hypothesis.
- Test output is trimmed by `scripts/quiet-run.sh` (exit code unchanged, full log path printed); prefix `FLUORY_FULL_OUTPUT=1` once when the cause is unclear.
