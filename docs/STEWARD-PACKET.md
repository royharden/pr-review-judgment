# Independent corpus steward packet (DRAFT)

> **DRAFT, awaiting Roy's appointment (R3).** Nobody is appointed. This packet gives no authority by itself: work
> starts only after Roy writes a `roy-grant/v1` file naming you as steward. It was written by the builder lineage
> (S41-INT subagent 0850) and contains **no held-out content**: no task, spec, code, test, label or example of any
> held-out item. G1 and G5–G8 below are the builder's draft mapping of the plan's admission gates and must be
> confirmed by S41-INT before this packet is issued.

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
3. **Roy's grant.** Roy writes `.heldout\grants\roy-grant-R3.json` (the builder never writes it):

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
  builder-lineage session. Approved spend is $0.

## 3. What you write (PLAN §5, K2)

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
- **Admission (K21).** `admit` (run in the outer shell by anyone; the invoker is recorded only as `invoked_by`) reads
  one evidence file per gate and refuses GO unless all nine exist, the G3/G4 receipts are the validator's, and the
  steward and validator signers are exactly the grant's appointees outside builder lineage:

  | Gate | Evidence (path inside the outer shell) | Owner |
  |---|---|---|
  | G1 appointment | `.heldout\grants\roy-grant-R3.json` | Roy |
  | G2 developer independence (or disclosed overlap) | `.heldout\attestations\developers.json` (both sessions' developer, model, harness) | steward + validator |
  | G3 every seeded head fails its witness, twice | validator's `.heldout\runs\verify-<date>\witness-receipts.jsonl` | validator |
  | G4 counterparts pass: the correct head passes every witness test, correct and near-miss pass the whole suite, twice | the same receipts file | validator |
  | G5 quotas and size limits (section 3) | `.heldout\steward\QUOTAS.json` (counts by group, origin, near-miss kind; files and lines per task) | steward, checked by validator |
  | G6 leak scan and projection (0 hits, no fence markers, no label fields in the public projection) | `.heldout\validator\LEAKSCAN.json` | validator |
  | G7 blind diagnosis, reconciliation and repair complete | `.heldout\validator\VALIDATION.jsonl` | validator |
  | G8 commitment written after the final freeze, and the diff-heuristic rules locked from dev before held-out authoring began | `.heldout\steward\COMMITMENT.json` (final `FILES.sha256` hash, freeze times, and the inner-repo commit id current when you began authoring, from `git -C pr-review-judgment rev-parse HEAD`; you record the id without opening the rules file, and the validator checks that `protocol/diff-heuristic.rules.json` was committed at or before it) | steward, checked by validator |
  | G9 custody and blindness | `.heldout\attestations\steward.json`, `.heldout\attestations\validator.json`, `.heldout\access.log.jsonl` | both |

  Command (outer shell, after Dirty Mode is closed under R7):

      npx tsx pr-review-judgment/cli/admit.ts --root . --lineage pr-review-judgment/protocol/builder-lineage.json \
        --out pr-review-judgment/corpus/ADMISSION.json --invoked-by <callsign> --decision GO \
        --steward <steward> --validator <validator> --roy-grant .heldout/grants/roy-grant-R3.json \
        --gate G1=.heldout/grants/roy-grant-R3.json --gate G2=... ... --gate G9=...

  Without a valid grant the record stays `PENDING_ROY_APPOINTMENT`; any failed check writes NO-GO with the reasons.

## 7. After admission

After a GO, the builder sees only receipts, hashes and statuses (`corpus-verify --receipts-only`). Held-out stage
operations (`run`, `author-b`, `seed-b`, `eval`, B-PIN) are run by the builder only in non-printing modes with every
held-out-bearing artefact kept under `.heldout\runs\`, or, if Roy chooses, by the validator (K23). You keep the vault
sealed until Roy's R4 publication decision.
