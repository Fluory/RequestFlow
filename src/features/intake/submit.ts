import { randomUUID } from "node:crypto";
import { recordAudit } from "@/features/audit";
import { insertDocuments, type NewDocument } from "@/features/documents";
import { authorize, type Actor } from "@/features/identity";
import { enqueueRequestProcessing } from "@/features/jobs";
import { createRequest, findDuplicate } from "@/features/requests";
import { S3BlobStore } from "@/features/storage";
import type { Tenancy } from "@/features/tenancy";
import { classifyUpload, UploadRejected, type UploadLimits } from "./files";
import { requestFingerprint, sha256Hex } from "./fingerprint";
import { parseMailHeaders } from "./mail-headers";

export interface IntakeDeps {
  tenancy: Tenancy;
  storage: S3BlobStore;
  boss: Pick<import("pg-boss").PgBoss, "send">;
  limits: UploadLimits & { maxFiles: number };
}

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

export interface SubmittedRequest {
  requestId: string;
  possibleDuplicate: boolean;
  duplicateOfId: string | null;
}

/**
 * Upload intake (ADR-0001 D9): validate every file, store the originals privately, then create the
 * request (NEW), its documents, the audit event and the processing job in ONE tenant transaction.
 * If the transaction fails, nothing of it exists and the stored objects are removed again.
 * Exact duplicates are flagged and linked, never discarded.
 */
export async function submitUpload(deps: IntakeDeps, actor: Actor, files: UploadedFile[]): Promise<SubmittedRequest> {
  authorize(actor, "requests.process");
  if (files.length === 0) throw new UploadRejected("Bitte mindestens eine Datei auswählen.");
  if (files.length > deps.limits.maxFiles) throw new UploadRejected(`Höchstens ${deps.limits.maxFiles} Dateien pro Anfrage.`);

  const requestId = randomUUID();
  const classified = files.map((file) => ({ file, meta: classifyUpload(file.name, file.bytes, deps.limits) }));
  const documents: NewDocument[] = classified.map(({ file, meta }) => {
    const id = randomUUID();
    return {
      id,
      requestId,
      filename: meta.filename,
      contentType: meta.contentType,
      kind: meta.kind,
      sizeBytes: file.bytes.byteLength,
      sha256: sha256Hex(file.bytes),
      storageKey: S3BlobStore.documentKey(actor.companyId, requestId, id),
    };
  });
  const mail = classified.find(({ meta }) => meta.kind === "eml");
  const headers = mail ? parseMailHeaders(mail.file.bytes) : { messageId: null, subject: null };
  const fingerprint = requestFingerprint(documents.map((document) => document.sha256));

  const stored: string[] = [];
  try {
    for (const [index, document] of documents.entries()) {
      await deps.storage.put(document.storageKey, classified[index]!.file.bytes, document.contentType);
      stored.push(document.storageKey);
    }
    return await deps.tenancy.withTenant(actor.companyId, async (tx) => {
      const duplicate = await findDuplicate(tx, { messageId: headers.messageId, fingerprint });
      await createRequest(tx, {
        id: requestId,
        createdBy: actor.userId,
        subject: headers.subject ?? documents[0]?.filename ?? null,
        messageId: headers.messageId,
        fingerprint,
        possibleDuplicate: duplicate !== null,
        duplicateOfId: duplicate?.id ?? null,
      });
      await insertDocuments(tx, documents);
      await recordAudit(tx, {
        actorUserId: actor.userId,
        action: "request.uploaded",
        entityType: "request",
        entityId: requestId,
        data: { documents: documents.length, possibleDuplicate: duplicate !== null, duplicateOfId: duplicate?.id ?? null },
      });
      await enqueueRequestProcessing(deps.boss, tx, requestId);
      return { requestId, possibleDuplicate: duplicate !== null, duplicateOfId: duplicate?.id ?? null };
    });
  } catch (error) {
    await Promise.allSettled(stored.map((key) => deps.storage.delete(key)));
    throw error;
  }
}
