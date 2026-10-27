# Corpus format

Stub written in M2 for the one rule the witness tooling depends on. The full corpus specification (task layout,
variants, provenance, manifests) is written in M5 (PLAN §9 M5); until then PLAN §5 and
`src/core/defectcorpus/schema.ts` are authoritative.

## Witness test naming

A defect's `witness_test` and a near-miss's `guard_test` are `TestRef = { path, name }`:

- `path` is one of the task's `hidden_tests` file paths.
- `name` is the vitest **leaf title**: the string passed to `test(...)` / `it(...)`, exactly as vitest reports it in
  its JSON reporter as `testResults[].assertionResults[].title`. It does **not** include enclosing `describe` titles
  (that would be `fullName`).
- The leaf title must be **unique within its file**, across all `describe` blocks. `sandbox/entry.mjs` selects the test
  with `--testNamePattern <escaped name>` and then requires exactly one executed test whose `title` equals `name`;
  zero or several matches are a `selection_error`, which is never a witness (the receipt is not witnessed and the task
  does not verify).
- `name` may not be `*`. `*` is the receipt sentinel for a whole-file suite run (`ALL_TESTS_IN_FILE` in
  `src/core/sandbox/verifyplan.ts`) and is refused as a witness test name.
- Avoid dynamic titles (`test.each` with interpolated values, template literals): the title vitest reports must equal
  `name` byte for byte.

These vitest 4 behaviours (`assertionResults[].title` is the leaf title; `--testNamePattern` matches against the full
name) are activation checks listed in `docs/DEFERRED-VALIDATION.md` DV-16, not verified facts.
