import { describe, expect, it } from "vitest";
import { syntheticExtractResponse } from "./fixtures";
import { mergeFields, mergeLineItems } from "./merge";

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

  it("returns all six header fields as missing when no document could be processed", () => {
    const merged = mergeFields([]);

    expect(Object.keys(merged)).toEqual(["company", "contact_person", "email", "phone", "requested_delivery_date", "additional_requirements"]);
    expect(Object.values(merged).map((field) => field.status)).toEqual(["missing", "missing", "missing", "missing", "missing", "missing"]);
  });

  it("keeps line items of all documents in upload order, sorted by their index, without merging them", () => {
    const item = (index: number, description: string) => ({
      index,
      description: { value: description, status: "found" as const, evidence: { segmentId: "s2", quote: description }, modelStatus: "found" as const, reason: null },
      quantity: missing,
      unit: missing,
      material: missing,
      dimensions: missing,
    });
    const first = syntheticExtractResponse("d1", {}, [item(1, "Flansch DN 150"), item(0, "Flansch DN 100")]);
    const second = syntheticExtractResponse("d2", {}, [item(0, "Flansch DN 100")]);

    const items = mergeLineItems([
      { documentId: "d1", response: first },
      { documentId: "d2", response: second },
    ]);

    expect(items.map((entry) => [entry.itemIndex, entry.documentId, entry.fields.description.value])).toEqual([
      [0, "d1", "Flansch DN 100"],
      [1, "d1", "Flansch DN 150"],
      [2, "d2", "Flansch DN 100"],
    ]);
    expect(mergeLineItems([])).toEqual([]);
  });
});
