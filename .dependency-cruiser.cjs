// Architecture check (ADR-0001 D1, D7) – runs in `pnpm verify` via `pnpm depcruise`.
// A module's public API is its `index.ts`; everything else inside a module is private.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-deep-import-across-modules",
      severity: "error",
      comment: "Import another feature module only through its public entry file src/features/<module>/index.ts.",
      from: { path: "^src/features/([^/]+)/" },
      to: { path: "^src/features/([^/]+)/.+", pathNot: ["^src/features/$1/", "^src/features/[^/]+/index\\.ts$"] },
    },
    {
      name: "no-deep-import-into-modules-from-outside",
      severity: "error",
      comment: "App routes, db and config use feature modules only through src/features/<module>/index.ts.",
      from: { path: "^src/", pathNot: "^src/features/" },
      to: { path: "^src/features/[^/]+/.+", pathNot: "^src/features/[^/]+/index\\.ts$" },
    },
    {
      name: "raw-db-client-only-in-db-and-tenancy",
      severity: "error",
      comment: "No raw database client outside src/db and src/features/tenancy (ADR-0001 D7); features get a tenant-scoped transaction.",
      from: { path: "^src/", pathNot: ["^src/db/", "^src/features/tenancy/", "^src/app/_server/", "\\.test\\.ts$"] },
      to: { path: "(^|/)node_modules/(pg|postgres|drizzle-orm/node-postgres)(/|$)" },
    },
    {
      name: "features-do-not-import-app",
      severity: "error",
      comment: "Feature modules never depend on the Next.js app layer.",
      from: { path: "^src/features/" },
      to: { path: "^src/app/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)\\.next/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
