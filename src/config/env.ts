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
  UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(10),
});

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
  };
  upload: {
    maxFileBytes: number;
    maxFiles: number;
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
    auth: { secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL },
    upload: { maxFileBytes: env.UPLOAD_MAX_FILE_BYTES, maxFiles: env.UPLOAD_MAX_FILES },
  };
}
