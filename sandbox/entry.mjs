/* global process */
// Trusted in-image witness entry (copied to /opt/witness/entry.mjs by sandbox/Dockerfile). SOURCE ONLY: never run in
// Dirty Mode (DEFERRED-VALIDATION DV-12, DV-13, DV-16). Design-informed by S39 `d5f9e40` cli/sandbox/runner.mjs;
// implemented here (PLAN K13).
//
// Invoked by the host as: node /opt/witness/entry.mjs /in/request.json /work   (argv fixed by src/core/sandbox/argv.ts)
// 1. Copies /in/files/** (read-only bind) into /work (tmpfs) and links vitest/typescript from /opt/witness.
// 2. Type-checks the task and hidden test files with `tsc --noEmit` (strict). A compile failure is reported as
//    compile_error and is never a witness.
// 3. Runs vitest on the selected hidden test file (optionally one named test) in a seeded shuffled order and reads
//    vitest's JSON report. The report is written OUTSIDE /work (the test process's cwd and vitest root, which the
//    copied task files share) into a fresh 0700 directory under /tmp that this entry creates (mkdtemp, random suffix)
//    before any child is spawned. A named selection matches the vitest LEAF title (assertionResults[].title) exactly
//    and must match exactly one test in the file (docs/CORPUS.md "Witness test naming").
// 4. Prints exactly ONE JSON line to stdout: {"schema":"witness-entry/v1","status":...}. Child output is captured and
//    discarded, so test code cannot forge the report on stdout. Exit 0 = report printed; 2 = malformed request.
// STATED LIMITATION (DV-16): code under test and the tests run in the same container and as the same uid (10001) as
// this entry, and /tmp is listable, so a hostile substrate could still find and overwrite the report directory. Moving
// the report out of /work removes the accidental and trivial cases (a relative write, a write into the cwd); it does
// not isolate the report from a deliberately hostile substrate. Real isolation would need a separate uid or container
// for the reporter, which the no-new-privileges / cap-drop ALL policy does not allow.
// Assumptions about the vitest 4 CLI flags and JSON reporter shape are activation checks (DV-16), not facts.
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const WITNESS_ROOT = "/opt/witness";
const STATUSES = new Set(["pass", "assertion_fail", "compile_error", "load_error", "selection_error", "incomplete_suite", "crash"]);

function report(status, extra = {}) {
  if (!STATUSES.has(status)) status = "crash";
  process.stdout.write(`${JSON.stringify({ schema: "witness-entry/v1", status, ...extra })}\n`);
  process.exit(0);
}

const [requestPath, work] = process.argv.slice(2);
if (requestPath !== "/in/request.json" || work !== "/work") process.exit(2);

let request;
try {
  request = JSON.parse(await readFile(requestPath, "utf8"));
} catch {
  process.exit(2);
}
const safe = (p) => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
const sel = request?.selection;
if (
  request?.schema !== "witness-request/v1" ||
  !Array.isArray(request.source_paths) ||
  !Array.isArray(request.test_paths) ||
  ![...request.source_paths, ...request.test_paths].every(safe) ||
  !Number.isInteger(request.shuffle_seed) ||
  (sel?.kind !== "named" && sel?.kind !== "file") ||
  !safe(sel.path) ||
  !request.test_paths.includes(sel.path) ||
  (sel.kind === "named" && (typeof sel.name !== "string" || sel.name.length === 0))
) {
  process.exit(2);
}

const childEnv = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", CI: "1", NODE_ENV: "test" };
const runQuiet = (args) =>
  spawnSync(process.execPath, args, { cwd: work, env: childEnv, stdio: ["ignore", "ignore", "ignore"], shell: false });

// Report directory: created before any child runs, outside /work, mode 0700 (mkdtemp's mode), random suffix.
let reportDir;
try {
  reportDir = await mkdtemp(path.join("/tmp", "witness-report-"));
} catch {
  report("crash", { phase: "stage" });
}
const reportFile = path.join(reportDir, "vitest-report.json");

try {
  await cp("/in/files", work, { recursive: true, errorOnExist: true, force: false });
  await writeFile(path.join(work, "package.json"), '{"name":"witness-task","private":true,"type":"module"}\n');
  await mkdir(path.join(work, "node_modules"));
  await symlink(path.join(WITNESS_ROOT, "node_modules", "vitest"), path.join(work, "node_modules", "vitest"), "dir");
  await writeFile(
    path.join(work, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2023"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        types: [],
      },
      files: [...request.source_paths, ...request.test_paths],
    }),
  );
} catch {
  report("crash", { phase: "stage" });
}

// Phase 1: compile. tsc exit 0 = clean; any other status (diagnostics or crash) is never a witness.
const tsc = runQuiet([path.join(WITNESS_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(work, "tsconfig.json")]);
if (tsc.status !== 0) report("compile_error", { phase: "typecheck" });

// Phase 2: test. Only the selected file; for a named selection, only tests whose name matches (then exact-checked).
const target = path.join(work, sel.path);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const vitestArgs = [
  path.join(WITNESS_ROOT, "node_modules", "vitest", "vitest.mjs"),
  "run",
  "--root", work,
  "--reporter=json",
  `--outputFile=${reportFile}`,
  "--sequence.shuffle",
  `--sequence.seed=${request.shuffle_seed}`,
  ...(sel.kind === "named" ? ["--testNamePattern", escapeRegExp(sel.name)] : []),
  target,
];
const vitest = runQuiet(vitestArgs);
if (vitest.status !== 0 && vitest.status !== 1) report("crash", { phase: "test" });

let results;
try {
  results = JSON.parse(await readFile(reportFile, "utf8"));
} catch {
  report("crash", { phase: "report" });
}
const file = Array.isArray(results?.testResults) ? results.testResults.find((r) => r?.name === target) : undefined;
if (file === undefined) report("load_error", { phase: "report" });
const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
if (file.status === "failed" && assertions.length === 0) report("load_error", { phase: "report" });

if (sel.kind === "named") {
  const ran = assertions.filter((a) => a?.title === sel.name && (a.status === "passed" || a.status === "failed"));
  if (ran.length !== 1) report("selection_error", { phase: "report", matched: ran.length });
  report(ran[0].status === "passed" ? "pass" : "assertion_fail", { phase: "test", selected: 1 });
}

const failed = assertions.filter((a) => a?.status === "failed").length;
const passed = assertions.filter((a) => a?.status === "passed").length;
if (failed > 0) report("assertion_fail", { phase: "test", selected: assertions.length, failed });
if (passed === 0 || passed !== assertions.length) report("incomplete_suite", { phase: "test", selected: assertions.length, passed });
report("pass", { phase: "test", selected: assertions.length });
