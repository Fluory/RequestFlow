# Roadmap – RequestFlow

> Add-on `saas-auftrag`, phase 3. Milestones have a verifiable acceptance – never "80 % done".
> Work items live in GitHub issues; this file only names the milestones.

| Milestone | Content | Acceptance | Status |
|---|---|---|---|
| **M0 – Problem confirmed** | Discovery, proposal, architecture (ADR-0001), foundation | Proposal sent; §7 approval; foundation PR merged | done – approval 2026-09-22 (`PROJECT-START.md`), ADR-0001 accepted, foundation #20 |
| **M1 – Secure core** | Epic 1 vertical slice: one request end to end (login, tenant isolation, upload, AI extraction with grounding, review, idempotent export) | Slice demo on local Docker; cross-tenant and idempotency tests green | done – epic #2 closed (#21, #31–#37); cross-tenant and exactly-once integration tests run in every `verify` |
| **M2 – Internal beta (pilot)** | Epic 2 full extraction + eval gate, Epic 3 robustness | Pilot acceptance criteria (proposal §7) met with 3–5 test users | built – acceptance pending: epics #17 and #18 closed (#38–#45, follow-ups #53–#63), release v0.1.0 (#86). A reference project has no real test users: acceptance here means the orchestrator walks the §7 criteria on the showcase with the synthetic samples and records the result |
| **M3 – Acceptance-ready** | Findings from the pilot, security review, stage change P1 → P2 prepared | Customer acceptance against agreed thresholds | open |
| **M4 – Production** | Real mailbox + ERP, Entra SSO, monitoring, backup + rehearsed restore, rollback | Release approval by the orchestrator | open |
| **M5 – Expansion** | Further subsidiaries, near-duplicate hints, ops page | Per new brief | open |

The public showcase (Vercel, epic #19) runs ahead of M2 acceptance as a temporary, invite-only exception
(ADR-0001 D11 amendment 2026-09-26, #67).
