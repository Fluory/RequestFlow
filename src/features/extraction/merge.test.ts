import { describe, expect, it } from "vitest";
import { syntheticExtractResponse } from "./fixtures";
import { mergeFields } from "./merge";

const missing = { value: null, status: "missing" as const, evidence: null, modelStatus: "missing" as const, reason: null };
const unverified = { value: "Fremdfirma", status: "unverified" as const, evidence: { segmentId: "s9", quote: "x" }, modelStatus: "found" as const, reason: "quote_not_in_segment" as const };

describe("mergeFields – one value per field across all documents of a request", () => {
  it("prefers a verified value over missing, regardless of document order", () => {
    const mail = { documentId: "mail", response: syntheticExtractResponse("mail", { company: missing }) };
    const pdf = { documentId: "pdf", response: syntheticExtractResponse("pdf") };

    const merged = mergeFields([mail, pdf]);

    expect(merged.company).toMatchObject({ status: "found", value: "Musterbau Beispiel GmbH", documentId: "pdf" });
  });

  it("never lets an unverified value win over a found one", () => {
    const merged = mergeFields([
      { documentId: "a", response: syntheticExtractResponse("a", { company: unverified }) },
      { documentId: "b", response: syntheticExtractResponse("b") },
    ]);

    expect(merged.company).toMatchObject({ status: "found", documentId: "b" });
  });

  it("keeps the first document on a tie (mail body before attachments)", () => {
    const merged = mergeFields([
      { documentId: "first", response: syntheticExtractResponse("first") },
      { documentId: "second", response: syntheticExtractResponse("second") },
    ]);

    expect(merged.contact_person.documentId).toBe("first");
  });

  it("reports missing with no document when no document has the field", () => {
    const merged = mergeFields([{ documentId: "a", response: syntheticExtractResponse("a", { requested_delivery_date: missing }) }]);

    expect(merged.requested_delivery_date).toMatchObject({ status: "missing", value: null, documentId: null });
  });

  it("returns all three header fields as missing when no document could be processed", () => {
    const merged = mergeFields([]);

    expect(Object.values(merged).map((field) => field.status)).toEqual(["missing", "missing", "missing"]);
  });
});
