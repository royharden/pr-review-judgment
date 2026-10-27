# pr-review-judgment

> **NOT MEASURED.** No review has been requested from any model, no corpus witness has executed, and no result in
> this repository is a measurement. Approved live spend is **$0**.

A small, preregistered protocol experiment (not a benchmark or a leaderboard) about automated pull-request review.
It uses an original TypeScript, PR-shaped corpus in which every seeded defect has an executable witness test, a
correct counterpart and a near-miss counterpart. For two automated reviewers it is designed to measure:

- **actionable localization (HIT)**: the reviewer requests changes *and* points, within a fixed line tolerance, at
  the seeded problem with a finding it says requires a change (a proxy, not proof of understanding);
- **false rejection** of correct code;
- **all-attempt dollars**, including failed and retried calls.

The one controlled question (stratum B, a crossed 2 x 2 of author model x reviewer model) is whether a reviewer
does better or worse on changes whose substrate its own model wrote. The preregistered estimand and every protocol
constant are in `protocol/preregistration.json`; the sign convention is `Δ_self = same − different`.

## How this was built (Dirty Mode)

This repository is under construction in **Dirty Mode**: static construction only. Nothing has been installed,
built, type-checked, linted, tested, containerized or run, and no network or provider call has been made. The only
checks performed were a strip-types-then-parse syntax check of the TypeScript files (`node scripts/syntax-check.mjs`,
which never executes repo code), `JSON.parse` of the JSON files, `sha256sum` cross-checks of hash test vectors and careful
reading. Every unverified item, with the exact command to verify it later, is listed in
[`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md).

## Roy gates

Every live or measured stage is gated on written decisions from Roy, listed in the project's Roy decisions request
(kept outside this repository): spend and caps (R1), the model lock (R2), appointment of the independent corpus
steward and validator (R3), label publication (R4), the no-backend MVP (R5), building source before data admission
(R6) and closing Dirty Mode for validation (R7). None is approved. Accordingly:

- `protocol/model-lock.json` and `protocol/prices.json` are all `null`; `protocol/budget.json` is
  `enabled: false` with every approved cap `0`.
- `corpus/ADMISSION.json` is `PENDING_ROY_APPOINTMENT`; `corpus/heldout.commit` records that no held-out set exists.
- The builder never authors held-out tasks, hidden suites or labels; only the Roy-appointed independent steward and
  validator may.

## Layout (M1)

```
protocol/            preregistration, model lock, prices, budget (Roy-dependent fields unset)
corpus/              ADMISSION.json (pending), heldout.commit (no held-out set)
src/core/hash/       pure-TS SHA-256
src/core/defectcorpus/  zod schemas, neutral ids, hashing, line diff, region/v1, projections, leak scan
tests/               vitest sources mirroring src/ (written, never run)
docs/                CONVENTIONS.md, DEFERRED-VALIDATION.md
```

Later milestones add mutation operators and the sandbox runner (M2), the review engine and statistics (M3), run
state, ledger and CLIs (M4), the builder-authored dev corpus and independent-author packets (M5), and a static
viewer (M6).

## License

MIT, see [LICENSE](LICENSE).
