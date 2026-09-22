# Roadmap – RequestFlow

> Add-on `saas-auftrag`, phase 3. Milestones have a verifiable acceptance – never "80 % done".
> Work items live in GitHub issues; this file only names the milestones.

| Milestone | Content | Acceptance | Status |
|---|---|---|---|
| **M0 – Problem confirmed** | Discovery, proposal, architecture (ADR-0001), foundation | Proposal sent; §7 approval; foundation PR merged | in progress |
| **M1 – Secure core** | Epic 1 vertical slice: one request end to end (login, tenant isolation, upload, AI extraction with grounding, review, idempotent export) | Slice demo on local Docker; cross-tenant and idempotency tests green | open |
| **M2 – Internal beta (pilot)** | Epic 2 full extraction + eval gate, Epic 3 robustness | Pilot acceptance criteria (proposal §7) met with 3–5 test users | open |
| **M3 – Acceptance-ready** | Findings from the pilot, security review, stage change P1 → P2 prepared | Customer acceptance against agreed thresholds | open |
| **M4 – Production** | Real mailbox + ERP, Entra SSO, monitoring, backup + rehearsed restore, rollback | Release approval by the orchestrator | open |
| **M5 – Expansion** | Further subsidiaries, near-duplicate hints, ops page | Per new brief | open |

The public showcase (Vercel) follows M2 acceptance (ADR-0001 D11).
