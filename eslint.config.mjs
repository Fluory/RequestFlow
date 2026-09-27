import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat config (ESLint 9 – pinned: eslint-plugin-react/jsx-a11y reject ESLint 10).
const config = [
  { ignores: [".next/**", "node_modules/**", ".claude/**", "services/**", "tests/fixtures/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Logs are a data-leak path (#28): application code logs through `logEvent` (fixed key set, IDs and
  // codes only). Exempt: the operator's seed scripts (`seed.ts`, `seed-samples.ts`), the sample recorder
  // (`samples-record.ts`, #71) and the deploy step (`setup.ts`) – they print sample keys, statuses and
  // field statuses of synthetic mails, never tenant data or secrets; setup masks URLs.
  { files: ["src/**/*.{ts,tsx}"], ignores: ["src/seed.ts", "src/seed-samples.ts", "src/samples-record.ts", "src/setup.ts"], rules: { "no-console": "error" } },
];

export default config;
