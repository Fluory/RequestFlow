import { describe, expect, it } from "vitest";
import { displayValue } from "./value-label";

// #77: units are stored canonical (the ERP contract), but a German clerk reads "Stk.", not "pcs".
describe("displayValue", () => {
  it("shows the canonical piece unit as Stk.", () => {
    expect(displayValue({ key: "unit", value: "pcs" })).toBe("Stk.");
  });

  it.each(["mm", "cm", "m", "kg", "t", "Paar"])("keeps every other unit as it is (%s)", (value) => {
    expect(displayValue({ key: "unit", value })).toBe(value);
  });

  it("never touches other fields or a missing value", () => {
    expect(displayValue({ key: "description", value: "pcs" })).toBe("pcs");
    expect(displayValue({ key: "unit", value: null })).toBeNull();
  });
});
