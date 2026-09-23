import { asc, eq } from "drizzle-orm";
import { documents, type DocumentKind } from "@/db/schema";
import { tenantOf, type TenantTx } from "@/features/tenancy";

export interface NewDocument {
  id: string;
  requestId: string;
  filename: string;
  contentType: string;
  kind: DocumentKind;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
}

export type DocumentRow = typeof documents.$inferSelect;

export async function insertDocuments(tx: TenantTx, rows: NewDocument[]): Promise<void> {
  const companyId = tenantOf(tx);
  if (rows.length) await tx.insert(documents).values(rows.map((row) => ({ ...row, companyId })));
}

/** RLS hides other companies' documents: a foreign id simply returns null. */
export async function getDocument(tx: TenantTx, id: string): Promise<DocumentRow | null> {
  tenantOf(tx);
  const [row] = await tx.select().from(documents).where(eq(documents.id, id));
  return row ?? null;
}

export async function listDocuments(tx: TenantTx, requestId: string): Promise<DocumentRow[]> {
  tenantOf(tx);
  return tx.select().from(documents).where(eq(documents.requestId, requestId)).orderBy(asc(documents.createdAt), asc(documents.filename));
}
