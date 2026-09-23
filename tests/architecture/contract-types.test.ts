import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { describe, expect, it } from "vitest";

// Contract test (ADR-0001 D8): the TS types of the AI service are generated from
// contracts/ai-service.openapi.yaml. If the contract changes without `pnpm contract:types`, this fails.
const root = new URL("../../", import.meta.url);

describe("AI service contract types", () => {
  it("are up to date with contracts/ai-service.openapi.yaml", async () => {
    const committed = readFileSync(new URL("src/features/extraction/ai-service.contract.ts", root), "utf8");

    const generated = astToString(await openapiTS(new URL("contracts/ai-service.openapi.yaml", root)));

    expect(committed.includes(generated.trim())).toBe(true);
  });

  it("carries the four verified field states – found only after grounding", () => {
    const committed = readFileSync(fileURLToPath(new URL("src/features/extraction/ai-service.contract.ts", root)), "utf8");

    expect(committed).toContain('status: "found" | "uncertain" | "missing" | "unverified"');
  });
});
