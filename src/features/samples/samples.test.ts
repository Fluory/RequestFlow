import { describe, expect, it } from "vitest";
import { mergeFields } from "@/features/extraction";
import { freshSampleFiles, RECORDED_MODEL_PREFIX, recordedAiClient, SAMPLES, sampleFile, sampleRecording, sampleRecordings } from "./samples";

// Prepared samples (#71): the committed recordings are valid AI answers, and replaying one never looks
// like a live model call. #74: the review sample carries a PDF, so a visitor sees the original page.
const input = (filename: string) => ({ bytes: new Uint8Array(), filename, mediaType: "application/octet-stream", documentId: "doc-42", correlationId: "c" });
const review = SAMPLES.find((sample) => sample.purpose === "review")!;

describe("samples", () => {
  it("has a valid recording for every file, and the review sample shows why a person must check", () => {
    for (const sample of SAMPLES) for (const file of sample.files) expect(() => sampleRecording(file)).not.toThrow();

    const merged = mergeFields([...sampleRecordings(review)].map(([filename, response]) => ({ documentId: filename, response })));
    const statuses = Object.values(merged).map((field) => field.status);
    expect(statuses).toContain("uncertain");
    expect(statuses).toContain("missing");
  });

  it("opens the review sample's first uncertain value on a PDF page with its box (#74)", () => {
    const recordings = sampleRecordings(review);
    const merged = mergeFields([...recordings].map(([filename, response]) => ({ documentId: filename, response })));
    const uncertain = Object.values(merged).find((field) => field.status === "uncertain")!;
    const pdf = review.files.find((file) => file.mediaType === "application/pdf")!;

    expect(uncertain.documentId).toBe(pdf.filename);
    const segment = recordings.get(pdf.filename)!.segments.find((candidate) => candidate.id === uncertain.evidence?.segmentId);
    expect(segment?.locator).toMatchObject({ kind: "pdf", page: 1, bbox: { l: expect.any(Number), t: expect.any(Number), r: expect.any(Number), b: expect.any(Number) } });
  });

  it("replays the recording of the given file, marked as recorded, with no tokens or model time spent", async () => {
    const recordings = sampleRecordings(review);
    const pdf = review.files.find((file) => file.mediaType === "application/pdf")!;
    const recording = recordings.get(pdf.filename)!;

    const answer = await recordedAiClient(recordings).extract(input(pdf.filename));

    expect(answer.documentId).toBe("doc-42");
    expect(answer.run.modelId).toBe(`${RECORDED_MODEL_PREFIX}${recording.run.modelId}`);
    expect(answer.run.latencyMs).toBe(0);
    expect(answer.run.tokens).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
    expect(answer.fields).toEqual(recording.fields);
    expect(answer.segments).toEqual(recording.segments);
    // A file without a recording is an error, never another file's answer.
    await expect(recordedAiClient(recordings).extract(input("fremd.pdf"))).rejects.toThrow("no recording for fremd.pdf");
  });

  it("gives every seeded copy's mail a new Message-ID and changes nothing else", () => {
    const copy = freshSampleFiles(review, "<fresh@example.com>");

    expect(copy.map((file) => file.name)).toEqual(review.files.map((file) => file.filename));
    for (const [index, file] of review.files.entries()) {
      const original = sampleFile(file);
      if (file.mediaType !== "message/rfc822") {
        expect(copy[index]!.bytes).toEqual(original);
        continue;
      }
      const text = new TextDecoder().decode(copy[index]!.bytes);
      expect(text).toContain("Message-ID: <fresh@example.com>");
      expect(text.replace(/^Message-ID: .*$/m, "")).toBe(new TextDecoder().decode(original).replace(/^Message-ID: .*$/m, ""));
      // The header is not evidence: no recorded segment quotes it.
      expect(sampleRecording(file).segments.some((segment) => /Message-ID/i.test(segment.text))).toBe(false);
    }
  });

  it("has exactly one mail per sample – the fresh Message-ID keeps a re-seeded sample from being a duplicate", () => {
    for (const sample of SAMPLES) expect(sample.files.filter((file) => file.mediaType === "message/rfc822")).toHaveLength(1);
  });
});
