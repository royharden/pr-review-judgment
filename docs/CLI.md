# Offline CLI contracts

Round 2 permits bounded local offline validation while Dirty Mode remains open. Actual checks and outstanding
limits are in DEFERRED-VALIDATION.md. Live provider access, held-out custody and publication stay gated; no
invocation below is permission to fabricate evidence or supply real credentials.
Paths in angle brackets are operator-provided files, never an instruction to fabricate admission evidence.

## Development manifest activation

After R7, `npx tsx cli/dev-manifest.ts --root . --out corpus/manifest.dev.generated.json` reads only the fixed development inventory,
projects public records, sorts neutral ids and binds them with the documented canonical hash. It creates a new file exclusively.
Preserve the pending stub before separately promoting inspected output to corpus/manifest.public.json. The generated source manifest
explicitly says runtime_validated:false; it does not assert witness results or admission.

## Keyless development replay

`npx tsx cli/replay.ts --bundle <dev-replay-bundle.json> --out <new-output-dir>`

Input `replay-bundle/v1` is defined in `src/core/runstate/recordings.ts`; it supplies a fixed `generated_at`, run id,
planned slot metadata, task/variant records and synthetic provider envelopes. Replay parses provider output, classifies
findings, aggregates and writes `replay.mock.json` and `replay.mock.md` exclusively. These are MOCK, never measured.
The viewer's smaller `fixtures/reviews/cases.json` is a different UI fixture contract, not a replay bundle.
Use identical input timestamps/bytes to compare deterministic report hashes; use a fresh output directory per invocation.

## Shared held-out custody

`run`, `author-b`, `seed-b`, `eval` and held-out export use `--root . --operator-callsign <operator> --lock <public-control-lock.json> --access-log <vault-relative-log.jsonl>`.
Their private input/output/run paths are relative to the canonical outer `.heldout` vault, checked by realpath (including destination
parents) and access-logged there; source-bearing diagnostics are withheld. The public control lock, appointment and admission are
validated before private consumption. None of these gates is satisfied today. There is no public/dev bypass for private run,
author qualification, seeding or measured evaluation. `replay` is the separate keyless MOCK development path.

## Locked, eventually authorized execution

`npx tsx cli/run.ts --root . --operator-callsign <operator> --lock <public-control-lock.json> --access-log <vault-log.jsonl> --plan <vault-plan.json> --owner <unique-owner> --live`

Use `--resume` only for the same persisted plan and lock. `run-plan/v1` is declared in recordings.ts; source contracts
in `src/core/protocol/` define the lock, grant, look registry and B pin. Lock every required source/config/input byte.
Source construction does not create an approved run plan, model identity, price receipt, stage grant or qualification receipt.
The committed budget, admission, model and prices block this command today. Future host transport uses process environment
names `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` only after gates pass and live invocation is explicitly selected; browser inputs
never receive those values. Do not store keys in the repo, a run plan or a lock.

Costs and unknown liabilities must remain in the app-wide ledger across run ids. A crash after reservation without proof
of no-send is unknown; sent/unknown attempts are never silently resent. Missing ownership or ambiguous billing halts work.
Vault inputs and per-slot held-out artifacts must remain in the outer sealed vault with procedural access logging.

## Terminal evaluation

`npx tsx cli/eval.ts --root . --operator-callsign <operator> --lock <public-control-lock.json> --access-log <vault-log.jsonl> --run <vault-run-dir> --generated-at <ISO-8601-time> [--out <vault-report-dir>] [--freeze]`

Evaluation is keyless/network-free but can consume measured private data, so held-out use remains separately gated.
It reconciles persisted execution authorization, terminal state, raw transport/request/response artifacts, app ledger and exact planned slots; emits sourced `results.json`/`results.md`. `--out` defaults to the run reports directory. `--freeze` binds those exact reports and terminal execution into a durable exclusive freeze record.
Do not manually edit a run into a terminal state or move private source-bearing files into public output.

## Immutable B generation inputs

B locks carry `b_generation_corpus_path` and `b_generation_corpus_sha256`. The referenced `b-generation-corpus/v1`
pre-generation descriptor binds the original GO admission, an immutable vault copy of the admitted manifest, approved configuration,
author models/system prompt, and actual locked task/suite/prompt hashes. Its generation commitment is separate from the later derived
B review manifest. Author and review plans must use the exact admitted tasks in the descriptor; a new final manifest cannot substitute them.
See the closed source schema and validator in `src/core/protocol/b.ts` and the host custody helpers for required fields.

Before any reservation/send, a run creates an exclusive synced `INPUTS.json` and hash-addressed `inputs/<sha>.bin` snapshots.
Persisted execution binds `input_snapshot_path` and `input_snapshot_sha256`. Historical author verification reads those original bytes,
not a later manifest installed at the original pathname. Actually executing `src/core` and `cli` source must still hash-match the
original lock; snapshots do not authorize running a different evaluator. All private snapshots stay in the canonical vault.

## Stratum B and S45

- `npx tsx cli/author-b.ts <shared-custody-flags> --run <vault-author-run> --slot <author-slot-id> --recordings <vault-qualification.json> [--out <vault-qualified.json>]` qualifies recorded fresh author
  outputs against sandbox receipts and audit evidence; at most two fresh attempts, never hidden-failure feedback.
  Eventual paid generation is scheduled as author slots through the same ledger-backed run path. Qualification binds actual persisted generation history, requests/envelopes, model identity, independent audit and witness receipts; a second fresh attempt requires first-attempt qualification failure. The default output is a qualified artifact under the vault.
- `npx tsx cli/seed-b.ts <shared-custody-flags> --evidence <vault-seed-evidence.json> [--out <vault-B-PIN.json>]` enumerates operator sites in changed runs,
  requires qualified author artifacts, appointed-validator audits and exactly two bound witnessed mutants per admitted substrate and creates a non-overwritable pin. The non-circular generation commitment is separate from the later review lock. Every reviewed head must match its pinned author cell.
- Held-out export: `npx tsx cli/export-s45.ts <shared-custody-flags> --run <vault-run-dir> --freeze <vault-run-dir/FREEZE.json> --bundle <vault-s45-export.json> --public-out <vault-public.jsonl> [--reports <vault-report-dir>]`.
  Before release, outputs stay inside the canonical vault. `--reports` defaults to the frozen run reports directory.
  Export checks the complete preregistered terminal review inventory and exact task/source/label correspondence, not an author-only run.
- Release additionally requires `--release-authorized --roy-grant <public-roy-release-grant-v2.json> --private-out <private.jsonl>`.
  Release destinations resolve relative to the repo. The v2 grant binds the exact freeze/terminal execution/report/slot/corpus digests,
  stage, manifest/export hashes, exact public/private output hashes and hashes of their absolute resolved destination paths.
  Future stage manifests must have pending_activation:false and verified canonical hashes; embargoed records are verified in their
  committed representation before opening. Terminal-partial release still requires complete terminal slot inventory and the exact grant.
- Development-only public export: `npx tsx cli/export-s45.ts --dev --bundle <dev-s45-export.json> --public-out <dev-public.jsonl>`.
  This mode refuses private output, Roy grant, release, run, freeze, reports, operator, lock and access-log flags; it cannot promote
  development content to a measured/private release.

These input evidence formats are source contracts, not proof of their contents. Builder-authored MOCK recordings cannot
stand in for independent witnesses, custody/blindness attestations or a Roy grant. See PROTOCOL.md and the independent-author packets.

Look authorization binds the validated stage and locked uniform purpose (author or review). Identical lock hashes are never reauthorized; a new run/lock cannot reset a consumed corpus/config/stage/purpose look. App-wide spend and generation history persist across run ids.

## Round 2 admission input ceiling

For held-out GO, `admit --verify-summary <vault-summary.json>` is mandatory; G7 is a closed `g7-verification-evidence/v1` wrapper binding the exact summary and separate
validator leakage/custody audit by path and SHA-256. Both companions stay in the canonical vault, separate
from the wrapper and each other, including hardlink identity. `corpus-verify` renders each reviewer-visible variant before witness execution and records
its prompt hash and conservative UTF-8 byte count, at most 12,000. Admission checks exact task/change coverage
against G3/G4 receipts, the ten-task summary inventory, and the appointment/receipt hashes. Old summaries lacking
this evidence fail closed and must be regenerated by the authorized validator. These checks do not appoint a
validator, prove human independence, qualify the sandbox or authorize the builder to read actual held-out bytes.
