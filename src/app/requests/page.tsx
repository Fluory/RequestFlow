import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentActor, getRuntime } from "@/app/_server/runtime";
import { listRequests } from "@/features/requests";
import { requestStatusLabel } from "./status-labels";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });

export default async function RequestsPage() {
  const actor = await currentActor(await headers());
  if (!actor) redirect("/login");
  const requests = await getRuntime().tenancy.withTenant(actor.companyId, (tx) => listRequests(tx));
  return (
    <main>
      <h1>Anfragen</h1>
      <UploadForm />
      {requests.length === 0 ? (
        <p>Noch keine Anfragen.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Eingang</th>
              <th scope="col">Betreff</th>
              <th scope="col">Status</th>
              <th scope="col">Hinweis</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{dateFormat.format(request.createdAt)}</td>
                <td>
                  <Link href={`/requests/${request.id}`}>{request.subject ?? "(ohne Betreff)"}</Link>
                </td>
                <td>{requestStatusLabel(request.status)}</td>
                <td>{request.possibleDuplicate ? "Mögliches Duplikat" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
