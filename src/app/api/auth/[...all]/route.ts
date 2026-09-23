import { getRuntime } from "@/app/_server/runtime";

export const dynamic = "force-dynamic";

// Better Auth endpoints (/api/auth/*): sign-in, sign-up (invite-only), session, organization.
// Resolved per request so the build needs no environment.
const handle = (request: Request) => getRuntime().auth.handler(request);

export const GET = handle;
export const POST = handle;
