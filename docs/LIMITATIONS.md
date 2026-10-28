# Limits and unverified assumptions

**NOT MEASURED.** All review examples are synthetic and marked MOCK. The development tasks and expected labels were written by
the builder lineage, so they are neither independent data nor evidence of reviewer performance. No held-out set has been authored
or admitted by this construction team.

Actionable localization requires a valid request-changes verdict and a localized requires-change finding. This is a proxy: a nearby
finding may be wrong, and a finding outside the reference region may identify a real issue. The localization-match fraction is not
factual precision. The semantic-judge column is NOT RUN. Primary tolerance is k=2; k=0 and k=5 accompany it. Broad spans get no credit.

Stratum A describes defect catching only. Stratum B crosses author and reviewer and reports the per-task same-minus-different
contrast. Tasks, rather than repeated model responses, are the independent bootstrap clusters. Few tasks limit inference; null or
wide intervals are valid. Descriptive Wilson intervals ignore clustering. Exploratory McNemar uses one first-defect, first-repeat
observation per task within author. Missing, invalid and unavailable outcomes must remain visible, including undefined denominators.

Original compositions reduce direct benchmark reuse; they cannot exclude memorization or contamination. Any future public held-out
release burns the set for confirmatory use. Steward/validator developer overlap and custody/blindness attestations are disclosures,
not cryptographic proof of independence. Only Roy can appoint those sessions; builder children cannot fill those roles.

Provider request/response shapes, exact reported model identities, token billing, HTTP rejection billing and input ceilings have not
been exercised against a live API. Unknown billing retains the worst-case reservation and stops further calls. Agent subscription
session cost is unallocated, not zero. Roy's USD 40 ceiling is an aggregate upper bound; it cannot cover every worst-case planned
attempt, so an eventually authorized run may stop partial. No model pair, stage allocation, key or live call is approved by that ceiling.

Round 2 permits local dependency installation and offline validation. Actual completed checks are recorded in
[DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md); they do not establish sandbox isolation, provider compatibility,
held-out validity or usable browser rendering. Docker probes, witnesses and live calls remain NOT RUN.
The dev manifest is pending activation. The sandbox fails closed pending qualification; the intended security controls are unproven.
The exact activation/validation work is in [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md).

The sandbox reporter is not isolated from hostile code running under the same uid (10001). A fresh report directory outside
`/work` is insufficient if `/tmp` is listable: substrate code can discover and overwrite that report. Receipts are not proven
tamper-resistant. Address and qualify this boundary before treating sandbox output as trustworthy execution evidence (DV-16).

The MVP is a static viewer with an external offline CLI. It has no backend, user accounts, production access control, hosting or
deployment. Local file locks coordinate cooperating processes on one filesystem; they do not establish distributed ownership or
protect against an adversarial operator. Vault handling is procedural and must be independently checked before held-out use.
