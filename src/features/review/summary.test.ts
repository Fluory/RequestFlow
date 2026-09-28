import { describe, expect, it } from "vitest";
import { summarizeReview, type SummaryCorrection, type SummaryField } from "./summary";

// #77: the list shows customer and need for review per request – with the SAME rules as the review page
// (corrections win; an item correction made before a newer run does not count; attention = uncertain or
// unverified, like "n Werte brauchen Aufmerksamkeit" on the detail page).
const runAt = new Date("2026-09-28T10:00:00Z");
const field = (fieldKey: string, status: SummaryField["status"], value: string | null = "x", itemIndex: number | null = null): SummaryField => ({
  fieldKey,
  itemIndex,
  value,
  status,
});
const correction = (fieldKey: string, newValue: string, createdAt: Date, itemIndex: number | null = null): SummaryCorrection => ({ fieldKey, itemIndex, newValue, createdAt });

describe("summarizeReview", () => {
  it("has nothing to say before an extraction exists", () => {
    expect(summarizeReview(null, [])).toEqual({ company: null, attention: 0, missing: 0 });
  });

  it("takes the customer from the extracted company, or from its latest correction", () => {
    const run = { createdAt: runAt, fields: [field("company", "found", "Beispiel Anlagenbau GmbH")] };

    expect(summarizeReview(run, []).company).toBe("Beispiel Anlagenbau GmbH");
    expect(
      summarizeReview(run, [correction("company", "Erste Korrektur GmbH", new Date("2026-09-28T11:00:00Z")), correction("company", "Beispiel Anlagenbau GmbH & Co. KG", new Date("2026-09-28T12:00:00Z"))]).company,
    ).toBe("Beispiel Anlagenbau GmbH & Co. KG");
  });

  it("counts uncertain and unverified values of header fields and positions, like the review page", () => {
    const run = {
      createdAt: runAt,
      fields: [field("company", "found"), field("requested_delivery_date", "uncertain"), field("email", "unverified"), field("quantity", "uncertain", "12", 0), field("unit", "found", "pcs", 0)],
    };

    expect(summarizeReview(run, []).attention).toBe(3);
  });

  it("does not count a corrected value, but still counts a position corrected before a newer run", () => {
    const run = { createdAt: runAt, fields: [field("requested_delivery_date", "uncertain"), field("quantity", "uncertain", "12", 0), field("material", "uncertain", "PTFE", 1)] };

    const summary = summarizeReview(run, [
      correction("requested_delivery_date", "2026-11-20", new Date("2026-09-28T11:00:00Z")),
      correction("quantity", "10", new Date("2026-09-28T09:00:00Z"), 0), // before the run: not mapped onto it
      correction("material", "Graphit", new Date("2026-09-28T11:00:00Z"), 1),
    ]);

    expect(summary.attention).toBe(1);
  });

  it("counts missing header fields – also those the run did not return – unless corrected", () => {
    const run = { createdAt: runAt, fields: [field("company", "found"), field("contact_person", "found"), field("email", "found"), field("phone", "found"), field("additional_requirements", "missing", null)] };

    expect(summarizeReview(run, []).missing).toBe(2); // additional_requirements + requested_delivery_date (absent)
    expect(summarizeReview(run, [correction("additional_requirements", "Zeugnis 3.1", new Date("2026-09-28T11:00:00Z"))]).missing).toBe(1);
  });
});
