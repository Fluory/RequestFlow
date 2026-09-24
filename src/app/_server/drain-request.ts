import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { logEvent } from "@/features/observability";

// Gate of the drain route (#59): `Authorization: Bearer <CRON_SECRET>` – what Vercel Cron sends when
// CRON_SECRET is set. No request body is read and neither the secret nor the presented credential is
// ever logged. Without a configured secret the route does not exist (404).
export interface DrainRequestOptions<T> {
  cronSecret: string | undefined;
  run: () => Promise<T>;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

// Hash both sides first: timingSafeEqual needs equal lengths, and the digest hides the secret's length.
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function isAuthorized(authorization: string | null, secret: string): boolean {
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(presented), digest(secret)) && presented.length > 0;
}

/**
 * Runs `run` via `after()` once the response is sent – only when `enabled` (JOB_DRAIN_INLINE=true).
 * Failures never reach the user's response; they are logged by error class only.
 */
export function scheduleAfterResponse(enabled: boolean, run: () => Promise<unknown>): void {
  if (!enabled) return;
  after(async () => {
    try {
      await run();
    } catch (error) {
      logEvent("error", "jobs.drain_failed", {}, { code: error instanceof Error ? error.name : "unknown" });
    }
  });
}

export async function handleDrainRequest<T>(request: Request, options: DrainRequestOptions<T>): Promise<Response> {
  if (!options.cronSecret) return json(404, { error: { title: "Nicht gefunden." } });
  if (!isAuthorized(request.headers.get("authorization"), options.cronSecret)) {
    logEvent("warn", "jobs.drain_unauthorized", {}, { status: 401 });
    return json(401, { error: { title: "Nicht autorisiert." } }, { "www-authenticate": "Bearer" });
  }
  try {
    return json(200, await options.run());
  } catch (error) {
    // Error messages can quote SQL or connection strings: the class only (IDs/codes rule, #28).
    logEvent("error", "jobs.drain_failed", {}, { code: error instanceof Error ? error.name : "unknown" });
    return json(503, { error: { title: "Verarbeitung derzeit nicht möglich." } });
  }
}
