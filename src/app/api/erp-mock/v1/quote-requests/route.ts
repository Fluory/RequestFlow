import { getRuntime } from "@/app/_server/runtime";
import { createErpMock, MemoryMockStore, parseFaults, type ErpMock } from "@/features/erp-mock";

export const dynamic = "force-dynamic";

// POST /api/erp-mock/v1/quote-requests – the simulated ERP (contracts/erp-export.openapi.yaml,
// ADR-0001 D9). Exists only with ERP_MOCK_ENABLED=true and a configured ERP_TOKEN; otherwise 404.
// Keys live in this process's memory (decision-needed in #9). Bodies are never logged.
const MAX_BODY_BYTES = 64 * 1024;
let mock: ErpMock | undefined;

function enabledMock(): ErpMock | null {
  const { erp } = getRuntime().config;
  if (!erp.mock.enabled || !erp.token) return null;
  mock ??= createErpMock({ token: erp.token, store: new MemoryMockStore(), faults: parseFaults(erp.mock.faults) });
  return mock;
}

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export async function POST(request: Request): Promise<Response> {
  const erp = enabledMock();
  if (!erp) return new Response(null, { status: 404 });
  const declared = request.headers.get("content-length");
  if (!declared || !/^\d+$/.test(declared)) return failure(411, "invalid_request", "Content-Length required");
  if (Number(declared) > MAX_BODY_BYTES) return failure(413, "invalid_request", "body too large");
  return erp.handle(request);
}
