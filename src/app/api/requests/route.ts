import { headers } from "next/headers";
import { currentActor, getJobClient, getRuntime } from "@/app/_server/runtime";
import { AuthorizationError } from "@/features/identity";
import { submitUpload, UploadRejected } from "@/features/intake";

export const dynamic = "force-dynamic";

const problem = (status: number, title: string) => Response.json({ error: { title } }, { status });

// POST /api/requests – multipart upload of one request (field `files`, 1..n files).
// Company and user come from the session, never from the form (ADR-0001 D7).
export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor(await headers());
  if (!actor) return problem(401, "Nicht angemeldet.");
  const { config, tenancy, storage } = getRuntime();

  const declared = Number(request.headers.get("content-length") ?? "0");
  const bodyLimit = config.upload.maxFileBytes * config.upload.maxFiles + 1024 * 1024;
  if (declared > bodyLimit) return problem(413, "Upload zu groß.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return problem(400, "Ungültiger Upload.");
  }
  const files = await Promise.all(
    form
      .getAll("files")
      .filter((entry): entry is File => typeof entry !== "string")
      .map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );

  try {
    const boss = await getJobClient();
    const result = await submitUpload({ tenancy, storage, boss, limits: config.upload }, actor, files);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UploadRejected) return problem(422, error.message);
    if (error instanceof AuthorizationError) return problem(403, "Keine Berechtigung.");
    console.error(JSON.stringify({ level: "error", route: "POST /api/requests", companyId: actor.companyId, message: "upload failed" }));
    return problem(500, "Upload fehlgeschlagen. Bitte erneut versuchen.");
  }
}
