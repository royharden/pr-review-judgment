// ESLint flat config (ESLint 9 + typescript-eslint 8). Not yet run (DEFERRED-VALIDATION DV-03).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

// Backstop for `erasableSyntaxOnly`: TypeScript constructs Node type stripping cannot erase.
const NON_ERASABLE = [
  { selector: "TSEnumDeclaration", message: "No enum: use a string-literal union or an `as const` object." },
  { selector: "TSModuleDeclaration[kind='namespace']", message: "No namespace: use ES modules." },
  { selector: "TSParameterProperty", message: "No parameter properties: declare fields explicitly." },
  { selector: "Decorator", message: "No decorators." },
];

export default defineConfig(
  {
    // Corpus files are content (authored task code and hidden suites), not repository code.
    ignores: ["dist/**", "node_modules/**", "corpus/**", "fixtures/**", "results/**", "runs/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...NON_ERASABLE],
      // noUncheckedIndexedAccess makes bounded-loop indexing `T | undefined`; `!` there is deliberate and local.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["cli/**/*.ts", "tests/**/*.ts", "*.config.ts", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "No Node builtins in the browser bundle." },
            { group: ["**/cli/**"], message: "The viewer imports src/core only, never cli/." },
            { group: ["**/.heldout/**", "**/hidden/**"], message: "The viewer never reaches held-out data or hidden suites." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...NON_ERASABLE,
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Render code as escaped text." },
      ],
    },
  },
  {
    // src/core is pure: no Node, DOM, React or host I/O, so the viewer and the CLI share it byte for byte.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*", "fs", "path", "crypto", "child_process", "os"], message: "src/core is pure: no Node modules." },
            { group: ["react", "react-dom", "react/*", "react-dom/*"], message: "src/core is pure: no React." },
            { group: ["**/cli/**", "**/app/**"], message: "src/core never imports cli/ or src/app/." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "process", "Buffer", "fetch", "crypto", "localStorage", "require", "TextEncoder", "TextDecoder"].map(
          (name) => ({ name, message: `src/core is pure: inject ${name} from the host instead.` }),
        ),
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Determinism: use the seeded PRNG (src/core/stats, M3)." },
        { object: "Date", property: "now", message: "Determinism: pass time in from the host." },
      ],
    },
  },
);
