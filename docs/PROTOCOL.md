# Preregistered protocol (prose)

> **NOT LOCKED.** This is the protocol as designed. It is not registered and nothing in it has been measured.
> `protocol/preregistration.json` is `draft_unlocked`; `protocol/model-lock.json` and `protocol/prices.json` are all
> `null`; `protocol/budget.json` is `enabled: false` with every approved cap 0. The protocol is locked only when Roy
> answers R1 (spend) and R2 (models) in writing and the M4 protocol lock hashes these files. Until then any change is
> an ordinary edit; after the lock, any change is a recorded protocol deviation.

The machine-readable constants are authoritative: `protocol/preregistration.json` (claim, outcomes, quotas, seeds,
thresholds, slots), `protocol/model-lock.json` (reviewer identity), `protocol/prices.json` (dated prices),
`protocol/budget.json` (caps), `protocol/builder-lineage.json` (who may never sign or author held-out data). Where this
prose and those files differ, the files win and the difference is a documentation bug. Source: PLAN §1, §3, §6 and
conflicts K3, K4, K9, K24.

## 1. What is measured

A small preregistered experiment about automated pull-request review, not a benchmark or leaderboard. Each change is
an original TypeScript PR on a task with a spec, a base, a correct head, a near-miss head and four single-change seeded
heads, every seeded change with an executable witness (`docs/CORPUS.md`). For two automated reviewers it reports:

- **actionable localization (HIT)**: a valid `request_changes` reply with at least one localized finding whose
  `disposition` is `requires_change`. A proxy for "found it", not proof of understanding. "Any localized finding" is
  a separate column.
- **false rejection** of correct code, and **conservative non-approval**;
- **all-attempt dollars**, including failed and retried calls.

## 2. The one controlled question (stratum B)

Stratum B crosses author model × reviewer model (2 × 2). Each locked author model implements a task's intent from its
base; a substrate is admitted if it passes the hidden suite twice and the validator's blind audit; then one correct
copy and two operator-seeded changes per admitted substrate are reviewed by both reviewers. A task enters the contrast
only if both authors' substrates were admitted.

**Preregistered estimand (not measured):**

    Δ_self = mean over tasks t of D_t,   D_t = ½ [ (H_AA − H_BA) + (H_BB − H_AB) ]

where `H_RX` is reviewer R's mean HIT on author X's seeded changes in task t. **Positive Δ_self means same-model
review catches more** (K4: the Claude plan's sign). The report always prints both `Δ_self (same − different)` and
`−Δ_self (different − same)`, so a reader using the other convention is not misled. The same contrast is computed for
false rejection of correct code and for conservative non-approval. The four cells are printed before the pooled
contrast. The 95 % interval is a task-cluster paired bootstrap (10,000 draws, seed 4103). A null or wide interval is a
valid outcome; there is no p-value gate.

Stratum A (both reviewers on the held-out corpus) is **descriptive only** and never supports a self-review inference.

## 3. Fixed decisions (PLAN §3)

1. **Models.** Planned pair: A = `gpt-6.1-sol` (OpenAI Responses), B = `claude-sonnet-5-5` (Anthropic Messages),
   effort `high`, tools off, no history, the same output cap. This is a recommendation, not a lock: the lock file holds
   `null` for every field until R2, and the runtime refuses nulls. "Same model" means a byte-identical locked
   configuration (provider, model id, API version, effort, output cap, system-prompt hash).
2. **HIT** as defined above.
3. **One seeded change per reviewed change.**
4. **Regions** are region/v1: a mechanical line diff of the seeded head against its correct counterpart, one interval
   per changed run; a pure deletion is a two-line anchor (`src/core/defectcorpus/region.ts`).
5. **Reviewer input.** The spec, a unified diff and the line-numbered full head of each touched file (≤ 2 files,
   ≤ 150 executable lines), under an input ceiling of 12,000 tokens; oversize changes are rejected at admission. No
   tests, labels, counterparts, provenance or author identity. Neutral ids `c_<sha256[:10]>`. The words of PLAN §3.5
   never appear in reviewer-visible bytes (corpus-wide scan). Untrusted parts are fenced. Each (reviewer, repeat) gets
   its own recorded shuffle of change order.
6. **Repeats.** 3 per change on held-out, 1 on dev; repeats are nested in tasks. Flip rate = share of (reviewer,
   change) pairs whose three outcomes disagree.
7. **Execution.** Offline Node TypeScript CLI, sequential, one owner per run by an exclusive `wx` lockfile. Keys come
   only from the operator's process environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), never `VITE_`, never into the
   witness sandbox.
8. **Reply statuses.** `valid | schema_invalid | refusal | truncated | timeout | provider_error | identity_mismatch |
   unknown`. No repair retry. One transport retry, only after a confirmed pre-send failure.
9. **Ledger.** The worst case is reserved before every call; an unknown-billing attempt keeps its reservation as an
   upper bound. Stage rows `preparation | authoring | review | retry | failed`. Agent sessions are recorded as
   `subscription_session_cost_unallocated`, never as $0.
10. **Publication.** Held-out labels stay sealed until every locked slot is terminal and the report is frozen, and then
    only on Roy's R4.
11. **Jev** is not built.
12. **Contamination:** original compositions, no imported benchmark data; memorisation cannot
    be excluded and the README says so.

## 4. Review contract and matching (PLAN §6)

- **Reply.** Exactly one JSON object `{verdict: approve | request_changes, findings ≤ 10: [{path, startLine, endLine,
  severity: high | medium | low, claim ≤ 600 chars, confidence 0..1, disposition: requires_change | acceptable |
  uncertain}]}`. Output cap 8,000 tokens including reasoning. Paths must be head paths and lines inside the file. The
  exact prompt bytes and their hash are `src/core/reviewjudge/contract.ts`.
- **Matcher.** Exact normalized path; overlap with any region interval widened by k lines; a finding spanning more
  than 20 lines never matches. **k = 2 is primary** (K3, fixed before any dev review: a deletion anchor is two lines and
  a one-line-off citation of the call site is still actionable). k = 0 and k = 5 are always printed beside it.
- **Outcome of a seeded change**, in precedence order: HIT → DEFER (any localized finding) → WRONG-PLACE (valid
  `request_changes` without one) → MISS. A non-valid reply is UNAVAILABLE, which also counts as a non-HIT.
- **Correct and near-miss changes.** False rejection = valid `request_changes` / valid replies. Conservative
  non-approval = (valid `request_changes` + non-valid) / planned slots. Also completion coverage and burden
  (`requires_change` findings and tokens per change). The localization-match fraction is never called precision.

## 5. Arms and statistics

- **Arms.** Deterministic baselines, each run once: `approve-all`; `flag-every-hunk` (≤ 20-line windows,
  `requires_change`); `diff-heuristic` (rules frozen from dev only and hash-locked before any held-out authoring, with
  rule ids); `static-analysis` (`tsc --strict` plus pinned ESLint including `no-floating-promises`, run in the sandbox;
  infrastructure errors are operational failures, not findings). Model arms: A descriptive; B the 2 × 2.
- **Stratum A.** Per-task HIT = mean over 4 seeded changes × 3 repeats; macro mean over tasks; task-cluster bootstrap
  95 % CI (10,000 draws, seed 4102); A − B as a descriptive paired difference.
- **Stratum B.** Δ_self as in section 2 (seed 4103).
- **Exploratory.** Exact McNemar within each author group on repeat 1 of the first seeded change per task (one
  observation per task), never pooled over repeats. Wilson intervals are labelled "descriptive; ignores clustering".
- **Undefined denominators** render `undefined` with the reason. No p-value gate.
- **Results.** `results/results.md` is written only by `eval`. Every number cell carries its source (run id + slot set);
  any MOCK input stamps the cell MOCK, and MOCK never enters a measured table. The table includes cost per actionable
  seeded change found.

## 6. Dev qualification and the estimability stop (K9)

Before any held-out launch, both reviewers run once on the dev split. The held-out launch **pauses** if dev HIT
≥ 0.9 or ≤ 0.1, or if more than 15 % of dev slots are non-valid. Then difficulty or the pair is revised **on dev
only**, within the existing stage cap, with a new lock and a fresh price and availability check. If that cannot be
done, stratum B is NOT RUN (stratum A may still run descriptively). The decision is never made to obtain a desired
sign.

## 7. Budget (K8)

Planning rates give a per-review reservation of 12,000 input + 8,000 output tokens ($0.104 at $2/$10 per MTok) and a
per-author call of 8,000 + 16,000 ($0.176). Worst case ≈ $170 for reviews + $8.50 for authors; expected ≈ $27.
Recommended cap $150 (A $60, B $90, preparation 0 unless Roy sets it). **Approved: $0.** These are planning numbers,
not prices; `prices.json` is null until a dated refresh is approved.

## 8. Stops

A run refuses to start, or stops and records why, on any of: no Roy R1/R2 decision (the planners' D1/D2); any null lock field; missing or
undated prices; admission not GO; an unqualified sandbox; locked-hash or model-identity drift; a held-out leak to the
builder; **the first** attempt with unknown billing (K24: one is cheaper to reconcile than many); lost run ownership; a
missing slot; unexpected author outputs; a next reservation over the stage sub-cap; a rate limit after one backoff; a
witness/label contradiction; the dev estimability stop. Every stop is recorded. No cherry-picked rerun.

The named failure list (C §8.9 plus `localized-but-excused`, `ambiguous-charge`, `paired-task-missing`) and the
append-only `protocol-deviations.jsonl` complete the record. The semantic judge, injection tests and a rulings UI are
out of scope; the semantic column prints NOT RUN.

## 9. What has run

Nothing. No reviewer has been called, no witness has executed, no slot exists. Every step that would produce a number
is a DEFERRED-VALIDATION entry or a Roy-gated stage.
