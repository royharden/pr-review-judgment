# Corpus specification

The corpus is a set of small, original, PR-shaped TypeScript tasks. Every seeded problem has an executable witness
test, a correct counterpart and a near-miss counterpart (PLAN §1, §5). This document is the format and policy
reference. The loaders are authoritative where this text and code disagree: `src/core/defectcorpus/schema.ts`
(record shapes), `cli/corpus-verify.ts` (directory layout), `src/core/sandbox/verifyplan.ts` (which checks run),
`src/core/defectcorpus/region.ts` (regions) and `src/core/defectcorpus/leakscan.ts` (the word scan).

Only the **dev** split (T01–T06) exists in this repository. It is builder-written, public and not independent. No
held-out task exists anywhere yet (`corpus/heldout.commit`), and this document describes the held-out split only as
format and policy, never as content.

**Nothing in the corpus has executed.** It was built in Dirty Mode: no compile, no test, no witness run. Every claim
below of the form "fails on" or "passes on" comes from reading the code; execution is DEFERRED-VALIDATION DV-25.

## Layout

```
corpus/
  dev/<T##>/task.json            TaskSchema (one per task)
  dev/<T##>/variants/c.json      the correct head            (VariantSchema, kind "clean")
  dev/<T##>/variants/n.json      the near-miss head          (kind "near_miss", with guard_test)
  dev/<T##>/variants/d1..d4.json the four single-change heads (kind "defect", with labels and witness_test)
  manifest.public.json           public manifest of the dev split (pending activation, see below)
  heldout.commit                 placeholder: no held-out set exists
  ADMISSION.json                 admission record, PENDING_ROY_APPOINTMENT
```

`cli/corpus-verify.ts` reads exactly `<corpus>/<TASK>/task.json` and every `<corpus>/<TASK>/variants/*.json`, for every
directory whose name is a task id (`T##` dev, `H##` held-out). All file content is **embedded** in these JSON records
as `{ path, content }` objects with the exact file text (LF line endings, final newline). There are no loose `.ts`
files under `corpus/`: the JSON is the single copy, and the reviewer, the witness sandbox and the public manifest are
all projections of it.

The variant file names (`c`, `n`, `d1`..`d4`) and variant ids (`T01.d3`) are private bookkeeping. They never reach a
reviewer: reviewers see only the neutral change id `c_<sha256[:10]>` computed from reviewer-visible content
(`src/core/defectcorpus/ids.ts`, `projection.ts`).

### task.json

| Field | Meaning |
|---|---|
| `task_id` | `T##` (dev) or `H##` (held-out); equals the directory name |
| `split` | `dev` for `T##`, `heldout` for `H##` (schema-enforced) |
| `spec` | the PR description, written as a feature request. Reviewer-visible |
| `intent` | the implementation brief a stratum-B author receives with the base (PLAN §5). Not shown to reviewers, but written under the same word rules |
| `base_files` | 1–2 `.ts` files: the code before the change (the PR base) |
| `hidden_tests` | the hidden vitest suite (`*.test.ts`). Never reviewer-visible |
| `executable_lines` | count over the **correct** head files of lines that are neither blank nor comment-only (`//`, `/*`, `*`). A deliberately generous count (type declarations and braces count); must be ≤ 150 |
| `labels_authority` | `builder_dev_not_independent` for dev, `steward_heldout` for held-out (schema-enforced) |

### variants/*.json

Every variant carries the **complete head**: every base path plus any added file (at most 2 files). A head path that is
not in the base is an added file (T04 adds `src/approval-errors.ts`). File deletion is not supported.

| Kind | Extra fields | Role |
|---|---|---|
| `clean` | none | implements the spec; exactly one per task |
| `near_miss` | `guard_test` | correct, but contains a change that looks suspicious to a reviewer |
| `defect` | `group`, `tag`, `severity`, `origin`, `witness_test` | the correct head with exactly one contiguous change that breaks the spec |

`group`, `tag`, `severity`, `origin` and the test references are labels. They live only in the variant record and the
private companion projection, never in anything a reviewer sees.

## Variant rules

- **Correct head.** Implements every numbered requirement of the spec and passes every test in the hidden suite.
- **Single change.** Each defect head differs from the correct head in exactly one contiguous run of lines (one diff
  hunk). Its region is that run (region/v1, below). One defect per change (PLAN §3.3).
- **Inside the PR.** Every dev defect sits on a line the PR adds or changes relative to the base, so the reviewer sees
  it in the diff and in the numbered head.
- **Compiles.** Every head must type-check under the sandbox's strict `tsc` (`sandbox/entry.mjs`: ES2023 lib, no DOM or
  Node types, `strict`). A head that does not compile can never be witnessed, so operator sites whose mutant would not
  type-check (for example `RemoveOptionalChainOrNullish` on a value later used as non-nullable) are not used.
- **No I/O, deterministic.** No file system, network, timers, `Date.now`, `Math.random` or globals beyond ES2023.
  Asynchrony is modelled with injected `async` functions and promises; tests drive it with microtask steps
  (`await Promise.resolve()`) and hand-resolved promises, never with real time.
- **Near-miss kinds** (PLAN [C] §6.2). Each dev task uses a different one:
  1. *equivalent loosened comparison* (T01): a strict bound replaced by a looser test that is equal under an invariant;
  2. *safe reordered await* (T02): two independent awaits swapped where order cannot be observed;
  3. *constants-only string* (T03): markup assembled by unescaped interpolation, but only of constants;
  4. *guard at external boundary* (T04): an extra input guard that rejects only out-of-contract input;
  5. *behaviour-preserving refactor > 20 lines* (T05);
  6. *redundant-by-types null check* (T06).
- **Guard test.** Each near-miss names a `guard_test`: a test in the hidden suite that exercises exactly the
  suspicious code. Verification runs the whole suite on the near-miss (`verifyplan.ts`), so every hidden test, the
  guard included, must pass on both the near-miss and the correct head.

## Groups and quotas

| Group | Covers (PLAN §5, `protocol/preregistration.json` `groups`) |
|---|---|
| `G-BND` | boundary, off-by-one, null/optional |
| `G-ACC` | authorization, validation, escaping |
| `G-ASY` | missing await, ordering, state, cache key, lifecycle |
| `G-ERR` | swallowed or mis-mapped error, inverted logic, wrong operator |

| Split | Tasks | Defects | Per group | Origin quota |
|---|---|---|---|---|
| dev (this repo) | 6 (T01–T06) | 24 (4 per task) | exactly 6 | none required; aimed at half and half: **12 operator, 12 hand** |
| held-out (steward) | 10 (H01–H10) | 40 (4 per task) | exactly 10 | ≥ 14 operator and ≥ 14 hand |

A task need not hold one defect per group; only the split totals are fixed. Dev distribution:
T01 BND/BND/ACC/ERR, T02 ASY/ASY/ERR/BND, T03 ACC/ACC/BND/ERR, T04 ACC/ACC/ASY/ERR, T05 BND/BND/ERR/ACC,
T06 ASY/ASY/ASY/ERR. Tally: G-BND 6, G-ACC 6, G-ASY 6, G-ERR 6.

## Origin

- `operator:<Name>`: the defect head is the correct head with exactly one candidate mutation applied, as
  `src/core/operators` enumerates it: the same `[start, end)` slice replaced by the same replacement text (padding
  included). Name is one of the twelve operators: `BooleanLiteral`, `NumericBoundary`, `Equality`, `Relational`,
  `Arithmetic`, `Logical`, `UnaryNegation`, `Conditional`, `RemoveAwait`, `RemoveOptionalChainOrNullish`,
  `RemoveGuardStatement`, `EmptyCatchBody`. The operator's own byte-level artefacts are kept: `RemoveGuardStatement`
  leaves the statement's indentation as a whitespace-only line (T04.d1); `EmptyCatchBody` collapses the block to `{}`
  on the `catch` line (T04.d4).
- `hand`: written by the author. A hand defect must not be byte-identical to an operator mutant of the same head (if
  it is, label it with that operator).

Dev operators used: Relational ×3, Equality ×2, RemoveAwait ×2, Logical, NumericBoundary, Arithmetic,
RemoveGuardStatement, EmptyCatchBody. The dev operator-origin defects were applied by reading the operator source,
not by running `enumerateMutations`; confirming each is in the enumerated candidate list is DV-25.

## Dev versus held-out

| | Dev T01–T06 | Held-out H01–H10 |
|---|---|---|
| Author | builder lineage (S41-INT subagent 0850), allowed by PLAN K15 | only the Roy-appointed independent steward (R3) |
| Labels | `builder_dev_not_independent` | `steward_heldout` |
| Location | `corpus/dev/` in this public repo | the sealed vault `.heldout/` in the outer shell, never in this repo before R4 |
| Use | fixtures, dev qualification (K9 estimability band), diff-heuristic rule freezing | the only data that can support a measured result |
| Witness execution | builder, after Dirty Mode closes (R7) | the appointed validator, in its own session (K19) |

Dev and held-out are never pooled. Dev labels are never "gold". The builder lineage never reads, writes or displays
held-out content (`docs/STEWARD-PACKET.md`, `docs/VALIDATOR-PACKET.md`).

## Label authority

`labels_authority` is fixed by split (schema-enforced in `TaskSchema`, `VariantSchema` and
`PrivateCompanionRecordSchema`). A dev label is the builder's statement of intent, checked only by reading until the
witnesses run. A held-out label is the steward's, checked by the validator's blind diagnosis and reconciliation, and
by witness receipts executed in the validator's session.

## Region policy region/v1

Regions are derived mechanically (`src/core/defectcorpus/region.ts`), never hand-entered: a line diff of the defect
head against its correct counterpart, file by file, one interval per changed run, in defect-head line numbers
(1-based, inclusive). A run that inserts or replaces lines gives the inserted span. A pure deletion gives a two-line
anchor: the surviving line before and after (clamped to the file). The matcher widens each interval by k lines
(k = 2 primary, 0 and 5 reported) and caps a finding's span at 20 lines (PLAN §6). Every dev defect is a single
run, so each has exactly one region; T05.d4 is a pure deletion, so its region is a two-line anchor.

## Leak-scan rule

Nothing a reviewer sees may contain the words `clean`, `defect`, `near-miss`, `near_miss`, `group`, `tag`, `seed`,
`mutant`, `twin`, `witness` (PLAN §3.5), nor the derived spellings `near miss`, `nearmiss`. Reviewer-visible means the
change id, the spec, the unified diff (so the base too), every touched path and every numbered head.

The scan (`leakscan.ts`) is ASCII case-insensitive and word-bounded. A boundary is any non-alphanumeric character, a
lower-to-upper camelCase step, an acronym-to-word step or a letter/digit step; plural `s`/`es` is included. So
`isClean`, `groupBy`, `tagName`, `match.groups`, `seed42` and `src/seed-data.ts` are hits; `cleanup`, `seeded`,
`defective` and `QuietWindow` are not. Corpus authors avoid the words in identifiers, comments, strings and file
names; the hidden suite is not reviewer-visible but follows the same habit except where a word is unavoidable.
`intent` is scanned too. The review contract also refuses any content containing the prompt fence markers
`=====BEGIN UNTRUSTED` / `=====END UNTRUSTED` (`src/core/reviewjudge/contract.ts`).

## Public manifest

`corpus/manifest.public.json` will hold one S45 public record per dev change (`PublicManifestRecordSchema`:
`{id, files:[{path, base, head}], taskId, spec, manifestHash, license, embargoStatus}`), produced by
`projection.ts` `toPublicRecord`, with no kind, group, tag, region or counterpart field, sorted by `id` so the order
reveals nothing. The record ids and `manifestHash` are hashes of canonical JSON (`hashes.ts`), which can only be
computed exactly by running repository code. In Dirty Mode that is not allowed, so the file is a **pending stub**:
`pending_activation: true`, every hash `null`, no records, and the generation rule spelled out (DV-26). No hash in it
is guessed.

## Hidden suites and witnesses

- Written from the spec **before** the implementation (spec-first). Each test is about a numbered requirement, not about
  how the correct head happens to be written.
- vitest, explicit imports (`import { describe, expect, it } from "vitest"`; the sandbox sets `types: []`, so there are
  no globals), relative `.ts` imports of the head files (`../src/x.ts`).
- Static titles only, unique within the file (next section). Tests are independent of order: the sandbox shuffles them
  (`--sequence.shuffle`), so no test shares mutable state with another.

## Witness test naming

A defect's `witness_test` and a near-miss's `guard_test` are `TestRef = { path, name }`:

- `path` is one of the task's `hidden_tests` file paths.
- `name` is the vitest **leaf title**: the string passed to `test(...)` / `it(...)`, exactly as vitest reports it in
  its JSON reporter as `testResults[].assertionResults[].title`. It does **not** include enclosing `describe` titles
  (that would be `fullName`).
- The leaf title must be **unique within its file**, across all `describe` blocks. `sandbox/entry.mjs` selects the test
  with `--testNamePattern <escaped name>` and then requires exactly one executed test whose `title` equals `name`;
  zero or several matches are a `selection_error`, which is never a witness (the receipt is not witnessed and the task
  does not verify).
- `name` may not be `*`. `*` is the receipt sentinel for a whole-file suite run (`ALL_TESTS_IN_FILE` in
  `src/core/sandbox/verifyplan.ts`) and is refused as a witness test name.
- Avoid dynamic titles (`test.each` with interpolated values, template literals): the title vitest reports must equal
  `name` byte for byte.

These vitest 4 behaviours (`assertionResults[].title` is the leaf title; `--testNamePattern` matches against the full
name) are activation checks listed in `docs/DEFERRED-VALIDATION.md` DV-16, not verified facts.

## Dev tasks T01–T06

All six are original compositions of ordinary rules, one file each except T04. Executable lines are counted on the
correct head as defined above.

| Task | Head file(s) | Feature | Exec. lines | Hidden tests | Near-miss (kind) and guard test |
|---|---|---|---|---|---|
| T01 | `src/burst-limiter.ts` | fixed-window limiter keyed by an escaped (tenant, region) pair, clock-aligned windows, grace allowance that depends on the previous window | 56 | 11 | `state.graceUsed < config.grace` becomes `!==` (equivalent loosened comparison: `graceUsed` starts at 0 and grows only while below `grace`) / "stops granting grace after the configured number" |
| T02 | `src/preferences.ts` | `not_found` overrides become empty; per-(workspace, user) ttl cache that shares in-flight loads and drops rejected ones | 46 | 11 | overrides awaited before defaults (safe reordered await: independent loads, merge order unchanged) / "overlays the user's overrides on the workspace defaults" |
| T03 | `src/breadcrumbs.ts` | HTML breadcrumb with per-viewer visibility, name escaping and root-gap-tail shortening | 41 | 13 | the locked and gap markup built as templates from a `CRUMB_CLASS` constant, unescaped (constants-only string; output bytes identical) / "marks folders the viewer cannot see as private" |
| T04 | `src/release-approvals.ts`, `src/approval-errors.ts` (added) | two-person release approvals: author and role rules, persist-then-count, storage error code, mark released once | 70 | 11 | `approve` throws `RangeError` for an empty release or author id (guard at external boundary; the spec makes ids non-empty) / "approves a release once two maintainers agree" |
| T05 | `src/quiet-hours.ts` | quiet-hours delivery plan: half-open windows that may cross midnight, minutes until the end, urgent bypass list, minute validation | 42 | 13 | window membership rewritten as "offset from start < window length" plus a restructured `planDelivery`, 34 changed lines (behaviour-preserving refactor > 20 lines) / "matches the documented overnight example" |
| T06 | `src/step-runner.ts` | sequential step runner with retryable-error retries, awaited backoff, per-attempt events and a one-batch-at-a-time guard | 62 | 13 | `if (step === null \|\| step === undefined) throw new TypeError(...)` at the loop top (redundant-by-types null check: `Step` excludes both) / "runs every step once when all succeed" |

### Dev defects

Every witness is in the task's single hidden file (`hidden/<module>.test.ts`). "Why the witness fails" is static
reasoning against the defect head; the same test passes on the correct head by the same trace (execution deferred,
DV-25).

| Defect | Group | Tag | Sev. | Origin | Witness test | Why the witness fails on this head |
|---|---|---|---|---|---|---|
| T01.d1 | G-BND | limit-off-by-one | high | operator:Relational | allows exactly limit requests per window | `used < limit` became `<=`: with limit 3 the fourth request (used 3) is allowed, so `allowed` is `[true,true,true,true]` (and `remaining` goes to -1), not `[true,true,true,false]` |
| T01.d2 | G-BND | window-edge-shift | medium | hand | starts a new window exactly at the window end | window start uses `now - 1`, so the request at 1000 lands in window 0 with the one at 500 and is refused instead of opening a new window |
| T01.d3 | G-ACC | separator-not-escaped | high | hand | keeps pairs whose parts contain the separator apart | the key is `${tenant}:${region}` unescaped, so ("a:b","c") and ("a","b:c") share one limit-1 counter and the second pair is refused |
| T01.d4 | G-ERR | grace-condition-operator | high | operator:Logical | withholds grace when the previous window was busy | `graceOpen && …` became `\|\|`: the previous window used 2 of 2 (no grace), but `graceUsed 0 < 1` grants it, so the third request is `{allowed: true, grace: true}` |
| T02.d1 | G-ASY | cache-key-missing-user | high | hand | keeps each user's preferences apart | the cache key is `[workspace]` only, so bo's `get` returns ann's cached `{theme: "dark"}` instead of the defaults |
| T02.d2 | G-ASY | failed-load-retained | high | operator:Equality | starts a new load after a failed one | the cleanup test became `!==`, so a rejected entry (which is still the current entry) is never deleted; the next `get` within the ttl returns the same rejected promise and the test's `await` throws |
| T02.d3 | G-ERR | override-error-swallowed | medium | hand | passes other override failures to the caller | the catch returns `{}` for every error, so a `timeout` rejection resolves with the defaults instead of rejecting with that error |
| T02.d4 | G-BND | ttl-expiry-inclusive | low | operator:Relational | starts a new load exactly when the ttl has elapsed | `now < startedAt + ttl` became `<=`: at 1500 = 1000 + 500 the entry is still served, so `fetchDefaults` is called once, not twice |
| T03.d1 | G-ACC | name-not-escaped | high | hand | escapes markup in folder names | the name is interpolated raw, so `<b>"Q&A"</b> it's` appears unescaped instead of `&lt;b&gt;&quot;Q&amp;A…` |
| T03.d2 | G-ACC | owner-check-inverted | high | operator:Equality | hides another user's unshared folder | `ownerId === viewer.id` became `!==`; for u1's folder and viewer u2 it is true, so "Payroll" is shown instead of the locked marker |
| T03.d3 | G-BND | tail-count-off-by-one | medium | operator:NumericBoundary | keeps the root and the last maxItems - 1 folders when shortening | `(maxItems - 1)` became `(maxItems - 2)`: six folders at maxItems 4 keep only e, f after the gap instead of d, e, f |
| T03.d4 | G-ERR | wrong-error-type | low | hand | rejects maxItems below 2 with a RangeError | the guard throws `TypeError`, which is not a `RangeError`, so `toThrow(RangeError)` fails |
| T04.d1 | G-ACC | self-approval-allowed | high | operator:RemoveGuardStatement | refuses an approval from the release author | the author check is deleted; ann is a maintainer, so her own approval is appended and resolves ("resolved", not "self_approval") |
| T04.d2 | G-ACC | role-lookup-wrong-user | high | hand | refuses an approval from a user without the maintainer role | roles are looked up for the author (ann, a maintainer), so "guest" passes and the approval resolves |
| T04.d3 | G-ASY | append-not-awaited | high | operator:RemoveAwait | does not count an approval whose storage failed | the rejecting `append` is not awaited inside the `try`, so bo is counted and `approve` resolves ("resolved", not "storage"); the floating rejection is also unhandled |
| T04.d4 | G-ERR | storage-error-swallowed | high | operator:EmptyCatchBody | reports a storage failure with the storage code | the catch block is `{}`, so the failed append is ignored and the call resolves instead of rejecting with code `storage` |
| T05.d1 | G-BND | window-start-excluded | medium | operator:Relational | holds a notice at the first minute of a same-day window | `minute >= start` became `>`: minute 60 in [60, 120) is outside, so the notice is delivered now instead of held 60 |
| T05.d2 | G-BND | overnight-window-shifted | medium | hand | holds a notice at the first minute of an overnight window | both overnight bounds shifted (`>`, `<=`): at 1320 in [1320, 420) both tests are false, so it is delivered now instead of held 540 |
| T05.d3 | G-ERR | wrap-arithmetic-sign | high | operator:Arithmetic | holds a notice until the end of a same-day window | the outer `+ MINUTES_PER_DAY` became `-`: at minute 90, `(120 - 90 - 1440) % 1440` is -1410, not 30 |
| T05.d4 | G-ACC | end-minute-unvalidated | medium | hand | rejects a quiet end outside the day | the `quiet.end` validation line is deleted; end 1440 passes and minute 30 is outside [60, 1440), so no `RangeError` is thrown |
| T06.d1 | G-ASY | busy-flag-released-early | high | operator:RemoveAwait | refuses a second batch while one is running | `return runBatch(...)` inside `try/finally` runs the `finally` as soon as the pending promise is returned, so `busy` is already false and the second `run` resolves instead of rejecting with `RunnerBusyError` |
| T06.d2 | G-ASY | busy-flag-stuck-after-error | medium | hand | accepts a new batch after one ended with an error | the reset is no longer in a `finally`; when `sleep` rejects, `busy = false` is skipped and the next `run` rejects with `RunnerBusyError` instead of returning ok |
| T06.d3 | G-ASY | backoff-not-awaited | medium | hand | waits for the backoff before the next attempt | `await` became `void`: the second attempt starts while `sleep` is pending, so the log is `a, sleep 1, a, woke`, not `a, sleep 1, woke, a` |
| T06.d4 | G-ERR | retry-classification-inverted | high | hand | does not retry errors without the retryable flag | `retryable === true` became `!== false`; `undefined !== false`, so a plain error is retried, the step succeeds on attempt 2 and the result is ok/2 instead of failed/1 (not an Equality mutant, which would give `!== true`) |

## Static checks performed for the dev corpus (M5a)

- Every embedded `.ts` (6 bases, 36 variant heads plus T04's added file in each, 6 hidden suites: 54 files) extracted
  to a scratch directory and passed `node scripts/syntax-check.mjs` (strip types, then parse). No type check ran.
- `JSON.parse` of all 42 corpus JSON files; key sets compared with the strict schemas by reading.
- Every defect head diffed against its correct head with `git diff --no-index` (reads files, executes nothing):
  exactly one hunk each.
- Leak scan: a line-for-line port of `scanText` (self-tested on the documented examples) over all 108 reviewer-visible
  strings (spec, intent, every base and head path and content): 0 hits; plus a word-boundary `grep`: 0 hits.
- Quotas: 6/6/6/6 by group, 12 operator / 12 hand; leaf titles unique per file; every witness and guard title present
  exactly once; at most 2 files and 150 executable lines per head.
