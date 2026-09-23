import { sql } from "drizzle-orm";
import type { Database } from "@/db";

// Tenant context (ADR-0001 D7). `withTenant` opens a transaction, sets `app.company_id`
// transaction-locally (safe with poolers: gone at COMMIT/ROLLBACK) and hands out a branded
// transaction. Repositories accept only that brand, so a query without tenant context does not
// compile – and `tenantOf()` re-checks at runtime.
const TENANT = Symbol("tenant");

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type TenantTx = Transaction & { readonly [TENANT]: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MissingTenantError extends Error {
  constructor() {
    super("repository called without tenant context – use withTenant()");
    this.name = "MissingTenantError";
  }
}

export interface Tenancy {
  withTenant<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

export function createTenancy(db: Database): Tenancy {
  return {
    async withTenant(companyId, fn) {
      if (!UUID.test(companyId)) throw new MissingTenantError();
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
        Object.defineProperty(tx, TENANT, { value: companyId, enumerable: false });
        return fn(tx as TenantTx);
      });
    },
  };
}

/** The company of the current tenant transaction; throws if the transaction has no tenant. */
export function tenantOf(tx: TenantTx): string {
  const companyId = (tx as Partial<Record<typeof TENANT, string>>)[TENANT];
  if (!companyId) throw new MissingTenantError();
  return companyId;
}
