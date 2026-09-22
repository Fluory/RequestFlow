---
paths:
  - "src/**/api/**"
  - "src/**/routes/**"
  - "src/**/controllers/**"
  - "src/**/handlers/**"
  - "**/openapi*.{yaml,yml,json}"
  - "**/*.contract.*"
  - "contracts/**"
  - "src/app/api/**"
  - "services/ai/src/**/api/**"
  - "src/features/export/**"
  - "src/features/erp-mock/**"
---

# API rules (loaded when API code is read)

- The interface is a promise: change the contract (`docs/technical/api.md` or the OpenAPI file) in the same PR as the code.
- Breaking changes only with a new version (`/v2/`); additive changes stay backwards compatible. Check every schema change for backwards compatibility.
- Every endpoint validates input, uses the project's standard error shape, and has timeouts, rate limits and payload size limits where it is public or expensive.
- Proof at the boundary: a contract or integration test for the touched endpoint runs in `verify`; a public API change needs human approval (SYSTEM.md §5) and triggers the plan gate (§4).
- Never log request bodies with personal data or secrets.
