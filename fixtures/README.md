# MOCK fixture recordings

Every recording here is synthetic developer data, not a measured review or an independent model-author output.

- `reviews/index.ts` is the browser-safe entrypoint. It imports only `reviews/cases.json`; it never imports a Task record, a test payload, or an S45 private companion. Six examples cover clean approval, HIT, DEFER, WRONG-PLACE, false rejection and INVALID (`schema_invalid`, classified UNAVAILABLE).
- `b/T01.json` and `b/T02.json` record both illustrative author arms using public developer examples. Each has two proposed seeds. Witness validation is NOT RUN, admission is false, and pin is null; these records cannot authorize B execution.
- `s45-stub/public.jsonl` has three public developer records, joined by neutral content id to `private.jsonl`. The companion is a dev fixture, never a viewer import. `manifest.json` supplies the exact file-byte hash in each public record. Extra `mock: true` stamps deliberately identify these as fixture records.

Output token counts in review examples are illustrative synthetic inputs. No provider calls, sandbox checks, or witness tests created them. The shared engine computes any displayed statistics from the records. Tests are written under `tests/core/reviewjudge/fixtures.test.ts` but have not run in Dirty Mode.
