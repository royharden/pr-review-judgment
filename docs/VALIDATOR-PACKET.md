# Independent validator packet (DRAFT)

> **DRAFT, awaiting Roy's appointment (R3).** Nobody is appointed. This packet gives no authority by itself: work
> starts only after Roy writes a `roy-grant/v1` file naming you as validator. Witness execution and sandbox probes
> also need Dirty Mode closed (R7). It was written by the builder lineage (S41-INT subagent 0850) and contains **no
> held-out content**. G1 and G5–G8 are the builder's draft mapping of the plan's admission gates and must be confirmed
> by S41-INT before this packet is issued.

You are the independent validator for S41 `pr-review-judgment`. The steward writes the held-out corpus H01–H10
(`docs/STEWARD-PACKET.md`). You diagnose it **blind**, reconcile against the labels, run every held-out witness check
in your own session and sign the receipts (K19), check the quotas and the leak scan, and audit stratum B. You are a
different session from the steward and from every builder session.

## 1. Before you start

1. **Session.** Fresh, never part of the builder lineage (`protocol/builder-lineage.json`). Recommended developer
   (K7): Grok (xAI), which is neither a reviewer developer (OpenAI, Anthropic) nor the builder's (Anthropic), nor,
   by default, the steward's (Gemini). If Roy picks the Claude/Codex fallback, the grant sets
   `developer_overlap_disclosed: true`; your developer must still differ from the steward's.
2. **Callsign (AgentNamer).** From the outer shell `C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment`,
   run `python "C:\Users\Roy Harden\OneDrive\PJ-OD\skills\skills-bts\AgentNamer\scripts\claim.py" whoami`, then
   `claim --model <your model> --title S41Validator` if unclaimed; enroll in the workspace and app registries as
   `Bolt.New\AGENTS.md` describes. Claim before Roy writes the grant (it names you by callsign). Put
   `Callsign: <name>` on your first reply and sign every file you write.
3. **Grant.** Do not start until `.heldout\grants\roy-grant-R3.json` (schema in `docs/STEWARD-PACKET.md` §1 and
   `src/core/admission/grant.ts`) exists and names you as `validator`. `corpus-verify` refuses a held-out run whose
   `--operator-callsign` is not the grant's validator or is in builder lineage.
4. **Where you work.** Only inside `...\pr-review-judgment\.heldout\`; you run the inner repo's tools but never edit
   the inner repo, and never commit or push.
5. **Access log.** Append a line to `.heldout\access.log.jsonl` for every read, write, run or handover:
   `{"at", "callsign", "action", "paths", "note"}`. The CLIs append their own lines. Never rewrite the log.
6. **Chat export.** Your transcript will contain held-out content, so export **only** into the vault, at session start,
   after each phase and before your final report:

       xexport current --source <claude|codex|cursor|grok|antigravity> --session-id "<exact own session id>" \
         --format html --mode append --callsign "<your callsign>" \
         --out "C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment\.heldout\.chatexports"

   Use your harness's session variable (`GROK_SESSION_ID` for Grok CLI, etc.), never recency. This replaces the
   normal dual export to the builder-readable `.chatexports` folders, for custody; Roy confirms it in the grant.
7. **Never** send held-out content to any model API or to a builder-lineage session. Never read the builder's
   `planning\`, `.thinking\` or chat exports. Approved spend is $0. You may read all inner-repo source, including
   `cli/corpus-verify.ts`, which you run and are expected to read (K19).

## 2. Phase 1: blind diagnosis (before any reveal)

1. When the steward says the blind set is ready, read **only** `.heldout\blind\`: one file per change with what a
   reviewer sees (spec, and each touched file's path, base and head), under random ids, shuffled. Do **not** open
   `.heldout\corpus\`, `.heldout\steward\` (it holds the blind key) or any label until step 3.
2. For every change, write one line to `.heldout\validator\BLIND.jsonl`: random id; your verdict (`correct` or
   `breaks the spec`); if it breaks, the file, line range and the numbered spec requirement it breaks, and the group
   you would assign; your confidence; notes on anything suspicious that you judge correct. Work from the spec and the
   code only.
3. **Freeze** `BLIND.jsonl` (log its sha256 with a `freeze` access line). Only then open the blind key, the corpus
   and the labels. Never edit `BLIND.jsonl` after the freeze.

## 3. Phase 2: reconciliation

For every variant, record in `.heldout\validator\VALIDATION.jsonl`: your blind verdict vs the label; for seeded heads,
whether your location overlaps the region (derived by region/v1, not hand-entered) and whether you agree with the
group; whether the change is a single contiguous change on a PR-changed line; for operator origins, whether it is
exactly one candidate `src/core/operators` would enumerate; whether the witness test (and for near-misses the guard
test) does what its label says, by reading; and any leak-scan word or fence marker. You may **add** witness tests,
written spec-first from the spec, when a seeded head has none that works; record them as validator-authored.

List every contradiction for the steward. The steward then has **exactly one repair window**, before any review of
held-out data; re-check every repaired item. Anything unresolved after that window, or failing in the final verify run,
is a NO-GO reason. A disagreement you cannot settle with the steward goes to Roy; you never resolve it by editing the
corpus yourself.

## 4. Phase 3: execution in your session (K19)

Run in your own session, after Dirty Mode is closed (R7), from the inner repo, on the **final** frozen corpus:

1. Build the sandbox image and record its digest (DEFERRED-VALIDATION DV-12), then the six probes:

       npx tsx cli/sandbox-probe.ts --image <name@sha256:digest> --operator-callsign <you> \
         --out ../.heldout/runs/sandbox-probe-receipt.json

2. Held-out verify (every check twice, in two seeded shuffled orders; a timeout, crash or compile failure is never a
   witness):

       npx tsx cli/corpus-verify.ts --split heldout --corpus ../.heldout/corpus --image <name@sha256:digest> \
         --probe-receipt ../.heldout/runs/sandbox-probe-receipt.json --seed 4101 --operator-callsign <you> \
         --roy-grant ../.heldout/grants/roy-grant-R3.json --out ../.heldout/runs/verify-<date> \
         --access-log ../.heldout/access.log.jsonl

   It needs no admission GO (GO depends on these receipts). It refuses unless you are the grant's validator, outside
   builder lineage, with `--corpus` and `--out` inside `.heldout`. It writes `witness-receipts.jsonl` and
   `verify-summary.json` and never prints held-out test names. You own and sign these receipts: they are G3 and G4.
3. Leak scan and size: confirm 0 leak-scan hits and no fence markers on every reviewer projection, no label field in
   the public projection, and the reviewer input under 12,000 tokens; write `.heldout\validator\LEAKSCAN.json`. Check
   the steward's `QUOTAS.json` (10 per group, ≥ 14 operator, ≥ 14 hand, ≤ 2 files, ≤ 150 executable lines) and the
   G8 commit-order claim (the diff-heuristic rules were committed at or before the commit the steward began from).

## 5. Phase 4: stratum-B audit duty

After a GO, each locked author model implements every task's intent from its base (`author-b`, at most 2 fresh
attempts, no hidden-test failure text fed back). Before any substrate is seeded (`seed-b`), audit it **blind to which
author wrote it**: it implements the intent, passes the hidden suite twice (receipts), does not special-case the tests,
and contains no reviewer-directed text. Record each verdict in `.heldout\validator\B-AUDIT.jsonl`. A substrate is
admitted only if it passes the suite twice **and** your audit; a task enters Δ_self only if both authors' substrates are
admitted.

Rotation ([X], K6): each author's substrates are audited by a validator whose developer differs from that author's.
If you are the only non-builder validator (the default Grok appointment), you audit both authors, since neither is
xAI, and that fact is recorded in your attestation.

## 6. Attestation and admission

Write `.heldout\attestations\validator.json`: callsign, developer, model, session id; the sha256 of the frozen
`BLIND.jsonl`; the receipts file sha256; and the statements: you diagnosed blind before any reveal; you did not edit
the corpus; you ran every held-out witness check yourself; you sent no held-out content to any model API or builder
session; every access is in the access log. It is a procedural attestation, not proof, and says so. Co-sign
`.heldout\attestations\developers.json` (G2) with the steward.

The admission gates, their evidence files and the `admit` command are in `docs/STEWARD-PACKET.md` §6; G3, G4, G6,
G7 and your half of G9 are yours. You are a signer (`--validator`), never the invoker of record unless Roy says so.

## 7. After admission

Held-out stage operations are run either by the builder in non-printing modes with all held-out-bearing artefacts
under `.heldout\runs\`, or by you if Roy chooses (K23). In either case only aggregate tables and hashes leave the vault
before the report is frozen, and labels stay sealed until Roy's R4.
