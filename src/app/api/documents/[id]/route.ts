import { currentActor, getRuntime } from "@/app/_server/runtime";
import { getDocument } from "@/features/documents";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/:id – the only way to read an original (private bucket, no public URLs;
// ADR-0001 D5). A document of another company is indistinguishable from a missing one (404).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await currentActor(request.headers);
  if (!actor) return Response.json({ error: { title: "Nicht angemeldet." } }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: { title: "Nicht gefunden." } }, { status: 404 });

  const { tenancy, storage } = getRuntime();
  const document = await tenancy.withTenant(actor.companyId, (tx) => getDocument(tx, id));
  if (!document) return Response.json({ error: { title: "Nicht gefunden." } }, { status: 404 });

  const bytes = await storage.get(document.storageKey);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "content-type": document.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
