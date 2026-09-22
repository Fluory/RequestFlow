# Project brief – RequestFlow

> Add-on `saas-auftrag`, phase 1. Source: [customer request](../input/2026-09-22-kundenanfrage.md),
> discovery in [`PROJECT-START.md`](../../PROJECT-START.md). Reference project: the customer is
> fictional and treated as real; all data is synthetic.

## Problem

The sales team of a mid-sized machine-building company receives about 20–50 quote requests per
day by e-mail. The relevant information sits in the mail body or in PDF, Excel and Word
attachments; staff read every request and copy the data by hand into an internal order overview.

## Users and roles

- **Clerk (sales):** uploads requests, reviews extracted fields beside their source, corrects,
  approves or rejects, sees errors and triggers reprocessing – own company only.
- **Admin (per company):** additionally invites users and assigns roles.
- **System (worker, AI service):** processes, extracts and exports; every action is audited.

## Success (measurable)

Proposed – target values are agreed with the customer at kickoff.
- Pilot users process a request from upload to export without leaving the app.
- No field is shown as *found* without verified evidence in the source document.
- Extraction quality per key field is measured on the eval set and meets the agreed targets.
- Double export and loss on simulated outages are excluded by automated tests.
- Handling time per request is measured against today's baseline.

## Non-goals (pilot)

Real ERP and real mailbox integration, SSO (Entra ID), near-duplicate hints, role-admin UI,
separate ops page, productive rollout (monitoring, rehearsed restore, rollback).

## Risks

- **Data protection:** personal and confidential data reach an LLM – EU endpoint, DPA chain,
  no training, zero data retention for production (ADR-0001 D8).
- **External dependencies:** AI provider outages, model retirement (Gemini 2.5 retires
  2026-10-20) – retries, model ID as configuration, eval gate on every model change.
- **Unclear domain rules:** real field list and ERP semantics are unknown – mock + contract now,
  mapping with the customer after the pilot.
- **Document variety:** scans and table-heavy PDFs may underperform – measured by weighted eval
  cases; docling OCR/table models.
- **AI cost:** capped by rate/upload limits and a 10 €/month GCP budget alert.

## Open decisions

Customer questions: [pilot proposal §9](pilot-vorschlag.md#9-offene-fragen-vor-dem-start).
Implementation verifications: [ADR-0001 → Open points](../decisions/ADR-0001-pilot-architecture.md#open-points).
