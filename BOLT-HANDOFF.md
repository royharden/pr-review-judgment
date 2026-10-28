# Bolt handoff: Review Judgment

Status: **construction with bounded local validation; NOT MEASURED**. See docs/DEFERRED-VALIDATION.md for actual results.

The import root is this inner repository. It contains a React 18 / TypeScript / Vite static viewer and a separate offline Node CLI.
No import, publish, deploy or remote creation is authorized in the current construction run.

## Target and inventory

- Database: **none**. No migrations, functions, storage, authentication or Realtime resources are required for the MVP.
- Frontend entry: `index.html` → `src/app/main.tsx`. Output directory: `dist` (local production build passed).
- Public inputs: `corpus/dev.public.json`, `fixtures/reviews/cases.json`. MOCK tables are computed by shared pure core functions.
- Runtime: Node >=22 with the declared package versions. Dependencies were installed with scripts disabled; package-lock.json pins the resolved dependency tree.
- Offline tooling: `cli/`, including admission, witness verification, replay/evaluation, ledger-backed execution and stratum B preparation.
  The static host does not run this tooling or Docker. Keep it on a separately authorized operator machine.
- Secrets: no browser secrets or `VITE_*` provider credentials. Future offline adapters name `OPENAI_API_KEY` and
  `ANTHROPIC_API_KEY`; access/provisioning remains an owner step, and live execution remains disabled.
- Backend option: only if Roy changes R5, queue a later authenticated, capped demo service and published-results storage.
  The MVP does not imply that service exists.

## Local validation and later activation

Round 2 permits app-local `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npm run lint`,
`npm test` and `npm run build`. See `docs/DEFERRED-VALIDATION.md` for completed checks and unresolved CLI,
sandbox and witness qualification. Check free RAM exceeds 3 GB before installation or Docker; Docker may use only
existing local images on KAISER-PRO. The required app witness image is absent; no image build/pull was performed.
When a dev server is authorized, first claim/check the actual instance through agent-ports; do not assume a default port is free.

Frontend acceptance: inspect Reviews, filter/select every fixture, switch matcher k, inspect findings and regions; browse all public
dev tasks; inspect Protocol. Confirm MOCK stamps remain visible and measured results stay empty. Inspect the built dependency graph
and assets for any private companion, hidden test or held-out import. No browser/network provider call should occur.

## Owner steps and future preparation prompt

Roy must separately authorize later import/publication; Round 2 already authorizes bounded local validation. Held-out author appointment, admission, model lock, dated prices,
stage budget allocations, and actual provider access remain separate gates; importing the static viewer resolves none of them.

After authorization, give Bolt this inspection/preparation prompt:

> Inspect this repository as a static React/Vite application. Follow BOLT-HANDOFF.md and preserve the no-database MVP.
> Use the committed lockfile with install scripts disabled when installation is authorized; report actual build/type/lint/test
> results. Preserve MOCK / NOT MEASURED labels and public-only browser inputs. Keep offline CLI, Docker witnesses and provider secrets
> outside browser execution. Identify concrete import gaps before changing source. Do not provision a backend, import sealed data,
> call providers, publish or deploy without a separate owner instruction.

Missing access and pins: [ACTIVATION-PLACEHOLDERS.md](docs/ACTIVATION-PLACEHOLDERS.md). No secret belongs in the static viewer.
