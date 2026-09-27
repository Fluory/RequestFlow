import { describe, expect, it } from "vitest";
import { AiServiceError } from "@/features/extraction";
import { describeFailure } from "./process-request";

// #80: staff read the real cause – a model provider failure is not "our service is unreachable". No text
// promises a retry: it stays when the attempts are used up, and the next retry is shown separately (#70).
describe("describeFailure", () => {
  it.each([
    ["model_error", 502, "Das KI-Modell des Anbieters war nicht verfügbar (z. B. überlastet)."],
    ["model_output_invalid", 502, "Das KI-Modell hat keine verwertbare Antwort geliefert."],
    ["busy", 429, "Der KI-Dienst ist gerade ausgelastet."],
    ["internal_error", 500, "Der KI-Dienst ist vorübergehend gestört."],
    ["unavailable", 503, "Der KI-Dienst ist vorübergehend gestört."],
    ["unreachable", undefined, "Der KI-Dienst ist nicht erreichbar."],
    ["timeout", undefined, "Der KI-Dienst hat nicht rechtzeitig geantwortet."],
  ] as const)("names the cause of a retryable %s", (code, status, text) => {
    expect(describeFailure(new AiServiceError(code, true, "service", status))).toBe(text);
  });

  it("keeps the text for a permanent rejection", () => {
    expect(describeFailure(new AiServiceError("rejected", false, "service", 401))).toBe(
      "Der KI-Dienst hat die Anfrage abgelehnt – bitte die Administration informieren.",
    );
  });

  it("never promises a retry and never names a host or status line", () => {
    for (const code of ["model_error", "model_output_invalid", "busy", "internal_error", "unavailable", "unreachable", "timeout"]) {
      const text = describeFailure(new AiServiceError(code, true, "service", 502));
      expect(text).not.toMatch(/Versuch|http|HTTP|\d{3}/);
    }
  });
});
