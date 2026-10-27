# Reuse and provenance

**Nothing in this repository is vendored, and nothing is reused as verified code.** PLAN K13 planned to vendor small
modules from three earlier portfolio projects once their tests passed here. In Dirty Mode no test can run, so every
module was **implemented locally**, using the pinned upstream sources only as design references (read, not copied).
Upstream equivalence was never checked (DEFERRED-VALIDATION DV-08). `VENDORED.md` records the same fact at the
repository root.

## Pinned design sources

| Source | Pin | Used for |
|---|---|---|
| S36 | `9e281d0` | statistics design: cluster bootstrap and quantiles |
| S39 | `d5f9e40` | mutation-operator engine, Docker sandbox argv, capture, cleanup and gate semantics |
| S40 | `307835b` | Wilson and McNemar statistics; untrusted-JSON provider helpers |

## Local files and what informed them

Taken from each file's header comment (`grep -rn "S36\|S39\|S40" src cli sandbox`). A local file not listed here had
no upstream design source.

| Local file | Informed by | Upstream path (at the pin) | Recorded differences |
|---|---|---|---|
| `src/core/operators/types.ts` | S39 `d5f9e40` | `cli/engines/inhouse.ts` (`INHOUSE_OPERATORS`) | the eight classic operator names; four operators added here with no upstream |
| `src/core/operators/classic.ts` | S39 `d5f9e40` | `cli/engines/inhouse.ts` (`enumerateInhouse`) | UTF-16 offset ranges, not line/column; one Relational flip per site; Arithmetic skips string `+`; numeric candidates rendered to re-parse; padding only where tokens would fuse |
| `src/core/operators/enumerate.ts` | S39 `d5f9e40` | `cli/engines/inhouse.ts` | one parse with parent pointers, one visitor, refuse unparsable sources; relies on the same non-public `parseDiagnostics` field |
| `src/core/operators/extended.ts` | none | none | `RemoveAwait`, `RemoveOptionalChainOrNullish`, `RemoveGuardStatement`, `EmptyCatchBody` are new |
| `src/core/sandbox/argv.ts` | S39 `d5f9e40` | `cli/sandbox/sandboxrun.ts` (`buildSandboxCommand`, `safeMount`, `removeContainer`) | argv policy of PLAN K18 / M2 acceptance 2 |
| `src/core/sandbox/runner.ts` | S39 `d5f9e40` | `cli/sandbox/sandboxrun.ts` (capture, timeout, cleanup), `cli/core/gate.ts` | "compile, crash or timeout is never a kill" carried over as "never a witness" |
| `cli/lib/docker.ts` | S39 `d5f9e40` | `cli/sandbox/sandboxrun.ts` (capture, `removeContainer`, `hostProcessEnv`) | |
| `sandbox/entry.mjs` | S39 `d5f9e40` | `cli/sandbox/runner.mjs` | report written outside `/work`; one JSON status line on stdout |
| `src/core/stats/bootstrap.ts` | S36 `9e281d0` | `src/core/judgestats/bootstrap.ts` | resampling units, seeded draws, exposed draw indices for paired comparisons, dropped-draw accounting |
| `src/core/stats/quantile.ts` | S36 `9e281d0` | `src/core/judgestats` | type-7 quantiles |
| `src/core/stats/wilson.ts` | S40 `307835b` | `src/core/regressdiff/stats/wilson.ts` | known answer Wilson(5, 10) = [0.2366, 0.7634] in the test sources |
| `src/core/stats/mcnemar.ts` | S40 `307835b` | `src/core/regressdiff/stats/mcnemar.ts` | exact McNemar |
| `src/core/providers/port.ts` | S40 `307835b` | `supabase/functions/run-task/portable/` | untrusted-JSON helpers, usage kept apart from answer parsing, cost never assumed. S40 targets Chat Completions; the OpenAI adapter here is the Responses API (K12) |

## Corpus

The dev corpus (`corpus/dev/T01–T06`) is original: written for this study by the builder lineage, with no imported
benchmark, kata or library code (PLAN §3.12). Its operator-origin defects were applied by reading
`src/core/operators`, not by running it. Held-out data does not exist and will be written only by the independent
steward.

## Third-party dependencies

Declared in `package.json`, never installed in Dirty Mode, with no lockfile (DV entries in M1). The sandbox image pins
are in `sandbox/Dockerfile` (DV-12). None of their code is copied into this repository.
