import { describe, expect, it } from "vitest";
import { ERP_LIMITS, exportLimitViolations } from "./payload";

const header = { company: "Musterbau Beispiel GmbH", contact_person: "Erika Beispiel", requested_delivery_date: "2026-10-15" };
const item = (description: string | null = "Flansch DN 100") => ({ description, quantity: "1250", unit: "pcs", material: null, dimensions: null });

describe("exportLimitViolations (ERP contract 1.1.0, #46)", () => {
  it("accepts a request with and without positions inside the limits", () => {
    expect(exportLimitViolations("Anfrage", header)).toEqual([]);
    expect(exportLimitViolations("Anfrage", header, [item(), item("Dichtung DN 100")])).toEqual([]);
  });

  it("names an overlong position value by position and field", () => {
    expect(exportLimitViolations("Anfrage", header, [item(), item("x".repeat(ERP_LIMITS.field + 1))])).toEqual(["item 2 description"]);
  });

  it("refuses more positions than the ERP accepts", () => {
    const items = Array.from({ length: ERP_LIMITS.lineItems + 1 }, () => item("F"));
    expect(exportLimitViolations("Anfrage", header, items)).toContain("lineItems");
  });

  it("refuses a body the ERP would reject as too large, even when every value is within its own limit", () => {
    const items = Array.from({ length: ERP_LIMITS.lineItems }, () => ({ description: "d".repeat(400), quantity: "q".repeat(400), unit: null, material: null, dimensions: null }));
    expect(exportLimitViolations("Anfrage", header, items)).toEqual(["body"]);
  });

  it("still ignores header fields the ERP never receives", () => {
    expect(exportLimitViolations("Anfrage", { ...header, additional_requirements: "x".repeat(ERP_LIMITS.field + 1) })).toEqual([]);
  });
});
