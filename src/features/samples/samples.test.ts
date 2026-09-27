import { describe, expect, it } from "vitest";
import { freshSampleMail, RECORDED_MODEL_PREFIX, recordedAiClient, SAMPLES, sampleMail, sampleRecording } from "./samples";

// Prepared samples (#71): the committed recordings are valid AI answers, and replaying one never looks
// like a live model call.
const input = (documentId: string) => ({ bytes: new Uint8Array(), filename: "x.eml", mediaType: "message/rfc822", documentId, correlationId: "c" });

describe("samples", () => {
  it("has a valid recording for every sample, and the review sample shows why a person must check", () => {
    for (const sample of SAMPLES) expect(() => sampleRecording(sample)).not.toThrow();

    const review = SAMPLES.find((sample) => sample.purpose === "review")!;
    const statuses = Object.values(sampleRecording(review).fields).map((field) => field.status);
    expect(statuses).toContain("uncertain");
    expect(statuses).toContain("missing");
  });

  it("replays the recording for the given document, marked as recorded, with no tokens or model time spent", async () => {
    const recording = sampleRecording(SAMPLES[0]!);

    const answer = await recordedAiClient(recording).extract(input("doc-42"));

    expect(answer.documentId).toBe("doc-42");
    expect(answer.run.modelId).toBe(`${RECORDED_MODEL_PREFIX}${recording.run.modelId}`);
    expect(answer.run.latencyMs).toBe(0);
    expect(answer.run.tokens).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
    expect(answer.fields).toEqual(recording.fields);
  });

  it("gives every seeded copy a new Message-ID and changes nothing else", () => {
    const sample = SAMPLES[0]!;
    const original = new TextDecoder().decode(sampleMail(sample));

    const copy = new TextDecoder().decode(freshSampleMail(sample, "<fresh@example.com>"));

    expect(copy).toContain("Message-ID: <fresh@example.com>");
    expect(copy.replace(/^Message-ID: .*$/m, "")).toBe(original.replace(/^Message-ID: .*$/m, ""));
    // The header is not evidence: no recorded segment quotes it.
    expect(sampleRecording(sample).segments.some((segment) => /Message-ID/i.test(segment.text))).toBe(false);
  });
});
