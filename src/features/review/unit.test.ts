import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalUnit, UNIT_SPELLINGS } from "./unit";

// A unit correction reads like the extraction (#96): known spellings become the ERP unit.
describe("canonicalUnit", () => {
  it("folds the German and English spellings to the ERP unit", () => {
    for (const typed of ["Stk.", "Stk", "stück", "Stueck", "St.", "PCS", " Stck. "]) expect(canonicalUnit(typed), typed).toBe("pcs");
    expect(canonicalUnit("Meter")).toBe("m");
    expect(canonicalUnit("Kilogramm")).toBe("kg");
    expect(canonicalUnit("mm")).toBe("mm");
  });

  it("leaves an unknown unit to the caller", () => {
    expect(canonicalUnit("Rolle")).toBeNull();
    expect(canonicalUnit("Stk..")).toBeNull();
    expect(canonicalUnit("")).toBeNull();
  });

  it("uses exactly the spellings of the AI service, so a correction and an extraction never differ", () => {
    const source = readFileSync(new URL("../../../services/ai/src/requestflow_ai/grounding/values.py", import.meta.url), "utf8");
    const block = /_UNIT_SPELLINGS: dict\[str, tuple\[str, \.\.\.\]\] = \{\n([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(block, "the unit table moved – update this test and src/features/review/unit.ts").toBeDefined();
    const python = Object.fromEntries(
      block!.split("\n").map((line) => {
        const [, canonical, spellings] = /^\s*"(\w+)": \((.*)\),$/.exec(line) ?? [];
        return [canonical, [...(spellings ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1])];
      }),
    );

    expect(UNIT_SPELLINGS).toEqual(python);
  });
});
