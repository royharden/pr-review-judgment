# Relaunch handoff: held for RAM and normal validation

Roy's latest instruction supersedes earlier Round 2 execution allowances for this stop: no Docker or installs now.
No new source milestone remains unblocked. This document lists later commands, not authorization to run them.
Resume only after Roy relaunches the seat when RAM is free and confirms the applicable normal-validation scope.

## Done

M1-M6 construction is complete. Local commits 47b0bb0 and 1ea4dab contain the offline fixes, lockfile and activation
handoff. Typecheck/lint/build passed; full suite 366/366 passed before the final G7 wrapper, then affected 22/22
passed on the final wrapper. Source reviews were within builder lineage. No real held-out data or measured result.
See DEFERRED-VALIDATION.md for exact check boundaries. No checks were rerun for this documentation-only stop.

## Held and why

- Tight RAM and Roy's explicit stop: no installs, Docker, service starts or further runtime work now.
- Required app witness image absent; previous authority allowed existing local images only. No build/pull was done.
- Same-uid sandbox reporter can be tampered with. Fix and qualify isolation before accepting witness receipts.
- Port preflight was UNKNOWN because Docker holder inspection was unavailable; no viewer server/browser launched.
- No independent non-builder steward/validator or eligible stand-in is available; human independence PENDING - Roy.
- Real provider keys/accounts, exact model pins, prices and live-stage allocations are absent. Live execution disabled.
- No remote, push, import, deployment, public release or public license adoption is authorized.

## Later installation and local checks (do not run now)

Use PowerShell from the inner repository:

    Set-Location -LiteralPath 'C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment\pr-review-judgment'
    Get-CimInstance Win32_OperatingSystem | Select-Object CSName,FreePhysicalMemory

Before EACH install or Docker step require free RAM above 3 GB; stop if lower. Installs stay project-local.
No credential/.env/SSH/token files may be read. If dependencies must be restored after the authorized relaunch:

    npm ci --ignore-scripts --no-audit --no-fund

After relevant source/dependency changes, select the needed checks from:

    npm run typecheck
    npm run lint
    npm test -- --maxWorkers=2
    npm run build

These already passed at the recorded checkpoint; avoid repeating them just to reproduce paperwork.

## Later Docker qualification (do not run now)

First resolve both source prerequisites: isolate the trusted reporter from untrusted task code, and reconcile
src/core/sandbox/argv.ts AGENT_PORTS_PROJECT with the actual machine ledger code s41prj. The current literal
s41-pr-review-judgment exceeds the ledger's project-code grammar. Reconcile labels/owner/container naming with the
claim output before starting any container; do not bypass the registry or weaken custody/image/probe checks.
The Dockerfile's dependency-install line also needs scripts disabled before an authorized new image build.

On KAISER-PRO only, after relaunch and memory check, inspect local availability:

    docker image inspect s41-prj-witness:0.1.0 --format "{{.Id}} {{json .RepoDigests}}"

If absent, STOP this branch. Roy must authorize obtaining/building an image; previous existing-image-only scope
does not permit assuming that a build or pull is granted. If Roy later explicitly approves a build, pin the real
base-image digest in sandbox/Dockerfile, use existing approved base layers, preserve dependency pins, then:

    docker build --pull=false -t s41-prj-witness:0.1.0 sandbox
    docker image inspect s41-prj-witness:0.1.0 --format "{{.Id}} {{json .RepoDigests}}"

Do not run a build as a workaround for a missing base image. Do not push to obtain a repo digest.
Classic local image IDs may not resolve as name@sha256 references; explicitly verify local digest-addressed
resolution with --pull never once authorized. If unavailable, record the blocker; do not loosen the digest check.

Before any container, claim/check the witness instance with the canonical agent-ports tool:

    python 'C:\Users\Roy Harden\OneDrive\PJ-OD\skills\skills-bts\agent-ports\scripts\ports.py' claim --project s41prj --instance witness-sandbox --kind verify --services none --owner '<PLACEHOLDER_OPERATOR_CALLSIGN>'
    python 'C:\Users\Roy Harden\OneDrive\PJ-OD\skills\skills-bts\agent-ports\scripts\ports.py' check s41prj/witness-sandbox

UNKNOWN/BLOCKED means no launch. Use the claim's actual labels and names; keep network disabled, no privileged
mode, no home/Docker-socket/credential mounts, and do not stop shared Docker/WSL or unrelated containers.
When the corrected, locally resolvable immutable image exists and source prerequisites have been qualified:

    New-Item -ItemType Directory -Path runs -Force
    node node_modules/tsx/dist/cli.mjs cli/sandbox-probe.ts --print-plan --image '<PLACEHOLDER_SANDBOX_IMAGE_REF>' --operator-callsign '<PLACEHOLDER_OPERATOR_CALLSIGN>'
    node node_modules/tsx/dist/cli.mjs cli/sandbox-probe.ts --image '<PLACEHOLDER_SANDBOX_IMAGE_REF>' --operator-callsign '<PLACEHOLDER_OPERATOR_CALLSIGN>' --out runs/sandbox-probe-receipt.json

Use a fresh exclusive receipt output path if one already exists; preserve originals. Require all six probes PASS
for the exact policy/image, plus explicit reporter-integrity qualification. A probe receipt alone does not resolve
the known same-uid reporter issue. Only then run DEVELOPMENT witnesses:

    node node_modules/tsx/dist/cli.mjs cli/corpus-verify.ts --split dev --corpus corpus/dev --image '<PLACEHOLDER_SANDBOX_IMAGE_REF>' --probe-receipt runs/sandbox-probe-receipt.json --seed 4101 --operator-callsign '<PLACEHOLDER_OPERATOR_CALLSIGN>' --out runs/corpus-verify-dev-relaunch --access-log runs/access.log.jsonl

Do not reuse an existing exclusive output directory. Actual held-out verification/admission remains a separate
non-builder validator duty using STEWARD-PACKET.md and VALIDATOR-PACKET.md, including G7 wrapper/audit binding.
The prior viewer claim S41PRJ/round2-viewer is held at 127.0.0.1:23400; do not assume it is free on relaunch.
Recheck/reconcile its status before any browser journey; no browser work is required during this stop.

## Placeholders and owner questions

The six access/model tokens and exact destinations remain in ACTIVATION-PLACEHOLDERS.md:
OPENAI_API_KEY needs <PLACEHOLDER_OPENAI_API_KEY>; ANTHROPIC_API_KEY needs <PLACEHOLDER_ANTHROPIC_API_KEY>.
Private account records need <PLACEHOLDER_OPENAI_ACCOUNT_ID> and <PLACEHOLDER_ANTHROPIC_ACCOUNT_ID>.
Model-lock arm model_id fields need <PLACEHOLDER_OPENAI_MODEL_PIN> and <PLACEHOLDER_ANTHROPIC_MODEL_PIN>.
Never copy these literals into active locks or invent successful price/availability evidence.

Two noncredential command tokens above: <PLACEHOLDER_SANDBOX_IMAGE_REF> means a genuine, locally resolvable,
qualified name@sha256:64hex reference; <PLACEHOLDER_OPERATOR_CALLSIGN> means the actual authorized registry callsign.
They are not dummy evidence or identities to put in receipts.

Questions held for Roy's relaunch, not a request to act during this stop:
1. What normal-validation scope and image acquisition/build authority is approved once RAM is free?
2. Which non-builder steward/validator or eligible stand-in is appointed, and what genuine appointment evidence applies?
3. Which supplied accounts/keys, exact available model pair, dated prices and affordable stage allocations/pilot are approved?
4. Is any future remote/push/import/public release or public license adoption approved? Until then, all stay private.

Spend: USD 0 of USD 40 testing hard ceiling. No key supplied, no paid API/model/testing usage. Agent subscription
session costs remain unallocated. Log amount/date/purpose for every later spend; no credits/accounts may be purchased.
