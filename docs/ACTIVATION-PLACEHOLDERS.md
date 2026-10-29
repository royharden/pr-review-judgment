# Activation handoff: missing access and model details

Round 2 of the outer-shell `ROY-DECISIONS-ANSWERS-20261027-delegated.md` permits bounded local validation while Dirty Mode remains open. This is a private construction handoff. No public license adoption, publication, remote or account creation is authorized. No live model call has run. Independence remains **PENDING - Roy**; builder lineage cannot act as a steward/validator stand-in.

## Placeholder register

These tokens occur only in this document. They are not secrets, environment values to activate now, valid model pins, prices or attestations. Do not copy them into executable locks. The next integrator outside Dirty Mode supplies real details through Roy-approved access without reading credential, `.env`, SSH or token files.

| Placeholder | Future destination | Missing real detail |
|---|---|---|
| `<PLACEHOLDER_OPENAI_API_KEY>` | Operator process environment `OPENAI_API_KEY`; read by `cli/run.ts` only during gated live transport | Key Roy supplies for the approved OpenAI account; never a browser variable or committed file |
| `<PLACEHOLDER_ANTHROPIC_API_KEY>` | Operator process environment `ANTHROPIC_API_KEY`; read by `cli/run.ts` only during gated live transport | Key Roy supplies for the approved Anthropic account; never a browser variable or committed file |
| `<PLACEHOLDER_OPENAI_ACCOUNT_ID>` | Private activation/account ownership record, not the current request headers | Roy's authorized billing/account identity; current transport has no account-ID environment variable |
| `<PLACEHOLDER_ANTHROPIC_ACCOUNT_ID>` | Private activation/account ownership record, not the current request headers | Roy's authorized billing/account identity; current transport has no account-ID environment variable |
| `<PLACEHOLDER_OPENAI_MODEL_PIN>` | `protocol/model-lock.json`, assigned reviewer/author arm `model_id` at activation | Exact approved, available model identity matching the returned API model string; no alias substitution |
| `<PLACEHOLDER_ANTHROPIC_MODEL_PIN>` | `protocol/model-lock.json`, assigned reviewer/author arm `model_id` at activation | Exact approved, available model identity matching the returned API model string; no alias substitution |

The actual transport allows only OpenAI Responses and Anthropic Messages endpoints. It adds `Authorization: Bearer ...` or `x-api-key` from the corresponding operator process environment. No real environment values were inspected for this register. Model pins are JSON lock fields, not environment variables. Keep every current lock field null until genuine activation evidence exists; keep prices unset until dated rates and billing behavior are confirmed.

## Testing budget and spend

Roy's testing budget is **USD 40 total, hard ceiling**, only via keys/accounts he supplies. None are supplied. Recorded spend at this handoff (2026-10-27): **USD 0**, no model/API usage. Subscription-session cost remains unallocated and is not represented as paid API testing spend.

Proposed allocation is A USD 16, B USD 24, preparation USD 0. This allocation is planning only: `protocol/budget.json` remains `enabled:false` and all approved stage caps remain zero. The full study's conservative worst-case reservation exceeds USD 40, so it cannot be promised within this budget. Start with the smallest adequate dev pilot, qualify it, then activate only an affordable preregistered subset. Do not silently change model pairs or study counts to obtain a desired result.

Before each paid request, reserve its worst-case cost under both the stage cap and the USD 40 aggregate cap. Stop before either cap would be exceeded; retain unknown/crashed request reservations rather than treating them as free. Record every actual spend in the outer handoff with amount, date and purpose, plus provider usage/ledger references. No credits, new account or payment method may be purchased or created.

## Next integrator checklist

1. Read the latest outer-shell decisions, STATUS and HANDOFF. Preserve the distinction between local validation and measured live results.
2. Finish authorized local checks and record actual results. Before each install or Docker step, confirm free RAM exceeds 3 GB. Installs stay inside this app with install scripts disabled; Docker is Kaiser-Pro only, existing local images only, no pull, privileged mode or sensitive mounts.
3. Obtain Roy-supplied access and resolve the register above without credential-file reads. Confirm availability, exact returned model identity, dated prices, billing assumptions, output/input ceilings and prompt hashes before completing model/price locks.
4. Have separately authorized non-builder steward/validator seats satisfy the admission protocol. Stand-in construction is labeled "delegated stand-in, not human-independent" and "accepted for construction, independence PENDING - Roy"; do not fabricate appointments, signatures, labels, receipts or admission GO.
5. Activate only real approved stage allocations and an affordable pilot after the relevant gates pass. Keep the reservation stop-loss active and maintain the spend log. Live execution stays NOT RUN until then.
6. Obtain Roy's separate decision for push/remotes/publication and public license adoption. Local readiness does not authorize release.


Current local validation is recorded in DEFERRED-VALIDATION.md. Before actual admission, preserve both the
immutable verification summary and separate procedural leakage/custody audit through the closed G7 wrapper
specified in STEWARD-PACKET.md. Do not fill evidence references with invented digests or successful attestations.
The app witness image and a trustworthy isolated reporter are still unavailable/unqualified.


## Latest Roy stop: RAM hold
No Docker or installs now. Earlier Round 2 execution allowances do not authorize work during this stop. Resume only on Roy's relaunch; exact later commands, prerequisites, remaining questions and USD 0 of 40 spend are in [RELAUNCH-HANDOFF.md](RELAUNCH-HANDOFF.md). No earlier validation result changed.
