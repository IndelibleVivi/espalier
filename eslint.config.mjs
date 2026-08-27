import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const deterministicTimeRules = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Inject time through the canonical clock boundary." },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Inject time through the canonical clock boundary." },
];
const deterministicHostRules = [
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: "Inject randomness instead of reading ambient state." },
  { selector: "MemberExpression[object.name='process'][property.name='env']", message: "Deterministic packages must not read ambient environment state." },
  { selector: "CallExpression[callee.name='fetch']", message: "Deterministic packages must not call the network." },
];
const deterministicSyntaxRules = [...deterministicTimeRules, ...deterministicHostRules];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "artifacts/**", "coverage/**", "test-results/**"] },
  eslint.configs.recommended,
  { ...tseslint.configs.base, files: ["**/*.{ts,tsx,mts}"] },
  { ...tseslint.configs.eslintRecommended, files: ["**/*.{ts,tsx,mts}"] },
  { files: ["**/*.{ts,tsx,mts}"], rules: { "no-unused-vars": "off" } },
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly" } } },
  {
    files: ["apps/cli/src/**/*.ts", "apps/server/src/**/*.ts", "packages/**/*.ts", "scripts/**/*.{ts,mts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: [
      "apps/cli/src/**/*.ts",
      "apps/server/src/**/*.ts",
      "packages/adapters/src/**/*.ts",
      "packages/client/src/**/*.ts",
      "packages/context-compiler/src/**/*.ts",
      "packages/projections/src/**/*.ts",
      "scripts/**/*.{ts,mts}",
    ],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
  {
    files: [
      "packages/protocol/src/**/*.ts",
      "packages/context-compiler/src/**/*.ts",
      "packages/projections/src/**/*.ts",
      "packages/core/src/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "packages/core/src/time.ts"],
    rules: { "no-restricted-syntax": ["error", ...deterministicSyntaxRules] },
  },
  {
    files: ["packages/core/src/time.ts"],
    rules: { "no-restricted-syntax": ["error", ...deterministicHostRules] },
  },
);
