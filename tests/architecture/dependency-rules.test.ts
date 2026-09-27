import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/depcruise", import.meta.url));
// Node runs the package's own entry: `node_modules/.bin/depcruise` is a POSIX shell shim that Windows
// cannot spawn without a shell (ENOENT, #78).
const bin = `${root}node_modules/dependency-cruiser/bin/dependency-cruiser.mjs`;

// Runs the real dependency-cruiser with the project's config against a fixture tree that
// contains one deliberate deep import across modules.
function cruise(entry: string) {
  const result = spawnSync(process.execPath, [bin, entry, "--config", `${root}.dependency-cruiser.cjs`, "--no-progress", "--output-type", "err"], {
    cwd: fixture,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Each case starts a real dependency-cruiser run: up to ~5 s on Windows (#87 review), ~1 s on Linux CI.
describe("module boundary rules", { timeout: 20_000 }, () => {
  it("rejects a deep import into another module's internals", () => {
    const { status, output } = cruise("src/features/alpha");

    expect(status).not.toBe(0);
    expect(output).toContain("no-deep-import-across-modules");
    expect(output).toContain("src/features/beta/internal.ts");
  });

  it("rejects a raw database client in a feature module", () => {
    const { status, output } = cruise("src/features/delta");

    expect(status).not.toBe(0);
    expect(output).toContain("raw-db-client-only-in-db-and-tenancy");
  });

  it("rejects a deep import through the @/ path alias", () => {
    const { status, output } = cruise("src/features/epsilon");

    expect(status).not.toBe(0);
    expect(output).toContain("no-deep-import-across-modules");
  });

  it("rejects a feature module opening its own database connection", () => {
    const { status, output } = cruise("src/features/zeta");

    expect(status).not.toBe(0);
    expect(output).toContain("no-db-connection-in-features");
  });

  it("rejects a feature module opening its own pg-boss pool", () => {
    const { status, output } = cruise("src/features/eta");

    expect(status).not.toBe(0);
    expect(output).toContain("no-db-connection-in-features");
  });

  it("accepts an import through the other module's index.ts", () => {
    const { status, output } = cruise("src/features/gamma");

    expect(output).not.toContain("no-deep-import-across-modules");
    expect(status).toBe(0);
  });
});
