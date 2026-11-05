import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output feeds the production image (Dockerfile); the worker runs from the same image.
  output: "standalone",
  poweredByHeader: false,
  // The prepared samples (mails + recorded answers) are read at runtime by the guest start (#126), which
  // runs as a server action of the start page; keep them in every server trace.
  outputFileTracingIncludes: {
    "/": ["./src/features/samples/data/**/*"],
    "/**": ["./src/features/samples/data/**/*"],
  },
};

export default nextConfig;
