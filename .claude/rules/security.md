---
paths:
  - "src/**/auth/**"
  - "src/**/security/**"
  - "src/**/middleware/**"
  - "**/*auth*"
  - "**/*permission*"
  - "**/*session*"
  - "**/*password*"
  - "**/*token*"
  - "src/features/identity/**"
  - "src/features/tenancy/**"
  - "src/features/storage/**"
  - "**/*rls*"
  - "**/*polic*"
  - "src/features/intake/**"
  - "services/ai/src/**/parsing/**"
---

# Security rules (loaded when auth, permission or session code is read)

- Authorization is decided server-side, never only by hiding UI. Every protected action checks the role or ownership close to the data.
- Rate limits at least for login, password reset, registration and expensive endpoints; account recovery is designed deliberately – it is usually the weakest spot.
- Never log secrets, tokens or personal data; error responses carry no internal stack traces.
- Tests use fakes and synthetic data; never real credentials or production data.
- Any change here touches the risk matrix: human approval (SYSTEM.md §5), plan gate (§4), test-first for permission logic (§11), `/security-review` when installed.
