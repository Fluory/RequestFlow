import { describe, expect, it } from "vitest";
import { loadConfig, SERVERLESS_DRAIN } from "./env";

const valid = {
  DATABASE_URL: "postgres://app_rw:rw-secret@localhost:5432/requestflow",
  S3_ENDPOINT: "http://localhost:8333",
  S3_REGION: "eu-central-1",
  S3_BUCKET: "requestflow-documents",
  S3_ACCESS_KEY_ID: "local-key",
  S3_SECRET_ACCESS_KEY: "s3-secret-value",
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  APP_ENV: "local",
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

  it("refuses the committed local auth secret outside APP_ENV=local", () => {
    const local = { ...valid, BETTER_AUTH_SECRET: "local-dev-only-secret-change-me-0123456789" };

    expect(() => loadConfig({ ...local, APP_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig({ ...local, APP_ENV: "showcase" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig(local)).not.toThrow();
  });

  it("requires an explicit APP_ENV", () => {
    const { APP_ENV: _env, ...withoutEnv } = valid;

    expect(() => loadConfig(withoutEnv)).toThrow(/APP_ENV/);
  });

  it("reads the client-IP headers and trusted proxies for the auth rate limit as lists", () => {
    const config = loadConfig({ ...valid, AUTH_IP_HEADERS: "x-real-ip, x-forwarded-for", AUTH_TRUSTED_PROXIES: "10.0.0.2" });

    expect(config.auth.ipAddressHeaders).toEqual(["x-real-ip", "x-forwarded-for"]);
    expect(config.auth.trustedProxies).toEqual(["10.0.0.2"]);
  });

  it("accepts an AI-service token only with at least 24 characters", () => {
    expect(loadConfig({ ...valid, AI_SERVICE_TOKEN: "x".repeat(24) }).aiService.token).toHaveLength(24);
    expect(() => loadConfig({ ...valid, AI_SERVICE_TOKEN: "short" })).toThrow(/AI_SERVICE_TOKEN/);
  });

  it("reads the ERP port settings; the mock is off unless ERP_MOCK_ENABLED=true", () => {
    const config = loadConfig({ ...valid, ERP_TOKEN: "t".repeat(24), ERP_TIMEOUT_MS: "5000" });

    expect(config.erp).toEqual({ baseUrl: "http://127.0.0.1:3000/api/erp-mock", token: "t".repeat(24), timeoutMs: 5000, mock: { enabled: false, faults: "" } });
    expect(loadConfig({ ...valid, ERP_MOCK_ENABLED: "true" }).erp.mock.enabled).toBe(true);
    expect(() => loadConfig({ ...valid, ERP_MOCK_ENABLED: "yes" })).toThrow(/ERP_MOCK_ENABLED/);
    expect(() => loadConfig({ ...valid, ERP_TOKEN: "short" })).toThrow(/ERP_TOKEN/);
    expect(() => loadConfig({ ...valid, ERP_TIMEOUT_MS: "20001" })).toThrow(/ERP_TIMEOUT_MS/);
    expect(loadConfig({ ...valid, ERP_MOCK_FAULTS: "503, lost" }).erp.mock.faults).toBe("503, lost");
    expect(() => loadConfig({ ...valid, ERP_MOCK_FAULTS: "500" })).toThrow(/ERP_MOCK_FAULTS/);
  });

  it("refuses the committed local ERP token outside APP_ENV=local", () => {
    const placeholder = "local-dev-only-erp-token-0123456789";

    expect(loadConfig({ ...valid, ERP_TOKEN: placeholder }).erp.token).toBe(placeholder);
    expect(() => loadConfig({ ...valid, APP_ENV: "showcase", BETTER_AUTH_SECRET: "s".repeat(40), ERP_TOKEN: placeholder })).toThrow(/ERP_TOKEN/);
  });

  describe("serverless job drain and demo mode (#59)", () => {
    // Values that fit one processing job into the drain function (60 s × 3 files).
    const fits = { AI_SERVICE_TIMEOUT_MS: "60000", UPLOAD_MAX_FILES: "3" };
    const secret = "c".repeat(32);

    it("keeps the drain route, inline drain and demo banner off by default – empty values count as unset", () => {
      const defaults = loadConfig(valid);
      const empty = loadConfig({ ...valid, CRON_SECRET: "", JOB_DRAIN_INLINE: "", DEMO_MODE: "" });

      expect(defaults.jobs).toEqual({ cronSecret: undefined, drainInline: false });
      expect(defaults.demoMode).toBe(false);
      expect(empty.jobs).toEqual({ cronSecret: undefined, drainInline: false });
      expect(empty.demoMode).toBe(false);
    });

    it("reads CRON_SECRET, JOB_DRAIN_INLINE=true and DEMO_MODE=true", () => {
      const config = loadConfig({ ...valid, ...fits, CRON_SECRET: secret, JOB_DRAIN_INLINE: "true", DEMO_MODE: "true" });

      expect(config.jobs).toEqual({ cronSecret: secret, drainInline: true });
      expect(config.demoMode).toBe(true);
    });

    it("refuses a CRON_SECRET shorter than 24 characters and non-boolean switches, naming only the variable", () => {
      let message = "";
      try {
        loadConfig({ ...valid, ...fits, CRON_SECRET: "too-short-secret" });
      } catch (error) {
        message = String(error);
      }

      expect(message).toMatch(/CRON_SECRET/);
      expect(message).not.toMatch(/too-short-secret/);
      expect(() => loadConfig({ ...valid, JOB_DRAIN_INLINE: "yes" })).toThrow(/JOB_DRAIN_INLINE/);
      expect(() => loadConfig({ ...valid, DEMO_MODE: "1" })).toThrow(/DEMO_MODE/);
    });

    it("refuses a serverless drain whose worst-case processing job cannot finish within the function limit", () => {
      // Defaults: 120 s AI timeout × 10 files – far beyond one 300 s function run.
      expect(() => loadConfig({ ...valid, CRON_SECRET: secret })).toThrow(/AI_SERVICE_TIMEOUT_MS.*UPLOAD_MAX_FILES/);
      expect(() => loadConfig({ ...valid, JOB_DRAIN_INLINE: "true" })).toThrow(/AI_SERVICE_TIMEOUT_MS.*UPLOAD_MAX_FILES/);
      expect(() => loadConfig({ ...valid, ...fits, CRON_SECRET: secret, JOB_DRAIN_INLINE: "true" })).not.toThrow();
      expect(() => loadConfig({ ...valid, AI_SERVICE_TIMEOUT_MS: "60000", UPLOAD_MAX_FILES: "4", CRON_SECRET: secret })).toThrow(/UPLOAD_MAX_FILES/);
    });

    it("keeps the worst case of one drain run within the function limit", () => {
      const { processMs, exportMs, marginMs, maxDurationSeconds } = SERVERLESS_DRAIN;
      const worstCaseMs = processMs + 60_000 * 3 + exportMs + 20_000 + marginMs;

      expect(maxDurationSeconds).toBeLessThanOrEqual(300);
      expect(worstCaseMs).toBeLessThanOrEqual(maxDurationSeconds * 1000);
    });
  });
});
