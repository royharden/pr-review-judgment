# Review Judgment

> **NOT MEASURED · Dirty Mode source construction · runtime unverified.**
> No dependency install, typecheck, lint, test, build, witness, sandbox probe, browser session or live model call has run.
> Examples are synthetic and stamped MOCK. USD 40 is the approved aggregate ceiling only; execution remains disabled.

A small preregistered experiment about automated pull-request review: actionable localization of seeded defects,
false rejection of correct code, and all-attempt cost. This is a protocol experiment, not a benchmark or leaderboard.

The static React/Vite viewer browses public development source, filters synthetic reviews, shows diffs and findings,
and overlays localization at k=0, 2 and 5 through the same pure core classifier used by the offline tooling.
MOCK aggregate tables are computed client-side from fixtures. Measured results stay empty.

The offline Node TypeScript source includes corpus schemas and leak scanning; mutation operators; a fail-closed sandbox
runner; admission and receipts-only tooling; Responses/Messages adapters; matching, classification, statistical aggregation
and report rendering; reserved-cost ledger and crash-aware run state; protocol lock/look registry; replay/evaluation;
stratum-B authoring/seeding/pinning; and S45 projections. These are constructed interfaces, not demonstrated runtime behavior.

## Study design

HIT means a valid request-changes reply with a localized requires-change finding. It is a proxy for actionable review,
not proof of factual correctness. Stratum A is descriptive. Stratum B crosses author × reviewer and computes:

`Δ_self = meanₜ ½[(H_AA − H_BA) + (H_BB − H_AB)]`

Positive means same-model review catches more. Task-cluster paired bootstrap intervals and the opposite-sign label
accompany the contrast. Invalid/unavailable outcomes, undefined denominators, failures and cost uncertainty stay visible.
The semantic judge is NOT RUN. Original tasks cannot exclude contamination or memorization.

## Source layout

| Path | Purpose |
|---|---|
| `src/app/`, `index.html` | Static viewer over public source and MOCK fixtures |
| `src/core/` | Pure corpus, operators, sandbox contracts, providers, review/statistics, ledger/state/protocol |
| `cli/` | Host effects, admission, replay, evaluation, run and B pipeline tooling |
| `corpus/dev/` | Builder-authored development tasks and variants; not independent held-out data |
| `corpus/dev.public.json` | Browser-safe source projection; excludes tests and private labels |
| `corpus/manifest.public.json` | Pending activation manifest; never treated as a validated corpus |
| `fixtures/` | MOCK provider/review/B examples and development-only S45 records |
| `protocol/` | Draft preregistration, disabled budget, unset model/prices, lineage and dev-derived rules pin |
| `tests/` | Test sources, written but not executed |
| `docs/` | Protocol, corpus/author packets, conventions, limitations and deferred checks |

## Validation and activation

Only after Roy closes Dirty Mode: `npm install` to create a lockfile, then `npm run typecheck`, `npm run lint`,
`npm test`, and `npm run build`. No lockfile exists yet. The declared dependency ranges and every runtime behavior
remain unverified. Detailed later commands are in [DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md).

Static construction checks consist of source inspection, independent child review within builder lineage,
JSON parsing and TypeScript stripping followed by parsing with `scripts/syntax-check.mjs` (no product execution).
JSX, layout and user interaction remain unverified. Do not interpret a syntax pass as a typecheck or test pass.

All execution needing held-out inputs requires admission GO from separately appointed non-builder steward/validator
sessions. Admission is `PENDING_ROY_APPOINTMENT`; this team authored no held-out data. Model locks and dated prices
remain unset. The budget records Roy’s USD 40 aggregate ceiling but stays `enabled:false`, with approved stage caps
zero until separately decided. Preparation calls, keys, accounts and live calls are not granted by that ceiling.
Worst-case planned reservations exceed the ceiling; an authorized run must stop partial rather than overspend.

The external owner decisions remain in the outer shell’s `ROY-DECISIONS-REQUEST.md`: model/account access,
independent appointments, publication, no-backend confirmation, admission ordering, validation phase and sealed exports.
No held-out labels may be released before freeze and a separate Roy grant. Never put provider secrets in browser variables.

## Bolt and reuse

The MVP has no database or hosted backend. [BOLT-HANDOFF.md](BOLT-HANDOFF.md) describes the future inspection/import
boundary and external offline requirements; no import, remote, publication or deployment has occurred.
[LIMITATIONS.md](docs/LIMITATIONS.md) covers statistical, independence, billing and execution limits.
Jev is not integrated: this preregistered experiment needs fixed reviewer contracts, rather than an additional judging model.
Reuse provenance is in [VENDORED.md](VENDORED.md); local implementations are not claimed as verified upstream code.

MIT; see [LICENSE](LICENSE).
