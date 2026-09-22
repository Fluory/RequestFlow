import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output feeds the production image (Dockerfile); the worker runs from the same image.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
