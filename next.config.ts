import type { NextConfig } from "next";
import { securityHeaders } from "./src/config/security-headers";

// Security headers on every route (src/config/security-headers.ts). Evaluated at build time (routes manifest).
const headers = securityHeaders({
  baseUrl: process.env.BETTER_AUTH_URL ?? "",
  dev: process.env.NODE_ENV === "development",
  frameAncestors: process.env.FRAME_ANCESTORS ?? "",
});

const nextConfig: NextConfig = {
  // Standalone output feeds the production image (Dockerfile); the worker runs from the same image.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
  // The prepared samples (mails + recorded answers) are read at runtime by the guest start (#126), which
  // runs as a server action of the start page; keep them in every server trace.
  outputFileTracingIncludes: {
    "/": ["./src/features/samples/data/**/*"],
    "/**": ["./src/features/samples/data/**/*"],
  },
};

export default nextConfig;
