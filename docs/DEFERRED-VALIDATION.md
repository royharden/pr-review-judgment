# Deferred validation

This repository was built in **Dirty Mode** (static construction only). Nothing listed here has been run. Each row
says what is unverified, why, and the exact command to run once Roy closes Dirty Mode for the validation phase
(R7 in the project's Roy decisions request). Running any of them is a Roy-gated step; none is approved yet.

Static checks that *were* performed during construction: `node --check` on every `.ts`/`.js` file; a parse of
each `.ts` file's type-stripped output (`node:module` `stripTypeScriptTypes` in strip mode, then `node --check` on
the stripped `.mjs`, because plain `node --check` does not validate ESM TypeScript; see `docs/CONVENTIONS.md`);
`JSON.parse` on every JSON file; and hand-tracing of `region.ts`, `diff.ts` and `sha256.ts` against the cases in the
test sources. The SHA-256 expected digests were cross-checked with GNU `sha256sum` on the same input bytes; the
implementation itself was never executed.

| ID | What | Why deferred | Exact later command | Needs Roy? |
|---|---|---|---|---|
| DV-01 | Install dependencies and create the lockfile | No installs in Dirty Mode; no lockfile exists, so dependency versions are ranges only | `npm install` then commit `package-lock.json` | Yes (R7) |
| DV-02 | Type-check both projects (`tsconfig.json` viewer/core, `tsconfig.cli.json` CLI/tests/core) | Requires installed `typescript` and type packages | `npm run typecheck` | Yes (R7) |
| DV-03 | Lint, including the erasable-syntax and `src/core` purity rules | Requires installed ESLint | `npm run lint` | Yes (R7) |
| DV-04 | Full unit/contract test suite | Tests are written as sources, never run | `npm test` | Yes (R7) |
| DV-05 | SHA-256 known-answer vectors (FIPS 180-4 `""`, `"abc"`, 448-bit, one million `a`; padding boundaries; UTF-8) | `src/core/hash/sha256.ts` is hand-written and was never executed; its round constants were checked by reading only | `npx vitest run tests/core/hash/sha256.test.ts` | Yes (R7) |
| DV-06 | Region derivation `region/v1`: insert, replace, delete anchor, top/bottom clamping, multi-run, widen | Expected values were hand-traced, not executed | `npx vitest run tests/core/defectcorpus/region.test.ts` | Yes (R7) |
| DV-07 | Neutral ids, canonical hashing, leak scan positive/negative cases, projections, unified diff | Never executed | `npx vitest run tests/core/defectcorpus/ids.test.ts tests/core/defectcorpus/leakscan.test.ts tests/core/defectcorpus/projection.test.ts` | Yes (R7) |
| DV-08 | Nothing is vendored (PLAN K13). S36 `9e281d0`, S39 `d5f9e40`, S40 `307835b` informed the design only; small modules are implemented here. An upstream comparison of those modules has not been done | Upstream tests cannot be run in Dirty Mode, so no upstream code is copied as verified | Compare each locally implemented module against its pinned upstream with `git -C <upstream repo> show <commit>:<path>` and record the result in `VENDORED.md` (M5) | Yes (R7) |
| DV-09 | Package scripts whose targets do not exist yet: `replay`, `eval`, `corpus:verify` (CLIs land in M2/M4) and `build`/`dev` (needs `index.html`, M6) | Built in later milestones; nothing may run now | `npm run build`, `npm run corpus:verify -- --help`, `npm run replay -- --help`, `npm run eval -- --help` after M6 | Yes (R7) |
| DV-10 | Committed JSON files match their runtime schemas (`corpus/ADMISSION.json` vs `AdmissionRecordSchema`; protocol files' null/0 invariants) | Checked by `JSON.parse` and reading only | `npx vitest run tests/core/defectcorpus/schema.test.ts` | Yes (R7) |
| DV-11 | zod 4 API usage (`z.strictObject`, `z.iso.datetime`, `z.discriminatedUnion` with `superRefine`) matches the installed zod version | zod is not installed, so the API was used from documentation knowledge | `npm run typecheck && npx vitest run tests/core/defectcorpus/schema.test.ts` | Yes (R7) |
