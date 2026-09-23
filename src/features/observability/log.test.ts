import { describe, expect, it } from "vitest";
import { captureLogs, logEvent, type LogIds } from "./log";

describe("logEvent (#28)", () => {
  it("writes one JSON line with level, time, event and only the allowed keys – also at runtime", () => {
    const lines: string[] = [];
    const restore = captureLogs(lines);
    try {
      // A spread object with extra properties (e.g. a whole row) must not leak them.
      const sneaky = { requestId: "r-1", email: "einkauf@example.com", subject: "Anfrage" } as LogIds;
      logEvent("warn", "request.error", sneaky, { code: "x", names: ["AI_SERVICE_TOKEN"] });
    } finally {
      restore();
    }

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "warn", event: "request.error", requestId: "r-1", code: "x", names: ["AI_SERVICE_TOKEN"] });
    expect(Object.keys(entry).sort()).toEqual(["code", "event", "level", "names", "requestId", "time"]);
  });
});
