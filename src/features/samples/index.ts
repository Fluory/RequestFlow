// Public API of the `samples` module (#71): prepared showcase cases from recorded AI answers.
export {
  freshSampleFiles,
  RECORDED_MODEL_PREFIX,
  recordedAiClient,
  recordingDocumentId,
  recordingFile,
  SAMPLES,
  sampleFile,
  sampleRecording,
  sampleRecordings,
  type Sample,
  type SampleFile,
} from "./samples";
export { seedSamples, type SampleDeps, type SeededSample, type SeedResult } from "./seed";
