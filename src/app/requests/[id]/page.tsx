import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { listDocuments } from "@/features/documents";
import { getRequest } from "@/features/requests";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getRuntime().tenancy.withTenant(actor.companyId, async (tx) => {
    const request = await getRequest(tx, id);
    return request ? { request, documents: await listDocuments(tx, id) } : null;
  });
  if (!data) notFound();
  const { request, documents } = data;
  return (
    <main>
      <p>
        <Link href="/requests">← Anfragen</Link>
      </p>
      <h1>{request.subject ?? "(ohne Betreff)"}</h1>
      <p>Status: {request.status}</p>
      {request.possibleDuplicate && request.duplicateOfId && (
        <p role="note">
          Mögliches Duplikat von <Link href={`/requests/${request.duplicateOfId}`}>dieser Anfrage</Link>.
        </p>
      )}
      <h2>Dokumente</h2>
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            <a href={`/api/documents/${document.id}`}>{document.filename}</a> ({Math.ceil(document.sizeBytes / 1024)} KB)
          </li>
        ))}
      </ul>
    </main>
  );
}
