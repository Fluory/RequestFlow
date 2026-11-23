import { randomBytes, randomUUID } from "node:crypto";
import { gt, sql } from "drizzle-orm";
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
export const GUEST_EMAIL_DOMAIN = "guest.requestflow.invalid";
const GUEST_COMPANY_NAME = "Demo-Firma";

/** Too many guests within 24 h (abuse guard): the start page says the demo is busy. */
export class GuestLimitReached extends Error {
  constructor(readonly maxPerDay: number) {
    super(`at most ${maxPerDay} guests per day`);
    this.name = "GuestLimitReached";
  }
}

/** Too many guests from one client within 24 h: one visitor cannot use up the daily cap of everyone. */
export class GuestClientLimitReached extends Error {
  constructor(readonly maxPerClient: number) {
    super(`at most ${maxPerClient} guests per client and day`);
    this.name = "GuestClientLimitReached";
  }
}

export interface GuestAdmission {
  /** Guest companies per 24 h, all clients together. */
  maxPerDay: number;
  /** Guest companies per 24 h and client. */
  maxPerClient: number;
  /** Keyed hash of the client address (`guestClientKey`), never the address itself. */
  clientKey: string;
}

// One lock for all guest admissions: check and insert run serialised, so concurrent starts can never
// pass the cap together. Transaction-level (released at COMMIT/ROLLBACK – safe with poolers).
const ADMISSION_LOCK = sql`select pg_advisory_xact_lock(hashtext('requestflow.guest-admission'))`;

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
export async function createGuestAccount(db: Database, auth: Auth, admission: GuestAdmission): Promise<GuestAccount> {
  const id = randomUUID();
  const email = `guest-${id}@${GUEST_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");
  const { invitationId } = await bootstrapCompany(
    db,
    { name: GUEST_COMPANY_NAME, slug: `${GUEST_SLUG_PREFIX}${id}`, adminEmail: email, role: "guest" },
    {
      // Cap and per-client brake are checked and the admission recorded in the creating transaction,
      // under one advisory lock: atomic in the database.
      before: async (tx) => {
        await tx.execute(ADMISSION_LOCK);
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [row] = await tx
          .select({
            all: sql<number>`count(*)::int`,
            client: sql<number>`(count(*) filter (where ${schema.guestAdmission.clientKey} = ${admission.clientKey}))::int`,
          })
          .from(schema.guestAdmission)
          .where(gt(schema.guestAdmission.createdAt, since));
        if ((row?.all ?? 0) >= admission.maxPerDay) throw new GuestLimitReached(admission.maxPerDay);
        if ((row?.client ?? 0) >= admission.maxPerClient) throw new GuestClientLimitReached(admission.maxPerClient);
      },
      after: async (tx, company) => {
        await tx.insert(schema.guestAdmission).values({ organizationId: company.id, clientKey: admission.clientKey });
      },
    },
  );
  await auth.api.signUpEmail({ body: { email, password, name: "Gast", invitationId } as { email: string; password: string; name: string } });
  const login = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const setCookies = login.headers.getSetCookie();
  const cookie = setCookies.map((line) => line.split(";")[0]).join("; ");
  const actor = await getActor(auth, db, new Headers({ cookie }));
  if (!actor) throw new Error("guest has no session");
  return { actor, setCookies };
}
