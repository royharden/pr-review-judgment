# Repository conventions

Established in M1. Later milestones follow them; change them only with a recorded reason.

## Modules and runtime

- ESM only: `"type": "module"`, Node >= 22.
- Relative imports carry the explicit `.ts` extension (`import { x } from "./region.ts"`). Both tsconfigs set
  `allowImportingTsExtensions: true` and `noEmit: true`, so Vite, tsx, vitest and Node's built-in type stripping all
  resolve the import exactly as written. There is no emit step.
- Type-only imports use `import type` / inline `type` specifiers (`verbatimModuleSyntax: true`).

## Erasable TypeScript only

- `erasableSyntaxOnly: true` in both tsconfigs, backed by an ESLint `no-restricted-syntax` rule.
- No `enum`, `namespace`, parameter properties or decorators. Use string-literal unions, `as const` objects and zod
  enums (`z.enum([...])`) instead.
- Every `.ts` file must pass `node --check <file>`. `.tsx` cannot be checked that way and is inspected by reading.
- **`node --check` alone is not a syntax check for ESM TypeScript** (observed on Node 24.18): it first parses the
  *unstripped* source as CommonJS; if the first error is module syntax (`import`/`export`) it exits 0 without
  validating the rest (a file `export const a: number = 1; const bad = ;` passes). If the first error is a type
  annotation before any `import`/`export`, it fails spuriously. Therefore:
  1. Put an `import` or `export` before the first type annotation in every file (otherwise `node --check` fails).
  2. The real static gate is a parse of the stripped output: strip with `require("node:module").stripTypeScriptTypes(
     source, { mode: "strip" })` (throws on syntax errors and on non-erasable syntax such as `enum` or parameter
     properties), write the result to a scratch `.mjs` outside the repo, and run `node --check` on that `.mjs`.
     Nothing from the repository is executed by this check.

## Two TypeScript projects

| Config | Covers | Libs/types |
|---|---|---|
| `tsconfig.json` | `src/**` (viewer and `src/core`) | ES2023 + DOM, no Node types, `jsx: react-jsx` |
| `tsconfig.cli.json` | `cli/**`, `tests/**`, `src/core/**`, `vite.config.ts`, `vitest.config.ts` | ES2023 + `@types/node`, NodeNext |

Both are `strict` with `noUncheckedIndexedAccess`. `src/core` is type-checked under both, so it can use neither
DOM-only nor Node-only APIs.

## `src/core` is pure

- No Node builtins, no DOM, no React, no network, no file system, no `process`, no `Math.random`, no `Date.now`
  (enforced by ESLint for `src/core/**`). Host effects (time, files, fetch, randomness) are injected by `cli/` or
  `src/app/`.
- Hashing uses the pure-TS SHA-256 in `src/core/hash/sha256.ts` (`sha256Hex(string | Uint8Array)`; strings are
  hashed as UTF-8). Content hashes are lowercase 64-hex; structured values are hashed as canonical JSON
  (`src/core/defectcorpus/hashes.ts`: sorted keys, no whitespace).
- Ordering is deterministic and locale-independent (`compareCodeUnits`).

## Naming

- TypeScript identifiers are camelCase; types are PascalCase. zod record schemas end in `Schema`
  (`TaskSchema`) and their inferred type drops the suffix (`Task`); primitive schemas are named by what they
  validate (`RelPath`, `Sha256Hex`).
- JSON field names in protocol, corpus, admission and receipt files are snake_case.
  Two external contracts keep their own casing verbatim: the review output contract (PLAN §6, camelCase:
  `startLine`, `endLine`) and the S45 public payload (`id, files, taskId, spec, manifestHash, license,
  embargoStatus`).
- Paths inside records are repository-relative POSIX paths validated by `RelPath`.
- Reviewer-visible bytes never contain the PLAN §3.5 words; the scanner is `src/core/defectcorpus/leakscan.ts`.

## Roy-dependent values

- Anything that needs a Roy decision is `null` (locks, prices) or `0` / `enabled: false` (budget), next to a
  `requires: ["R<n>"]` note. The builder never fills these in. Recommended values are labelled
  `recommended_*` or `planning_estimate_not_approval` and are never read by the runtime.

## Dependencies and validation

- Dependencies are declared in `package.json` and are not installed; there is no lockfile.
- Tests are vitest sources under `tests/`, mirroring `src/` (`tests/core/defectcorpus/region.test.ts` tests
  `src/core/defectcorpus/region.ts`). They are written, never run, during Dirty Mode.
- Everything not checked statically is listed in `docs/DEFERRED-VALIDATION.md` with the exact later command.

## Notes from M1 review (0829)
- `tsconfig*.json` are JSON-with-comments (tsc accepts them); they are exempt from the strict `JSON.parse` check.
- The leak scan treats a lower-to-upper case change as a word boundary, so identifiers such as `tagName`, `groupBy`,
  `match.groups` and `Object.groupBy` are flagged in reviewer-visible code, while `witnessed`, `seeded`, `defective` and
  `cleanup` are not. This is intended (PLAN §3.5); corpus authors must avoid those identifiers.
- Static syntax check: `node scripts/syntax-check.mjs src tests cli` (plain `node --check` misses errors in ESM TypeScript).
