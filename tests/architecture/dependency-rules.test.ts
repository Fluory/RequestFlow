import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/depcruise", import.meta.url));
const bin = `${root}node_modules/.bin/depcruise`;

// Runs the real dependency-cruiser with the project's config against a fixture tree that
// contains one deliberate deep import across modules.
function cruise(entry: string) {
  const result = spawnSync(bin, [entry, "--config", `${root}.dependency-cruiser.cjs`, "--no-progress", "--output-type", "err"], {
    cwd: fixture,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("module boundary rules", () => {
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

  it("accepts an import through the other module's index.ts", () => {
    const { status, output } = cruise("src/features/gamma");

    expect(output).not.toContain("no-deep-import-across-modules");
    expect(status).toBe(0);
  });
});
