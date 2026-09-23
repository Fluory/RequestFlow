// Stand-in for the AI service at its HTTP boundary (E2E only; the real service needs Vertex AI
// credentials). Answers POST /v1/extract with a contract-shaped result for the uploaded mail:
// segments = the body lines, fields quoted from those lines. Synthetic data only.
import { createServer } from "node:http";

const port = Number(process.env.AI_STUB_PORT ?? 8799);
const token = process.env.AI_SERVICE_TOKEN ?? "";

const found = (value, segmentId, quote) => ({ value, status: "found", evidence: { segmentId, quote }, modelStatus: "found", reason: null });
const missing = { value: null, status: "missing", evidence: null, modelStatus: "missing", reason: null };

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    return;
  }
  if (request.method !== "POST" || !request.url?.startsWith("/v1/extract")) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" }).end('{"error":{"code":"unauthorized","message":"x"},"requestId":null}');
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const documentId = /name="documentId"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? "";
    const filePart = body.slice(body.indexOf("\r\n\r\n", body.indexOf('name="file"')) + 4);
    const mailBody = filePart.slice(filePart.indexOf("\r\n\r\n") + 4);
    const lines = mailBody.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("--"));
    const segments = lines.map((text, index) => ({ id: `b${index + 1}`, text, locator: { kind: "email", part: "body", line: index + 1, header: null } }));
    const find = (pattern) => segments.find((segment) => pattern.test(segment.text));
    const company = find(/GmbH|AG/);
    const contact = find(/Ansprechpartner/);
    const date = find(/Liefertermin/);
    const person = contact ? contact.text.split(":")[1].trim() : null;
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        requestId: request.headers["x-request-id"] ?? "e2e",
        documentId,
        documentKind: "eml",
        segments,
        fields: {
          company: company ? found(company.text.trim(), company.id, company.text.trim()) : missing,
          contact_person: contact && person ? found(person, contact.id, person) : missing,
          requested_delivery_date: date ? found("2026-10-15", date.id, "15.10.2026") : missing,
          email: missing,
          phone: missing,
          additional_requirements: missing,
        },
        // "Pos. 1: 1.250 Stk. Flansch DN 100" → one line item quoted from its own line (#25 smoke).
        lineItems: segments
          .filter((segment) => /^Pos\. \d+:/.test(segment.text))
          .map((segment, index) => {
            const [, quantity, unit, description] = /^Pos\. \d+: ([\d.,]+) (\S+) (.+)$/.exec(segment.text) ?? [];
            return {
              index,
              description: description ? found(description, segment.id, description) : missing,
              quantity: quantity ? found(quantity.replace(/\./g, ""), segment.id, quantity) : missing,
              unit: unit ? found(unit === "Stk." ? "pcs" : unit, segment.id, unit) : missing,
              material: missing,
              dimensions: missing,
            };
          }),
        run: {
          modelId: "stub",
          modelVersion: null,
          promptVersion: "extract_v2",
          schemaVersion: "2",
          pdfPipeline: null,
          tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: 1,
          modelLatencyMs: null,
        },
        warnings: [],
      }),
    );
  });
}).listen(port, "127.0.0.1");
