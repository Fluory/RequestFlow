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
  // codes only). Exempt: the operator's seed script and deploy step (`setup.ts`) – no tenant data,
  // their messages explain role/connection problems with URLs masked.
  { files: ["src/**/*.{ts,tsx}"], ignores: ["src/seed.ts", "src/setup.ts"], rules: { "no-console": "error" } },
];

export default config;
