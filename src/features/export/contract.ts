import { z } from "zod";
import type { components } from "./erp-export.contract";

// Runtime schemas of contracts/erp-export.openapi.yaml (types generated in ./erp-export.contract.ts).
// `strict` mirrors `additionalProperties: false`; the `satisfies` checks below break the build when the
// generated types and these schemas drift apart.
export type QuoteRequest = components["schemas"]["QuoteRequest"];
export type QuoteRequestReceipt = components["schemas"]["QuoteRequestReceipt"];

const text = (max: number) => z.string().max(max).nullable();

export const quoteRequestSchema = z.strictObject({
  requestId: z.uuid(),
  subject: text(300),
  approvedAt: z.iso.datetime({ offset: true }),
  fields: z.strictObject({ company: text(500), contactPerson: text(500), requestedDeliveryDate: text(500) }),
});

export const receiptSchema = z.strictObject({
  erpReference: z.string().min(1).max(64),
  requestId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: true }),
});

export const errorCodes = ["invalid_request", "unauthorized", "idempotency_conflict", "unavailable"] as const;
export const errorSchema = z.strictObject({ error: z.strictObject({ code: z.enum(errorCodes), message: z.string() }) });

// Compile-time drift guard: parsed values must be assignable to the generated contract types.
type Assignable<A, B> = A extends B ? true : never;
export const contractGuards: [Assignable<z.infer<typeof quoteRequestSchema>, QuoteRequest>, Assignable<z.infer<typeof receiptSchema>, QuoteRequestReceipt>] = [true, true];
