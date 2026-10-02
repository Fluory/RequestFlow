# Evidence – what RequestFlow measurably does

> Issue #76 (epic #19). Figures instead of adjectives. **Everything here is synthetic** – the eval cases,
> the two sample requests and every value in them. Scope decided by the orchestrator on 2026-09-28:
> publish what is measurable now; handling time is explicitly **not yet measured**.

## 1. Extraction quality per key field (eval gate)

**What is measured.** 15 synthetic cases (mails, PDFs with tables, scans, missing values, prompt
injection) in `services/ai/evals/`. Each case carries a recorded model response; the replay runs the
**real** pipeline on it – normalisers (numbers, units, dates, calendar weeks) and the grounding
verifier, which marks a value `found` only if its quote is in the cited source segment (ADR-0001 D8).
The gate fails a PR when a key field drops by more than 5 points or an injected value is accepted.

**What it does not measure.** The recorded responses are hand-written, so the table shows how the
pipeline and the verifier treat realistic model output – **not** the accuracy of a live model.

Reproduce: `pnpm evals` (replay, no credentials) on commit `606caec` (2026-10-02); baseline
`services/ai/evals/baseline.json`, last changed in `a2b30c6` (2026-09-24, #50).

| Key field | n | Correct when present (`found_accuracy`) | Missing detected (`missing_recall`) | Claims backed by a quote (`grounding_pass_rate`) | Wrong value marked found (`false_found_rate`) |
|---|---|---|---|---|---|
| Company | 15 | 91.7 % | 100 % | 100 % | 8.3 % |
| Contact person | 15 | 100 % | 100 % | 100 % | 0 % |
| E-mail | 15 | 90.9 % | 75.0 % | 90.9 % | 0 % |
| Phone | 15 | 100 % | 85.7 % | 88.9 % | 0 % |
| Requested delivery date | 15 | 70.0 % | 100 % | 77.8 % | 0 % |
| Additional requirements | 15 | 100 % | 87.5 % | 100 % | 0 % |
| Position: description | 29 | 96.5 % | – | 100 % | 0 % |
| Position: quantity | 29 | 89.7 % | – | 92.9 % | 0 % |
| Position: unit | 29 | 96.5 % | – | 100 % | 0 % |
| Position: material | 29 | 89.3 % | – | 96.4 % | 3.9 % |
| Position: dimensions | 29 | 92.9 % | 100 % | 96.3 % | 0 % |

`n` = cases (header fields) or positions (line items). Definitions: `services/ai/README.md` → Evals.
Denominators are small and uneven (a header field's accuracy rests on 10–12 observations), so one
case moves a figure by 8–10 points. Prompt injection: 2 cases, no injected value accepted. Known limit:
grounding proves where a value comes from, not intent – a model that quotes an injected sentence verbatim
would pass the verifier (pinned by a test, `services/ai/README.md` → Prompt injection); the person
reviewing every value with its quote is the second layer.

## 2. The two sample requests on the showcase

Recorded once from the showcase AI service (Gemini `gemini-3.5-flash`, prompt `extract_v2`, free tier
under the D11 exception) and committed (`src/features/samples/data/*.recording.json`, `d51ad56`,
2026-09-27). Counted from those recordings; every `found` value carries a verified quote.

| Sample | Header fields found / uncertain / missing | Positions | What the clerk must decide |
|---|---|---|---|
| „Werk Ost“ (in review) | 4 / 1 / 1 | 3, all 15 position values found | delivery date given only as a calendar week (`uncertain`, reason `calendar_week_only`); additional requirements not in the mail (`missing`) |
| „Pumpe P204“ (exported) | 6 / 0 / 0 | 2, all 10 position values found | nothing – approved and exported once to the ERP mock |

Corrections a clerk actually makes have **not** been measured: there are no real test users in a
reference project. The table lists what the review screen asks a person to look at.

## 3. Handling time

**Not yet measured.** A protocol (who, which sample, how often, with and without the app) is open;
until then no time saving is claimed.

## 4. Contribution and key decisions

The orchestrator (Fluory) set scope, priorities and every approval; implementation, tests and reviews
were done with Claude Code agents under the rules of `AGENTS.md` (issue → branch → draft PR → fresh
review → human merge). Three decisions carry the product (ADR-0001):

- **A value is `found` only with proof** (D8): the grounding verifier checks the quote in the cited
  segment; everything else is `uncertain`, `missing` or `unverified` and goes to a person.
- **Each approved request reaches the ERP exactly once** (D9): idempotency key + unique export row +
  row lock, proven by integration tests on every PR.
- **Company data stays in its company** (D7): every access runs in a tenant transaction with forced
  row-level security; a guard test fails for any table without it.

## Limits

Synthetic data only · 15 eval cases with hand-written responses · two samples recorded once from a
free-tier model · no real users, no handling-time measurement · scanned-PDF cases run with OCR off in
CI (#49).
