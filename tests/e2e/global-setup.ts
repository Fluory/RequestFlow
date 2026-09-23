import { execSync } from "node:child_process";

// Deploy step + demo accounts through the real paths (migrations as owner, invitation → sign-up).
export default function globalSetup(): void {
  execSync("pnpm -s setup:deploy", { stdio: "inherit", env: process.env });
  execSync("pnpm -s seed:demo", { stdio: "inherit", env: process.env });
}
