import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as download } from "@/app/api/documents/[id]/route";
import { POST as upload } from "@/app/api/requests/route";
import { getJobClient, getRuntime } from "@/app/_server/runtime";
import { listDocuments } from "@/features/documents";
import { companyWithAdmin, createStack, unique, type Stack } from "./helpers/stack";

// The HTTP boundary of intake: session → actor → tenant. Uses the web process's own runtime
// (same env as `next start`), so the routes run exactly as deployed.
describe("upload and download routes", () => {
  let stack: Stack;
  let cookieA: string;
  let cookieB: string;
  let companyA: string;

  const pdf = (marker: string) => new File([`%PDF-1.7\n% synthetic ${marker}\n`], "anfrage.pdf", { type: "application/pdf" });
  // Serialise like a browser does, including Content-Length (the route refuses uploads without it).
  const post = async (cookie: string | null, files: File[], override: { contentLength?: string | null } = {}) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const encoded = new Response(form);
    const body = new Uint8Array(await encoded.arrayBuffer());
    const headers = new Headers({ "content-type": encoded.headers.get("content-type")! });
    const length = override.contentLength === undefined ? String(body.byteLength) : override.contentLength;
    if (length !== null) headers.set("content-length", length);
    if (cookie) headers.set("cookie", cookie);
    return upload(new Request("http://localhost:3000/api/requests", { method: "POST", body, headers }));
  };
  const get = (cookie: string | null, id: string) =>
    download(new Request(`http://localhost:3000/api/documents/${id}`, { headers: cookie ? { cookie } : {} }), {
      params: Promise.resolve({ id }),
    });

  beforeAll(async () => {
    stack = createStack();
    const a = await companyWithAdmin(stack);
    const b = await companyWithAdmin(stack);
    cookieA = a.cookie;
    cookieB = b.cookie;
    companyA = a.company.id;
  });

  afterAll(async () => {
    await (await getJobClient()).stop({ graceful: false });
    await getRuntime().database.pool.end();
    await stack.close();
  });

  it("accepts an upload of a signed-in user and serves the original only to the same company", async () => {
    const marker = unique("route");
    const created = await post(cookieA, [pdf(marker)]);
    expect(created.status).toBe(201);
    const { requestId } = (await created.json()) as { requestId: string };
    const [document] = await getRuntime().tenancy.withTenant(companyA, (tx) => listDocuments(tx, requestId));

    const own = await get(cookieA, document!.id);
    const foreign = await get(cookieB, document!.id);
    const anonymous = await get(null, document!.id);

    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await own.text()).toContain(marker);
    expect(foreign.status).toBe(404);
    expect(anonymous.status).toBe(401);
  });

  it("rejects an anonymous upload and a disallowed type with a clear message", async () => {
    expect((await post(null, [pdf("x")])).status).toBe(401);

    const rejected = await post(cookieA, [new File(["MZ"], "tool.exe")]);

    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as { error: { title: string } }).error.title).toMatch(/Dateityp nicht erlaubt/);
  });

  it("refuses uploads without Content-Length (411), above the request cap (413) and with too many files (422)", async () => {
    expect((await post(cookieA, [pdf("a")], { contentLength: null })).status).toBe(411);
    expect((await post(cookieA, [pdf("b")], { contentLength: String(1024 * 1024 * 1024) })).status).toBe(413);

    const tooMany = await post(cookieA, Array.from({ length: 11 }, (_, i) => pdf(`many-${i}`)));

    expect(tooMany.status).toBe(422);
  });

  it("answers 404 for a malformed document id", async () => {
    expect((await get(cookieA, "../../etc/passwd")).status).toBe(404);
  });
});
