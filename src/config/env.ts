import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  AUTH_IP_HEADERS: z.string().default("x-forwarded-for"),
  AUTH_TRUSTED_PROXIES: z.string().default(""),
  // Deployment environment – set explicitly everywhere (compose, CI, .env). Only `local` may use the
  // committed local-default secret.
  APP_ENV: z.enum(["local", "showcase", "production"]),
  UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(10),
  AI_SERVICE_URL: z.url().default("http://127.0.0.1:8000"),
  AI_SERVICE_TOKEN: z.string().min(24).optional(),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  UPLOAD_MAX_REQUEST_BYTES: z.coerce.number().int().positive().default(40 * 1024 * 1024),
  // ERP port (ADR-0001 D9). The pilot points ERP_BASE_URL at the in-app mock.
  ERP_BASE_URL: z.url().default("http://127.0.0.1:3000/api/erp-mock"),
  ERP_TOKEN: z.string().min(24).optional(),
  ERP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ERP_MOCK_ENABLED: z.enum(["true", "false"]).default("false"),
  ERP_MOCK_FAULTS: z.string().default(""),
});

const LOCAL_PLACEHOLDER_SECRETS = new Set(["local-dev-only-secret-change-me-0123456789"]);
const LOCAL_PLACEHOLDER_ERP_TOKENS = new Set(["local-dev-only-erp-token-0123456789"]);
const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export interface AppConfig {
  databaseUrl: string;
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  auth: {
    secret: string;
    baseURL: string;
    ipAddressHeaders: string[];
    trustedProxies: string[];
  };
  aiService: {
    baseUrl: string;
    token: string | undefined;
    timeoutMs: number;
  };
  upload: {
    maxFileBytes: number;
    maxFiles: number;
    maxRequestBytes: number;
  };
  erp: {
    baseUrl: string;
    token: string | undefined;
    timeoutMs: number;
    mock: { enabled: boolean; faults: string };
  };
}

// Errors list variable names only – values may be secrets and end up in logs.
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new Error(`Invalid or missing configuration: ${names.join(", ")}`);
  }
  const env = parsed.data;
  // The committed local default must never sign sessions of a real deployment.
  if (env.APP_ENV !== "local" && LOCAL_PLACEHOLDER_SECRETS.has(env.BETTER_AUTH_SECRET)) {
    throw new Error("Invalid or missing configuration: BETTER_AUTH_SECRET");
  }
  // The committed ERP token would let anyone post to an enabled mock of a public deployment.
  if (env.APP_ENV !== "local" && env.ERP_TOKEN && LOCAL_PLACEHOLDER_ERP_TOKENS.has(env.ERP_TOKEN)) {
    throw new Error("Invalid or missing configuration: ERP_TOKEN");
  }
  return {
    databaseUrl: env.DATABASE_URL,
    storage: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    },
    auth: {
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      ipAddressHeaders: list(env.AUTH_IP_HEADERS),
      trustedProxies: list(env.AUTH_TRUSTED_PROXIES),
    },
    aiService: { baseUrl: env.AI_SERVICE_URL, token: env.AI_SERVICE_TOKEN, timeoutMs: env.AI_SERVICE_TIMEOUT_MS },
    upload: { maxFileBytes: env.UPLOAD_MAX_FILE_BYTES, maxFiles: env.UPLOAD_MAX_FILES, maxRequestBytes: env.UPLOAD_MAX_REQUEST_BYTES },
    erp: {
      baseUrl: env.ERP_BASE_URL,
      token: env.ERP_TOKEN,
      timeoutMs: env.ERP_TIMEOUT_MS,
      mock: { enabled: env.ERP_MOCK_ENABLED === "true", faults: env.ERP_MOCK_FAULTS },
    },
  };
}
