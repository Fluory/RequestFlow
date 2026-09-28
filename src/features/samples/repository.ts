import { sql } from "drizzle-orm";
import { tenantOf, type TenantTx } from "@/features/tenancy";

/** Another seed run of the same company is still in progress (#93). */
export class SeedRunBusy extends Error {
  constructor() {
    super("Another sample seed run for this company is still in progress – run it again once that one has finished.");
    this.name = "SeedRunBusy";
  }
}

// Waiting ends either way: at our `lock_timeout`, or at a lower `statement_timeout` of pool or role.
const GAVE_UP = new Set(["55P03", "57014"]);

/**
 * One seed run per company at a time (#93). A transaction-level advisory lock – like the duplicate
 * detection's – held by a transaction that stays open for the whole run: safe behind a transaction
 * pooler (Supabase), and released when the run ends or its connection drops. A second run waits up to
 * `timeoutMs`, then stops with `SeedRunBusy`.
 */
export async function lockSeedRun(tx: TenantTx, timeoutMs: number): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${String(Math.max(1, Math.floor(timeoutMs)))}, true)`);
  try {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`seed-samples:${tenantOf(tx)}`}, 0))`);
  } catch (error) {
    const code = (error as { code?: unknown; cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code;
    if (typeof code === "string" && GAVE_UP.has(code)) throw new SeedRunBusy();
    throw error;
  }
}
