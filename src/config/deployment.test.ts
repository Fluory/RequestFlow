import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVERLESS_DRAIN } from "./env";

// vercel.json and the routes' segment config (a literal Next.js reads statically) must agree with the
// budget loadConfig checks – otherwise a drain could be killed mid-job (#59).
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("serverless deployment settings", () => {
  const vercel = JSON.parse(read("vercel.json")) as {
    framework: string;
    functions: Record<string, { maxDuration: number }>;
    crons: Array<{ path: string; schedule: string }>;
  };

  it("gives the drain route the function limit SERVERLESS_DRAIN assumes and a daily cron (Hobby)", () => {
    expect(vercel.framework).toBe("nextjs");
    expect(vercel.functions["src/app/api/jobs/drain/route.ts"]?.maxDuration).toBe(SERVERLESS_DRAIN.maxDurationSeconds);
    expect(vercel.crons).toEqual([{ path: "/api/jobs/drain", schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
  });

  it.each(["src/app/api/jobs/drain/route.ts", "src/app/api/requests/route.ts", "src/app/requests/page.tsx", "src/app/requests/[id]/page.tsx"])(
    "%s exports the same maxDuration (it runs a drain directly or via after())",
    (path) => {
      expect(read(path)).toContain(`export const maxDuration = ${SERVERLESS_DRAIN.maxDurationSeconds};`);
    },
  );

  it("carries no secrets", () => {
    expect(read("vercel.json")).not.toMatch(/secret|token|password|key/i);
  });
});
