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

/**
 * A fresh client IP per call, so the per-IP rate limit of one test never bleeds into another –
 * across test files too. Random /64 prefixes in the IPv6 documentation range (Better Auth collapses
 * IPv6 to /64 before keying).
 */
const group = () => Math.floor(Math.random() * 0x10000).toString(16);
export const freshIp = () => `2001:db8:${group()}:${group()}::1`;

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

export async function signUp(auth: Auth, email: string, invitationId?: string) {
  return call(auth, "/sign-up/email", { body: { email, password: PASSWORD, name: "Synthetic User", invitationId } });
}

export async function signIn(auth: Auth, email: string, ip?: string) {
  return call(auth, "/sign-in/email", { body: { email, password: PASSWORD }, ip });
}

/** A company with a signed-in first admin. */
export async function companyWithAdmin(stack: Stack) {
  const adminEmail = syntheticEmail("admin");
  const { company, invitationId } = await bootstrapCompany(stack.database.db, {
    name: `Beispiel Maschinenbau ${unique("co")}`,
    slug: unique("beispiel"),
    adminEmail,
  });
  await signUp(stack.auth, adminEmail, invitationId);
  const login = await signIn(stack.auth, adminEmail);
  if (login.status !== 200) throw new Error(`sign-in failed: ${login.status}`);
  return { company, adminEmail, cookie: login.cookie };
}

/** Invite a user into the actor's company and sign them in; returns the new user's cookie. */
export async function invitedUser(stack: Stack, admin: import("@/features/identity").Actor, role: "admin" | "clerk") {
  const { inviteUser } = await import("@/features/identity");
  const email = syntheticEmail(role);
  const { invitationId } = await inviteUser(stack.database.db, admin, { email, role });
  await signUp(stack.auth, email, invitationId);
  const login = await signIn(stack.auth, email);
  if (login.status !== 200) throw new Error(`sign-in failed: ${login.status}`);
  return { email, cookie: login.cookie };
}
