import { execSync } from "node:child_process";

// Deploy step + demo accounts + prepared samples (#71) through the real paths (migrations as owner,
// invitation → sign-up; samples via intake, processing with the recording, approval, export).
export default function globalSetup(): void {
  execSync("pnpm -s setup:deploy", { stdio: "inherit", env: process.env });
  execSync("pnpm -s seed:demo", { stdio: "inherit", env: process.env });
  execSync("pnpm -s seed:samples", { stdio: "inherit", env: process.env });
}
