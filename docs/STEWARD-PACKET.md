# Independent corpus steward packet (DRAFT)

> **DRAFT, awaiting Roy's appointment (R3).** Nobody is appointed. This packet gives no authority by itself: work
> starts only after Roy writes a `roy-grant/v1` file naming you as steward. It was written by the builder lineage
> (S41-INT subagent 0850) and contains **no held-out content**: no task, spec, code, test, label or example of any
> held-out item. The gate meanings below follow the adopted Claude plan §7.5 plus PLAN K21; no gate is claimed
> passed. Authoring also requires the pre-generation commitment and the deferred G8 receipt in section 3. Dirty
> Mode remains active with Round 2 bounded local validation; live calls and credential access stay forbidden.

You are the independent corpus steward for S41 `pr-review-judgment`. You write the held-out corpus H01–H10 in the
sealed vault, spec-first, with hidden suites and labels. A separate independent validator diagnoses it blind, runs
every witness, and audits stratum B (`docs/VALIDATOR-PACKET.md`). Neither of you is the builder.

## 1. Before you start

1. **Session.** A fresh session that has never been part of the builder lineage (`protocol/builder-lineage.json`
   lists every builder callsign by its 4-character id). Recommended developer (K7): Gemini (Antigravity); the reviewer
   models are OpenAI and Anthropic, and the builder is Anthropic. If Roy selects the Claude/Codex fallback instead, the
   grant says `developer_overlap_disclosed: true` and G2 passes only with that disclosure (K21).
2. **Callsign (AgentNamer).** From the outer shell `C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment`,
   run `python "C:\Users\Roy Harden\OneDrive\PJ-OD\skills\skills-bts\AgentNamer\scripts\claim.py" whoami`, then
   `claim --model <your model> --title S41Steward` if unclaimed. Enroll in the Bolt.New workspace registry and in this
   app's registry as `Bolt.New\AGENTS.md` describes. Put `Callsign: <name>` on your first reply and sign every file
   you write with it. Roy's grant names you by this callsign, so claim **before** Roy writes the grant.
3. **Roy's grant.** Roy writes `grants\roy-grant-R3.json` (the builder never writes it):

   ```json
   {
     "schema": "roy-grant/v1",
     "item": "R3",
     "granted_by": "Roy",
     "steward": "<steward callsign>",
     "validator": "<validator callsign>",
     "developer_overlap_disclosed": false,
     "granted_at": "<ISO 8601 time>",
     "statement": "<Roy's words, verbatim>"
   }
   ```

   Steward and validator must be different sessions (different 4-character ids). `src/core/admission/grant.ts` is
   the exact schema. Do not start until the file exists and names you.
4. **Where you work.** Only inside `C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment\.heldout\`. The one
   exception is the commitment line in the inner repo's `corpus/heldout.commit` (section 6). Never write anywhere
   else in the inner repo, and never commit or push anything.
5. **Access log.** Append one JSON line to `.heldout\access.log.jsonl` every time you open, write or hand over vault
   content: `{"at": "<ISO time>", "callsign": "<you>", "action": "<read|write|handover|freeze>", "paths": [...],
   "note": "..."}`. The CLIs append their own lines to the same file. Never delete or rewrite a line.
6. **Chat export.** Your transcript contains held-out content, so it must **not** go to the usual
   `Bolt.New\.chatexports` or the app shell's `.chatexports` (the builder can read both). Export only into the vault,
   at session start, after each task, and before your final report:

       xexport current --source <claude|codex|cursor|grok|antigravity> --session-id "<exact own session id>" \
         --format html --mode append --callsign "<your callsign>" \
         --out "C:\Users\Roy Harden\OneDrive\PJ-OD\Bolt.New\pr-review-judgment\.heldout\.chatexports"

   The session id comes from your harness variable (`CODEX_THREAD_ID`, `CURSOR_CONVERSATION_ID`,
   `CLAUDE_CODE_SESSION_ID`, `GROK_SESSION_ID`, `ANTIGRAVITY_CONVERSATION_ID`); never pick by recency. This overrides
   the dual-export rule in `Bolt.New\AGENTS.md` for custody reasons; Roy confirms it in the grant statement.

## 2. What you may and may not read

- **Read:** this packet; `docs/CORPUS.md` (format and policy); `PLAN.md` §5 in the outer shell;
  `src/core/defectcorpus/schema.ts` (record shapes); `src/core/defectcorpus/leakscan.ts` (word rule);
  `src/core/operators/` (to apply an operator exactly); `sandbox/entry.mjs` (the compile and test environment); the
  dev corpus `corpus/dev/` **for format only**.
- **Never read** the scoring side, so the corpus cannot be tuned toward or away from it: `src/core/reviewjudge/`
  (prompt, matcher, classifier, aggregate, and the baselines including the diff heuristic),
  `protocol/diff-heuristic.rules.json`, `fixtures/reviews/`, `fixtures/b/`, `results/`, and any reviewer output.
- **Never read** the builder's `planning\`, `.thinking\`, `agentops\` or chat exports.
- **Never send held-out content to any model API** (including the two reviewer models) and never paste it into a
  builder-lineage session. Roy approved a **USD 40 aggregate ceiling only** (`ROY-SPEND-CAP-20261027.md` in the outer
  shell). Live execution remains disabled; no stage sub-caps or credential access are approved. This packet grants
  no spending authority.

## 3. What you write (PLAN §5, K2)

**Before generating any held-out spec, test, code or variant:**

1. Verify the mandatory R3 appointment separately from the admission gates. It does not stand in for G1 rights.
2. Require the **G2 pre-generation commitment**: the fixed 16-task inventory (T01–T06 dev, H01–H10 held-out), split
   seed 4101, quotas below, and cross-split disjointness audit must have been committed before generation. Record
   the version-control commit id, exact inventory/quotas digest and timing evidence in
   `.heldout\steward\INVENTORY-COMMITMENT.json`; bind it from G2. The builder supplies any public inventory commit;
   you do not commit to or change the inner repo. Preserve historical evidence for the existing dev split too;
   a new commitment cannot establish earlier timing. Missing timing evidence leaves G2 unresolved, never backdated.
3. Require the **G8 dev-difficulty receipt** `corpus/DEV-DIFFICULTY.json` in the inner repo: the frozen dev-corpus
   digest, diff-heuristic implementation and rules digests, total dev defects, caught count, rate **< 0.80**, execution
   time and rule-lock commit. This receipts-only metadata is an explicit exception to section 2's scoring-output
   ban; never open the rules, findings or scoring implementation. G8 is **DEFERRED until R7 closes Dirty Mode**;
   no receipt or pass is asserted here. A rate **≥ 0.80**, including exactly 80%, blocks authoring: the builder must
   harden dev and adjust this brief, then rerun and lock on dev only before you begin. Missing G8 evidence also
   blocks authoring. This is distinct from the paid-model K9 qualification band.
4. Record the G2 commitment and G8 receipt digests and their times before your first authoring event in the access
   log. Quotas are fixed before generation and never relaxed after a repair. Do not inspect held-out content to
   choose heuristic rules or dev difficulty.

Ten tasks, H01–H10, in the same layout as the dev split, under `.heldout\corpus\`:
`H##\task.json` and `H##\variants\{c,n,d1,d2,d3,d4}.json` (`labels_authority: "steward_heldout"`, `split:
"heldout"`). Each task: spec (a feature request), intent, base, correct head, near-miss head with a named guard test,
four single-change seeded heads, and a hidden vitest suite. `docs/CORPUS.md` gives every field and rule; the schema
enforces the shapes.

| Quota | Required |
|---|---|
| Tasks | exactly 10 (H01–H10), each with exactly 4 seeded heads (40 total) |
| Per group | exactly 10 each of G-BND, G-ACC, G-ASY, G-ERR, across the 40 (any distribution per task) |
| Origin | at least 14 `operator:<Name>` and at least 14 `hand` |
| Size | ≤ 2 files and ≤ 150 executable lines per task; reviewer input under 12,000 tokens |
| Near-miss kinds | each of the six kinds in `docs/CORPUS.md` used at least once across the ten tasks |
| Originality | new compositions, disjoint from T01–T06 and from each other; no imported benchmark, kata or library code |

## 4. Spec-first procedure, per task

1. Write the **spec** and the **intent** first, in plain feature-request language with numbered requirements.
2. Write the **hidden suite** from the spec alone, before any implementation: one or more tests per requirement,
   static leaf titles unique in the file, no shared mutable state, explicit `vitest` imports, no timers or I/O.
3. Write the **base** (the code before the PR), then the **correct head** that satisfies every requirement.
4. Write the **near-miss** (correct but suspicious-looking; one of the six kinds) and name its **guard test**, the
   test that exercises the suspicious code. The whole suite must pass on it.
5. Write four **seeded heads**, each exactly one contiguous change to the correct head, on a line the PR adds or
   changes, that still type-checks. For `operator:<Name>`, apply exactly one candidate that `src/core/operators`
   would enumerate on the correct head, byte for byte; otherwise it is `hand`. Name each one's **witness test**: a
   test that fails on that head and passes on the correct head. Give group, kebab-case tag and severity.
6. Record **provenance** in `.heldout\steward\PROVENANCE.jsonl`, one line per variant: task, variant id, origin,
   time, and every candidate you considered and rejected with the reason. Nothing is chosen by looking at how a
   reviewer or baseline would score it.
7. **Leak words.** No reviewer-visible byte (spec, paths, base, head, comments, strings) may contain the PLAN §3.5
   words; mind the camelCase rule in `docs/CORPUS.md`. Check by reading and with the scan.

## 5. Freeze, blind validation and the one repair window

1. **Freeze v1.** When all ten tasks are done, write `.heldout\corpus\FILES.sha256` (the `sha256sum` line of every
   file under `.heldout\corpus\`, sorted by path) and log a `freeze` access line with its own sha256.
2. **Blind set.** For the validator's blind pass, write `.heldout\blind\` with one file per change that holds only
   what a reviewer sees (spec, and each touched file's path, base and head), named by a random id, in shuffled
   order, plus a private key file `.heldout\steward\BLIND-KEY.json` mapping each random id to its variant. Tell the
   validator the blind set is ready; do not tell them anything else about it.
3. **Reconciliation.** After the validator reveals and reconciles (`.heldout\validator\VALIDATION.jsonl`), you get
   **exactly one repair window** to fix every contradiction it lists (a seeded head that is not a defect, a witness
   that does not witness, a near-miss that is wrong, a leak, a quota or size breach). Log each repair. There is no
   second window: anything still unresolved after it, or after the validator's final verify run, makes the corpus
   NO-GO (S41's measured stages are skipped, not downgraded).
4. **Freeze final.** Rewrite `FILES.sha256` for the repaired corpus and log it. No change after this point, ever,
   before Roy's publication decision (R4). The repair window and the final freeze happen **before any review** of
   held-out data by any reviewer or baseline.

## 6. Commitment, attestation and admission evidence

- **Commitment.** Replace the placeholder text of the inner repo's `corpus/heldout.commit` with exactly one line: the
  sha256 of the final `FILES.sha256`, followed by your callsign and the time. This is the only inner-repo file you
  write; it reveals nothing about the content.
- **Custody and blindness attestation (G9).** Write `.heldout\attestations\steward.json`: your callsign, developer and
  model, session id, the final commitment hash, and the statements: you authored H01–H10 yourself; you did not read the
  files listed as never-read in section 2; you sent no held-out content to any model API or builder session; you did
  not reveal labels or the blind key to the validator before its blind diagnoses were frozen; every access is in the
  access log. It is a procedural attestation, not proof, and says so.
- **Additional timing evidence.** Write `.heldout\steward\COMMITMENT.json`: final `FILES.sha256` hash, both freeze
  times, authoring-start time, and the G2 and G8 evidence digests/commit ids proving their earlier timing. The
  validator checks it. Final corpus commitment and pre-authoring rules lock supplement the gates; neither replaces
  G8's measured dev-difficulty condition.
- **Admission (K21).** The canonical gate meanings are below. The separate mandatory R3 appointment is supplied
  through `--roy-grant`, never as G1. `admit` records one evidence file per gate, checks the appointment and G3/G4
  receipt contents, and hashes the other evidence files. File existence and hashes do **not** establish the truth
  of rights, independence, difficulty or procedural attestations: the named owners must audit and sign those
  claims before anyone requests GO. This document is a packet contract, not a claim that those audits ran.

  | Gate | Evidence (path inside the outer shell) | Owner |
  |---|---|---|
  | G1 rights: every file has provenance and MIT authority; no forbidden inputs | `.heldout\steward\RIGHTS.json` (per-file provenance/license audit binding `PROVENANCE.jsonl`; no real PRs, benchmark/gold, client, Gauntlet or partner inputs) | steward, audited by validator |
  | G2 independence: builder/steward/validator are three distinct sessions; steward and validator have different developers, neither OpenAI nor Anthropic unless Roy selects the disclosed fallback; inventory/quotas committed before generation | `.heldout\attestations\developers.json` (both developers/models/harnesses/session ids, builder-lineage exclusion, and `INVENTORY-COMMITMENT.json` digest/timing); overlap passes only if the R3 grant explicitly sets `developer_overlap_disclosed: true` (K21) | steward + validator |
  | G3 witnesses: 100% of retained defects fail their named witness twice and their correct counterpart passes it twice, in the qualified sandbox | `.heldout\runs\verify-<date>\witness-receipts.jsonl` | validator |
  | G4 counterparts: every correct and near-miss head passes its full suite, including the guard, twice | the same validator receipts file | validator |
  | G5 quotas after the single repair window: exactly 40 defects, 10/group, ≥14 operator and ≥14 hand; size/near-miss limits in section 3 | `.heldout\steward\QUOTAS.json` (final counts, files/lines and input sizes) | steward, checked by validator |
  | G6 validation: no retained item is disputed after blind diagnosis, reconciliation and one repair window | `.heldout\validator\VALIDATION.jsonl` (explicit final resolution per item; unresolved disputes removed within the window, with quotas rechecked; failure means NO-GO) | validator |
  | G7 leakage: neutral-id scan clean and no held-out bytes in the inner repo | `.heldout\validator\G7-EVIDENCE.json` binding the immutable verification summary and separate `LEAKSCAN.json` audit (0 word/fence hits, no label fields in reviewer/public projection, and repo-custody audit; hashes/receipts are allowed) | validator |
  | G8 difficulty, dev only: frozen diff-heuristic catches <80% of dev defects before held-out authoring | `pr-review-judgment/corpus/DEV-DIFFICULTY.json` (receipt defined in section 3; rules and corpus digests plus timing) | builder produces dev-only receipt after R7; validator checks it |
  | G9 custody/blindness: both signed attestations plus receipts-only access log | `.heldout\attestations\G9-EVIDENCE.json` (single co-signed digest-binding document, below) | steward + validator |

- **One G9 input.** After both attestations exist, steward and validator co-sign `G9-EVIDENCE.json`. It contains
  `schema: "custody-evidence/v1"`, the final corpus commitment, both appointees' callsigns/session ids and signed
  times, and the paths and exact-byte SHA-256 digests of `steward.json` and `validator.json`. For the append-only
  access log record its path, byte count, cutoff time and SHA-256 of that exact prefix; the prefix must cover every
  corpus read/write, handover, execution and both attestation writes through that cutoff. Log the G9 write/signing
  afterward, without rewriting the prefix. Later access remains appended and auditable. The validator verifies
  every digest and prefix length before co-signing. No raw access entries or held-out bytes are embedded. These
  are procedural attestations, not cryptographic proof of blindness; no G9 file is authored by the builder.

  Command (outer shell, authorized validator/admission phase only; all actual gates must be satisfied):

      npx tsx pr-review-judgment/cli/admit.ts --root . --lineage pr-review-judgment/protocol/builder-lineage.json \
        --out pr-review-judgment/corpus/ADMISSION.json --invoked-by <callsign> --decision GO \
        --steward <steward> --validator <validator> --roy-grant grants/roy-grant-R3.json \
        --gate G1=.heldout/steward/RIGHTS.json --gate G2=.heldout/attestations/developers.json \
        --gate G3=.heldout/runs/verify-<date>/witness-receipts.jsonl \
        --gate G4=.heldout/runs/verify-<date>/witness-receipts.jsonl \
        --gate G5=.heldout/steward/QUOTAS.json --gate G6=.heldout/validator/VALIDATION.jsonl \
        --gate G7=.heldout/validator/G7-EVIDENCE.json --gate G8=pr-review-judgment/corpus/DEV-DIFFICULTY.json \
        --gate G9=.heldout/attestations/G9-EVIDENCE.json \
        --verify-summary .heldout/runs/verify-<date>/verify-summary.json

  Without a valid grant the record stays `PENDING_ROY_APPOINTMENT`; any failed check writes NO-GO with the reasons.

## 7. After admission

After a GO, the builder sees only receipts, hashes and statuses (`corpus-verify --receipts-only`). Held-out stage
operations (`run`, `author-b`, `seed-b`, `eval`, B-PIN) are run by the builder only in non-printing modes with every
held-out-bearing artefact kept under `.heldout\runs\`, or, if Roy chooses, by the validator (K23). You keep the vault
sealed until Roy's R4 publication decision.

## Round 2 clarification

Bounded local validation is now authorized under the outer-shell Round 2 decision while Dirty Mode stays open.
No actual steward/validator or human-independent stand-in is appointed by this packet. Builder lineage remains
excluded. Any authorized delegated stand-in must be outside builder lineage and label construction work
"delegated stand-in, not human-independent" and "independence PENDING - Roy"; it cannot fabricate a Roy grant,
independence attestation, witness receipt or admission GO. The current builder has no such independent seat.
The public R3 appointment file belongs at outer-shell `grants/roy-grant-R3.json`, outside the sealed vault; it
contains control identities, never held-out source. Actual held-out bytes and appointee transcripts stay sealed.

### G7 binding without dropping the leakage/custody audit

The validator writes `.heldout/validator/G7-EVIDENCE.json` only after both companions exist. Its closed shape is:

```json
{
  "schema": "g7-verification-evidence/v1",
  "verification_summary": {"path": ".heldout/runs/verify-<date>/verify-summary.json", "sha256": "<exact summary SHA-256>"},
  "leakage_custody": {"path": ".heldout/validator/LEAKSCAN.json", "sha256": "<exact audit SHA-256>"}
}
```

Paths are safe POSIX paths relative to the declared `--root` (the outer shell in the command). The wrapper,
summary and audit must be distinct files, without symlink/hardlink aliasing; both companions stay inside the
canonical vault. The generated summary remains immutable. Admission reads/hashes both companions without
printing private contents; it checks summary grant/receipt bindings and exact per-change/task input-ceiling
coverage. The audit retains the original neutral-ID, leakage, projection and no-held-out-bytes-in-repo obligations.
Hashes prove file binding, not procedural truth, human independence or sandbox qualification. No builder authors
this wrapper, audit or real held-out summary. Old G7 files/summaries must be regenerated by the authorized validator.
