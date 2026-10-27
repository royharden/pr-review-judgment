// WitnessRunner port (PLAN K18/K19, M2 acceptance 3). Fails closed: `sandbox_unqualified` unless a probe receipt
// with all six probes passing, for the exact image digest and current sandbox policy, is supplied. There is NO
// host-execution path: the only executor this module accepts is a DockerPort, and the only command it hands that
// port is the `docker run` argv from argv.ts. Timeout, crash, compile failure, output overflow and unconfirmed
// cleanup are never a pass and never an assertion failure, so they can never count as a witness.
// Design-informed by S39 `d5f9e40` cli/sandbox/sandboxrun.ts (capture/timeout/cleanup) and cli/core/gate.ts
// ("compile/crash/timeout is not a kill"); implemented here (PLAN K13).
import { canonicalJson, hashCanonical } from "../defectcorpus/hashes.ts";
import { compareCodeUnits } from "../defectcorpus/order.ts";
import { isSafeRelPath } from "../defectcorpus/schema.ts";
import type { SourceFile, TestRef, WitnessRunStatus } from "../defectcorpus/schema.ts";
import { sha256Hex } from "../hash/sha256.ts";
import { buildCleanupArgv, buildDockerRunArgv, validateLimits } from "./argv.ts";
import type { SandboxLimits } from "./argv.ts";
import { qualifySandbox } from "./probes.ts";

/** Which hidden tests a run executes: one named test, or every test in one hidden test file. */
export type WitnessSelection =
  | { readonly kind: "named"; readonly test: TestRef }
  | { readonly kind: "file"; readonly path: string };

export interface WitnessRequest {
  /** `filesSha256(sourceFiles)`; the runner recomputes it and refuses a mismatch. */
  readonly sourceHash: string;
  /** `filesSha256(testFiles)`; recomputed likewise. */
  readonly testHash: string;
  /** Digest-pinned image reference `name@sha256:<64 hex>`. */
  readonly imageDigest: string;
  readonly limits: SandboxLimits;
  readonly sourceFiles: readonly SourceFile[];
  readonly testFiles: readonly SourceFile[];
  readonly selection: WitnessSelection;
  /** uint32 seed for the in-container shuffled test order (vitest --sequence.shuffle --sequence.seed). */
  readonly shuffleSeed: number;
}

/** Why a run is infra_error (or null when the status is a real test outcome or a timeout). */
export type WitnessCause =
  | "hash_mismatch"
  | "bad_request"
  | "docker_unavailable"
  | "output_cap"
  | "cleanup_unconfirmed"
  | "bad_report"
  | "compile_error"
  | "load_error"
  | "selection_error"
  | "incomplete_suite"
  | "crash"
  | "unqualified";

export interface WitnessRunResult {
  readonly status: WitnessRunStatus;
  readonly cause: WitnessCause | null;
  readonly durationMs: number;
  /** sha256 of the captured (capped) stdout; sha256("") when nothing ran. */
  readonly outputSha256: string;
  /** `sha256:<hex>` when qualified, else null. */
  readonly imageDigest: string | null;
  readonly probeReceiptSha256: string | null;
  /** Reasons the sandbox is unqualified (empty when qualified). */
  readonly unqualifiedReasons: readonly string[];
}

export interface WitnessRunner {
  verify(request: WitnessRequest): Promise<WitnessRunResult>;
}

// ---------------------------------------------------------------------------------------------------------------
// Host port: implemented by cli/lib/docker.ts with node:child_process. The core never spawns anything.
// ---------------------------------------------------------------------------------------------------------------

export interface StagedFile {
  /** Relative POSIX path inside the staging directory (validated by isSafeRelPath before staging). */
  readonly path: string;
  readonly content: string;
}

export interface StagedInput {
  /** Absolute, canonical host path of a fresh private directory holding exactly the staged files. */
  readonly hostDir: string;
  dispose(): Promise<void>;
}

export interface DockerRunPlan {
  readonly command: "docker";
  readonly argv: readonly string[];
  /** Run after a timeout or output overflow; the port then checks presence and reports cleanupConfirmed. */
  readonly cleanupArgv: readonly string[];
  readonly containerName: string;
  readonly timeoutMs: number;
  readonly outputCapBytes: number;
}

export interface DockerRawOutcome {
  /** `exited`: process ended on its own; `timeout`: host timer fired; `output_cap`: stdout+stderr exceeded the cap. */
  readonly kind: "exited" | "timeout" | "output_cap" | "spawn_error";
  readonly exitCode: number | null;
  /** Captured stdout, at most outputCapBytes bytes. */
  readonly stdout: string;
  /** Total stdout + stderr bytes observed before the cap stopped reading. */
  readonly outputBytes: number;
  readonly durationMs: number;
  /** For timeout/output_cap: the container was removed and is confirmed absent. Null when no cleanup was needed. */
  readonly cleanupConfirmed: boolean | null;
}

export interface DockerPort {
  /** Write the files into a fresh private directory. Must refuse any path that is not a safe relative path. */
  stage(files: readonly StagedFile[]): Promise<StagedInput>;
  run(plan: DockerRunPlan): Promise<DockerRawOutcome>;
  /** True if `docker ps --all` no longer lists the container (probe 3/4/5); null if Docker could not be asked. */
  absent(containerName: string): Promise<boolean | null>;
}

export interface WitnessRunnerConfig {
  /** Exact bytes of the probe receipt file, or null when none exists. */
  readonly probeReceiptText: string | null;
  /** The only executor. Null means no Docker: every request is sandbox_unqualified. */
  readonly docker: DockerPort | null;
  /** agent-ports owner label (operator callsign). */
  readonly owner: string;
  /** Injected randomness: returns a fresh name matching CONTAINER_NAME_PATTERN. */
  newContainerName(): string;
}

/** Canonical content hash of a file set (order-independent). Used for sourceHash and testHash. */
export function filesSha256(files: readonly SourceFile[]): string {
  const sorted = [...files].sort((a, b) => compareCodeUnits(a.path, b.path));
  return hashCanonical({ domain: "pr-review-judgment/files/v1", files: sorted.map((f) => ({ path: f.path, content: f.content })) });
}

export const WITNESS_REQUEST_SCHEMA = "witness-request/v1" as const;
export const WITNESS_ENTRY_SCHEMA = "witness-entry/v1" as const;

/** The request document staged as /in/request.json; files go under /in/files/<path>. */
export function witnessRequestDocument(request: WitnessRequest): string {
  const selection =
    request.selection.kind === "named"
      ? { kind: "named", path: request.selection.test.path, name: request.selection.test.name }
      : { kind: "file", path: request.selection.path };
  return canonicalJson({
    schema: WITNESS_REQUEST_SCHEMA,
    source_paths: request.sourceFiles.map((f) => f.path).sort(compareCodeUnits),
    test_paths: request.testFiles.map((f) => f.path).sort(compareCodeUnits),
    selection,
    shuffle_seed: request.shuffleSeed,
  });
}

/** Statuses reported by the in-image entry (sandbox/entry.mjs) on its single stdout line. */
const ENTRY_STATUSES = ["pass", "assertion_fail", "compile_error", "load_error", "selection_error", "incomplete_suite", "crash"] as const;
type EntryStatus = (typeof ENTRY_STATUSES)[number];

function parseEntryReport(stdout: string): EntryStatus | null {
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== 1) return null;
  try {
    const value = JSON.parse(lines[0]!) as { schema?: unknown; status?: unknown };
    if (value.schema !== WITNESS_ENTRY_SCHEMA || typeof value.status !== "string") return null;
    return (ENTRY_STATUSES as readonly string[]).includes(value.status) ? (value.status as EntryStatus) : null;
  } catch {
    return null;
  }
}

/** Map a raw Docker outcome to a witness status. Only a clean exit with a well-formed report can be pass/assertion_fail. */
export function classifyOutcome(raw: DockerRawOutcome): { status: WitnessRunStatus; cause: WitnessCause | null } {
  switch (raw.kind) {
    case "spawn_error":
      return { status: "infra_error", cause: "docker_unavailable" };
    case "output_cap":
      return { status: "infra_error", cause: raw.cleanupConfirmed === true ? "output_cap" : "cleanup_unconfirmed" };
    case "timeout":
      return raw.cleanupConfirmed === true ? { status: "timeout", cause: null } : { status: "infra_error", cause: "cleanup_unconfirmed" };
    case "exited": {
      const report = parseEntryReport(raw.stdout);
      if (report === null) return { status: "infra_error", cause: raw.exitCode === 0 ? "bad_report" : "crash" };
      if (raw.exitCode !== 0) return { status: "infra_error", cause: "crash" };
      if (report === "pass") return { status: "pass", cause: null };
      if (report === "assertion_fail") return { status: "assertion_fail", cause: null };
      return { status: "infra_error", cause: report };
    }
  }
}

const EMPTY_SHA256 = sha256Hex("");

export function createWitnessRunner(config: WitnessRunnerConfig): WitnessRunner {
  return {
    async verify(request) {
      const qualification = qualifySandbox(config.probeReceiptText, request.imageDigest);
      const base = {
        imageDigest: qualification.qualified ? qualification.imageDigest : null,
        probeReceiptSha256: qualification.qualified ? qualification.receiptSha256 : null,
      };
      const docker = config.docker;
      if (!qualification.qualified || docker === null) {
        const reasons = docker === null ? [...qualification.reasons, "no Docker executor configured"] : qualification.reasons;
        return {
          status: "sandbox_unqualified",
          cause: "unqualified",
          durationMs: 0,
          outputSha256: EMPTY_SHA256,
          imageDigest: null,
          probeReceiptSha256: null,
          unqualifiedReasons: reasons,
        };
      }
      const refuse = (cause: WitnessCause): WitnessRunResult => ({
        status: "infra_error",
        cause,
        durationMs: 0,
        outputSha256: EMPTY_SHA256,
        ...base,
        unqualifiedReasons: [],
      });

      let limits: SandboxLimits;
      try {
        limits = validateLimits(request.limits);
      } catch {
        return refuse("bad_request");
      }
      const allFiles = [...request.sourceFiles, ...request.testFiles];
      if (allFiles.some((f) => !isSafeRelPath(f.path)) || new Set(allFiles.map((f) => f.path)).size !== allFiles.length) {
        return refuse("bad_request");
      }
      const selectedPath = request.selection.kind === "named" ? request.selection.test.path : request.selection.path;
      if (!request.testFiles.some((f) => f.path === selectedPath)) return refuse("bad_request");
      if (!Number.isInteger(request.shuffleSeed) || request.shuffleSeed < 0 || request.shuffleSeed > 0xffffffff) return refuse("bad_request");
      if (filesSha256(request.sourceFiles) !== request.sourceHash || filesSha256(request.testFiles) !== request.testHash) {
        return refuse("hash_mismatch");
      }

      const staged: StagedFile[] = [
        { path: "request.json", content: witnessRequestDocument(request) },
        ...allFiles.map((f) => ({ path: `files/${f.path}`, content: f.content })),
      ];
      let input: StagedInput;
      try {
        input = await docker.stage(staged);
      } catch {
        return refuse("bad_request");
      }
      try {
        const containerName = config.newContainerName();
        let plan: DockerRunPlan;
        try {
          plan = {
            command: "docker",
            argv: buildDockerRunArgv({ image: request.imageDigest, containerName, inputDir: input.hostDir, owner: config.owner }),
            cleanupArgv: buildCleanupArgv(containerName),
            containerName,
            timeoutMs: limits.timeoutMs,
            outputCapBytes: limits.outputCapBytes,
          };
        } catch {
          return refuse("bad_request");
        }
        let raw: DockerRawOutcome;
        try {
          raw = await docker.run(plan);
        } catch {
          return refuse("docker_unavailable");
        }
        const { status, cause } = classifyOutcome(raw);
        return { status, cause, durationMs: raw.durationMs, outputSha256: sha256Hex(raw.stdout), ...base, unqualifiedReasons: [] };
      } finally {
        await input.dispose();
      }
    },
  };
}
