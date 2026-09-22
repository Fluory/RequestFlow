import { describe, expect, it } from "vitest";
import { loadConfig } from "./env";

const valid = {
  DATABASE_URL: "postgres://app_rw:rw-secret@localhost:5432/requestflow",
  S3_ENDPOINT: "http://localhost:8333",
  S3_REGION: "eu-central-1",
  S3_BUCKET: "requestflow-documents",
  S3_ACCESS_KEY_ID: "local-key",
  S3_SECRET_ACCESS_KEY: "s3-secret-value",
};

describe("loadConfig", () => {
  it("returns typed settings when every variable is valid", () => {
    const config = loadConfig(valid);

    expect(config.databaseUrl).toBe(valid.DATABASE_URL);
    expect(config.storage).toEqual({
      endpoint: "http://localhost:8333",
      region: "eu-central-1",
      bucket: "requestflow-documents",
      accessKeyId: "local-key",
      secretAccessKey: "s3-secret-value",
      forcePathStyle: true,
    });
  });

  it("names every missing variable in one error", () => {
    const { DATABASE_URL: _db, S3_BUCKET: _bucket, ...incomplete } = valid;

    expect(() => loadConfig(incomplete)).toThrow(/DATABASE_URL.*S3_BUCKET|S3_BUCKET.*DATABASE_URL/);
  });

  it("rejects a malformed endpoint URL and names the variable", () => {
    expect(() => loadConfig({ ...valid, S3_ENDPOINT: "not a url" })).toThrow(/S3_ENDPOINT/);
  });

  it("never puts secret values into the error message", () => {
    const broken = { ...valid, S3_ENDPOINT: "not a url" };

    let message = "";
    try {
      loadConfig(broken);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toMatch(/rw-secret|s3-secret-value|local-key/);
  });

  it("reads S3_FORCE_PATH_STYLE=false as false", () => {
    expect(loadConfig({ ...valid, S3_FORCE_PATH_STYLE: "false" }).storage.forcePathStyle).toBe(false);
  });
});
