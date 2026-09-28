import { describe, expect, it } from "vitest";
import { reasonText } from "./reason-label";

// Why a value needs a look, in plain language (#74).
describe("reasonText", () => {
  it("names the verifier's reason", () => {
    expect(reasonText({ reviewStatus: "uncertain", reason: "calendar_week_only" })).toBe("Kalenderwoche ohne Datum – bitte das genaue Datum klären.");
    expect(reasonText({ reviewStatus: "unverified", reason: "quote_not_in_segment" })).toBe("Zitat nicht in der Quelle gefunden.");
    expect(reasonText({ reviewStatus: "uncertain", reason: "ocr_only" })).toBe("Nur per Texterkennung aus einem Scan gelesen – bitte mit dem Original vergleichen.");
  });

  it("falls back to a sentence per status when the reason is absent or unknown", () => {
    expect(reasonText({ reviewStatus: "missing", reason: null })).toBe("In den Unterlagen nicht gefunden.");
    expect(reasonText({ reviewStatus: "uncertain", reason: null })).toBe("Die KI war sich bei diesem Wert nicht sicher.");
    expect(reasonText({ reviewStatus: "unverified", reason: "something_new" })).toBe("Der Wert ließ sich an keiner Fundstelle bestätigen.");
  });

  it("says nothing for a confirmed or corrected value", () => {
    expect(reasonText({ reviewStatus: "found", reason: null })).toBeNull();
    expect(reasonText({ reviewStatus: "corrected", reason: "calendar_week_only" })).toBeNull();
  });
});
