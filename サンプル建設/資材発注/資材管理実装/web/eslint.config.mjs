import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright e2e tests: fixture files use Playwright's `use()` convention
    // (base.extend({ ... async fooPage({ page }, use) => ... })), which the
    // react-hooks/rules-of-hooks lint rule misidentifies as a React hook call.
    "e2e/**",
    "playwright.config.ts",
    // Playwright generated artifacts (traces/reports contain bundled/minified JS).
    "test-results/**",
    "playwright-report/**",
    "e2e-report/**",
    "blob-report/**",
    // Local investigation scripts are intentionally excluded from Git and
    // are not part of the application build.
    "scratch_*",
  ]),
]);

export default eslintConfig;
