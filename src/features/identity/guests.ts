import { randomBytes, randomUUID } from "node:crypto";
import { and, gt, like, sql } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { getActor } from "./actor";
import type { Auth } from "./auth";
import type { Actor } from "./authorize";
import { bootstrapCompany } from "./companies";

// Guest access of the public showcase (#126): one click creates a company of its own with a single
// `guest` member and signs that member in. Guests review, correct, approve and export the prepared
// samples; they never start a live model call (`requests.ingest`, see authorize.ts).
export const GUEST_SLUG_PREFIX = "guest-";
const GUEST_EMAIL_DOMAIN = "guest.requestflow.invalid";
const GUEST_COMPANY_NAME = "Demo-Firma";

/** Too many guests within 24 h (abuse guard): the start page says the demo is busy. */
export class GuestLimitReached extends Error {
  constructor(readonly maxPerDay: number) {
    super(`at most ${maxPerDay} guests per day`);
    this.name = "GuestLimitReached";
  }
}

export interface GuestAccount {
  actor: Actor;
  /** `Set-Cookie` lines of the new session, for the caller to hand to the browser. */
  setCookies: string[];
}

/**
 * A new guest: company (slug `guest-…`), invitation for exactly the guest's address, account and session
 * – through the same invite-only path as every other account. The password is random and never leaves
 * this function; the guest only ever holds the session.
 */
export async function createGuestAccount(db: Database, auth: Auth, options: { maxPerDay: number }): Promise<GuestAccount> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.organization)
    .where(and(like(schema.organization.slug, `${GUEST_SLUG_PREFIX}%`), gt(schema.organization.createdAt, since)));
  if ((row?.count ?? 0) >= options.maxPerDay) throw new GuestLimitReached(options.maxPerDay);

  const id = randomUUID();
  const email = `guest-${id}@${GUEST_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");
  const { invitationId } = await bootstrapCompany(db, { name: GUEST_COMPANY_NAME, slug: `${GUEST_SLUG_PREFIX}${id}`, adminEmail: email, role: "guest" });
  await auth.api.signUpEmail({ body: { email, password, name: "Gast", invitationId } as { email: string; password: string; name: string } });
  const login = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const setCookies = login.headers.getSetCookie();
  const cookie = setCookies.map((line) => line.split(";")[0]).join("; ");
  const actor = await getActor(auth, db, new Headers({ cookie }));
  if (!actor) throw new Error("guest has no session");
  return { actor, setCookies };
}
