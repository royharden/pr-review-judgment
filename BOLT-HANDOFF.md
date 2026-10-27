# Bolt handoff: Review Judgment

Status: **source construction only; runtime unverified; NOT MEASURED**.

The import root is this inner repository. It contains a React 18 / TypeScript / Vite static viewer and a separate offline Node CLI.
No import, publish, deploy or remote creation is authorized in the current construction run.

## Target and inventory

- Database: **none**. No migrations, functions, storage, authentication or Realtime resources are required for the MVP.
- Frontend entry: `index.html` → `src/app/main.tsx`. Output directory: `dist` (never built).
- Public inputs: `corpus/dev.public.json`, `fixtures/reviews/cases.json`. MOCK tables are computed by shared pure core functions.
- Runtime: Node >=22 with the declared package versions. Dependency installation and lockfile creation are deferred.
- Offline tooling: `cli/`, including admission, witness verification, replay/evaluation, ledger-backed execution and stratum B preparation.
  The static host does not run this tooling or Docker. Keep it on a separately authorized operator machine.
- Secrets: no browser secrets or `VITE_*` provider credentials. Future offline adapters name `OPENAI_API_KEY` and
  `ANTHROPIC_API_KEY`; access/provisioning remains an owner step, and live execution remains disabled.
- Backend option: only if Roy changes R5, queue a later authenticated, capped demo service and published-results storage.
  The MVP does not imply that service exists.

## Later validation, after Roy closes Dirty Mode

From this repository: `npm install` (create and review the lockfile), `npm run typecheck`, `npm run lint`, `npm test`,
then `npm run build`. See `docs/DEFERRED-VALIDATION.md` for CLI, sandbox and witness checks. None has run.
When a dev server is authorized, first claim/check the actual instance through agent-ports; do not assume a default port is free.

Frontend acceptance: inspect Reviews, filter/select every fixture, switch matcher k, inspect findings and regions; browse all public
dev tasks; inspect Protocol. Confirm MOCK stamps remain visible and measured results stay empty. Inspect the built dependency graph
and assets for any private companion, hidden test or held-out import. No browser/network provider call should occur.

## Owner steps and future preparation prompt

Roy must authorize validation and any later import/publication. Held-out author appointment, admission, model lock, dated prices,
stage budget allocations, and actual provider access remain separate gates; importing the static viewer resolves none of them.

After authorization, give Bolt this inspection/preparation prompt:

> Inspect this repository as a static React/Vite application. Follow BOLT-HANDOFF.md and preserve the no-database MVP.
> Install dependencies and create/review the missing lockfile only when validation is authorized; report actual build/type/lint/test
> results. Preserve MOCK / NOT MEASURED labels and public-only browser inputs. Keep offline CLI, Docker witnesses and provider secrets
> outside browser execution. Identify concrete import gaps before changing source. Do not provision a backend, import sealed data,
> call providers, publish or deploy without a separate owner instruction.
