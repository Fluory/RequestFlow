---
paths:
  - "src/**/migrations/**"
  - "prisma/migrations/**"
  - "prisma/schema.prisma"
  - "db/migrations/**"
  - "supabase/migrations/**"
  - "**/alembic/**"
  - "src/db/**"
  - "drizzle.config.*"
---

# Database migration rules (loaded when migration code is read)

- Test every migration locally on a fresh database before the merge; a migration is an explicit deploy step, never a side effect of the app start.
- Every destructive change (drop, rename, type change, new NOT NULL) needs a backup and rollback decision in the PR and runs as expand → migrate → contract so old app and new schema work in parallel.
- Additive, compatible changes may ride in the feature PR (P0/P1); data transfers are their own step.
- Two parallel branches never make competing migrations merge-ready at the same time: merge the first, then rebase the second.
- Commit a git checkpoint before running a migration or generator locally (`/rewind` does not undo them). Migrations are hard to reverse: human approval (SYSTEM.md §5), plan gate (§4).
