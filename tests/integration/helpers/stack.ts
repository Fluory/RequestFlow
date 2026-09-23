import { randomUUID } from "node:crypto";
import { loadConfig } from "@/config/env";
import { createDatabase, type DatabaseHandle } from "@/db";
import { bootstrapCompany, createAuth, type Auth, type AuthSettings } from "@/features/identity";

// Shared wiring for integration tests: the real app_rw pool, Better Auth over HTTP (auth.handler),
// unique synthetic companies and e-mail addresses per run (the database persists between runs).
export interface Stack {
  database: DatabaseHandle;
  auth: Auth;
  close(): Promise<void>;
}

export function createStack(overrides: Partial<AuthSettings> = {}): Stack {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl, { max: 4 });
  const auth = createAuth(database.db, { ...config.auth, ...overrides });
  return { database, auth, close: () => database.pool.end() };
}

export const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
export const syntheticEmail = (prefix: string) => `${unique(prefix)}@example.com`;
export const PASSWORD = "synthetic-password-123";

let ipCounter = 0;
/** A fresh client IP per call site, so the rate limit of one test never bleeds into another. */
export const freshIp = () => `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}`;

export async function call(
  auth: Auth,
  path: string,
  init: { body?: unknown; cookie?: string; ip?: string; method?: string } = {},
): Promise<{ status: number; body: unknown; cookie: string }> {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://localhost:3000",
    "x-forwarded-for": init.ip ?? freshIp(),
  });
  if (init.cookie) headers.set("cookie", init.cookie);
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  const text = await response.text();
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie };
}

export async function signUp(auth: Auth, email: string) {
  return call(auth, "/sign-up/email", { body: { email, password: PASSWORD, name: "Synthetic User" } });
}

export async function signIn(auth: Auth, email: string, ip?: string) {
  return call(auth, "/sign-in/email", { body: { email, password: PASSWORD }, ip });
}

/** A company with a signed-in first admin. */
export async function companyWithAdmin(stack: Stack) {
  const adminEmail = syntheticEmail("admin");
  const { company } = await bootstrapCompany(stack.database.db, {
    name: `Beispiel Maschinenbau ${unique("co")}`,
    slug: unique("beispiel"),
    adminEmail,
  });
  const signUpResult = await signUp(stack.auth, adminEmail);
  if (signUpResult.status !== 200) throw new Error(`sign-up failed: ${signUpResult.status}`);
  const login = await signIn(stack.auth, adminEmail);
  if (login.status !== 200) throw new Error(`sign-in failed: ${login.status}`);
  return { company, adminEmail, cookie: login.cookie };
}
