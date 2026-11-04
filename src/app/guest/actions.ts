"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getJobClient, getRuntime } from "@/app/_server/runtime";
import { createErpClient } from "@/features/export";
import { createGuestAccount, GuestLimitReached } from "@/features/identity";
import { logEvent } from "@/features/observability";
import { currentFieldValues, currentLineItemValues } from "@/features/review";
import { seedSamples } from "@/features/samples";

/**
 * "Ohne Anmeldung ausprobieren" (#126): a guest company of its own with the prepared samples, then
 * signed in. The samples replay recorded answers – no model call; the exported one goes to the
 * configured ERP (on the showcase: the ERP mock route), as `pnpm seed:samples` does.
 */
export async function startGuestAction(): Promise<void> {
  const { config, database, auth, storage, tenancy } = getRuntime();
  if (!config.guests.enabled) redirect("/");
  let account;
  try {
    account = await createGuestAccount(database.db, auth, { maxPerDay: config.guests.maxPerDay });
  } catch (error) {
    if (error instanceof GuestLimitReached) redirect("/?guest=busy");
    throw error;
  }
  try {
    await seedSamples(
      {
        tenancy,
        storage,
        boss: await getJobClient(),
        limits: { ...config.upload, maxPerHour: undefined },
        export: { tenancy, erp: createErpClient(config.erp), fieldValues: currentFieldValues, lineItemValues: currentLineItemValues },
      },
      account.actor,
    );
  } catch (error) {
    // The guest still gets in; the start page then simply has no sample to point to.
    logEvent("error", "guest.samples_failed", { companyId: account.actor.companyId }, { code: error instanceof Error ? error.name : "unknown" });
  }
  await setSessionCookies(account.setCookies, config.auth.baseURL.startsWith("https://"));
  redirect("/");
}

/**
 * Hands the session to the browser. Over HTTPS as `SameSite=None; Secure; Partitioned`, so the guest
 * session also works where the showcase is embedded in another site (portfolio iframe).
 */
async function setSessionCookies(lines: string[], https: boolean): Promise<void> {
  const jar = await cookies();
  for (const line of lines) {
    const [pair = "", ...parts] = line.split(";").map((part) => part.trim());
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const attrs = new Map(parts.map((part) => {
      const [key = "", ...value] = part.split("=");
      return [key.toLowerCase(), value.join("=")] as const;
    }));
    const maxAge = attrs.get("max-age");
    jar.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)), {
      path: attrs.get("path") || "/",
      httpOnly: attrs.has("httponly"),
      ...(maxAge ? { maxAge: Number(maxAge) } : {}),
      ...(https ? { secure: true, sameSite: "none" as const, partitioned: true } : { sameSite: "lax" as const }),
    });
  }
}
