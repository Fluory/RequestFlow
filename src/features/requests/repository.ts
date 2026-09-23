import { desc } from "drizzle-orm";
import { requests, type RequestStatus } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";

export interface RequestRow {
  id: string;
  companyId: string;
  status: RequestStatus;
  createdAt: Date;
}

// Repository of the request aggregate. Every function needs a tenant transaction; the company id is
// taken from it, never from the caller – RLS enforces the same rule in the database.
export async function listRequests(tx: TenantTx): Promise<RequestRow[]> {
  tenantOf(tx);
  return tx.select().from(requests).orderBy(desc(requests.createdAt));
}

export async function createRequest(tx: TenantTx): Promise<RequestRow> {
  const companyId = tenantOf(tx);
  const [row] = await tx.insert(requests).values({ companyId }).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}
