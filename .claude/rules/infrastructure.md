---
paths:
  - "infra/**"
  - "terraform/**"
  - "deploy/**"
  - "k8s/**"
  - "**/Dockerfile*"
  - "**/docker-compose*"
  - ".github/workflows/**"
  - "**/*.tf"
  - "**/compose*.y*ml"
  - "vercel.ts"
  - "vercel.json"
---

# Infrastructure rules (loaded when infra or CI code is read)

- Infrastructure only as code with a mirror in the repo – no click configuration.
- Separate secrets per environment, only in the secret manager or CI secrets; never in git, chat, logs or prompts.
- Least privilege: CI and agents get only the rights for exactly their job; development agents never touch production.
- Changes to infrastructure, CI, hooks or security checks are named explicitly in the PR plain-language section and need human approval (SYSTEM.md §5); larger changes go to staging first; the rollback path is documented in `docs/technical/operations.md`.
- Keep the base CI cheap: PR-only, `cancel-in-progress`, `timeout-minutes`, Linux only, no workflow-wide `paths-ignore` on the mandatory check (SYSTEM.md §11).
