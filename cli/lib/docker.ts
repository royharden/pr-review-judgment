// The one host executor: a DockerPort over node:child_process (PLAN K18). Spawns only the `docker` binary with argv
// built by src/core/sandbox/argv.ts, never a shell and never corpus code on the host. WRITTEN, NEVER RUN in Dirty
// Mode (DEFERRED-VALIDATION DV-13, DV-16). Design-informed by S39 `d5f9e40` cli/sandbox/sandboxrun.ts (capture,
// removeContainer, hostProcessEnv); implemented here (PLAN K13).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isSafeRelPath } from "../../src/core/defectcorpus/schema.ts";
import { CLEANUP_TIMEOUT_MS, DOCKER_CLIENT_ENV_ALLOWLIST, buildPresenceArgv } from "../../src/core/sandbox/argv.ts";
import type { DockerPort, DockerRawOutcome, DockerRunPlan, StagedFile, StagedInput } from "../../src/core/sandbox/runner.ts";

/** Only the allowlisted variables reach the Docker CLI process. No keys, proxies, NODE_OPTIONS or DOCKER_* overrides. */
export function dockerClientEnv(input: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of DOCKER_CLIENT_ENV_ALLOWLIST) {
    const value = input[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** Fresh container name matching CONTAINER_NAME_PATTERN. */
export function newContainerName(): string {
  return `s41-prj-witness-${randomBytes(12).toString("hex")}`;
}

interface Collected {
  readonly code: number | null;
  readonly stdout: string;
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
}

/** Short bounded docker call (cleanup, presence). Output is capped at 64 KiB. */
function dockerQuick(binary: string, argv: readonly string[], timeoutMs: number): Promise<Collected> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const child = spawn(binary, [...argv], { env: dockerClientEnv(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const finish = (c: Collected) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(c);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, spawnFailed: false, timedOut: true });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 65536) stdout += chunk.toString("utf8");
    });
    child.once("error", () => finish({ code: null, stdout, spawnFailed: true, timedOut: false }));
    child.once("close", (code) => finish({ code, stdout, spawnFailed: false, timedOut: false }));
  });
}

export interface DockerExecutorOptions {
  /** Docker binary name or absolute path; default `docker`. */
  readonly binary?: string;
  /** Parent directory for staging dirs; default os.tmpdir(). */
  readonly stagingParent?: string;
}

export function createDockerExecutor(options: DockerExecutorOptions = {}): DockerPort {
  const binary = options.binary ?? "docker";

  const absent = async (containerName: string): Promise<boolean | null> => {
    const r = await dockerQuick(binary, buildPresenceArgv(containerName), CLEANUP_TIMEOUT_MS);
    if (r.spawnFailed || r.timedOut || r.code !== 0) return null;
    return r.stdout.trim() === "";
  };

  /** `docker rm --force`, then confirm absence. A container that already exited and was --rm'd is also absent. */
  const cleanup = async (plan: DockerRunPlan): Promise<boolean> => {
    await dockerQuick(binary, plan.cleanupArgv, CLEANUP_TIMEOUT_MS);
    return (await absent(plan.containerName)) === true;
  };

  return {
    async stage(files: readonly StagedFile[]): Promise<StagedInput> {
      for (const f of files) if (!isSafeRelPath(f.path)) throw new Error(`refused unsafe staging path ${JSON.stringify(f.path)}`);
      if (new Set(files.map((f) => f.path)).size !== files.length) throw new Error("duplicate staging path");
      const root = await realpath(await mkdtemp(path.join(options.stagingParent ?? tmpdir(), "s41-prj-stage-")));
      try {
        for (const f of files) {
          const target = path.resolve(root, ...f.path.split("/"));
          if (!target.startsWith(root + path.sep)) throw new Error("staging path escapes the staging directory");
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, f.content, { encoding: "utf8", flag: "wx" });
        }
      } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
      }
      return {
        hostDir: root,
        // Only the exact mkdtemp directory created above is removed, never a caller-supplied path.
        dispose: () => rm(root, { recursive: true, force: true }),
      };
    },

    run(plan: DockerRunPlan): Promise<DockerRawOutcome> {
      if (plan.command !== "docker" || plan.argv[0] !== "run") return Promise.reject(new Error("only docker run plans are accepted"));
      const started = Date.now();
      return new Promise<DockerRawOutcome>((resolve) => {
        const chunks: Buffer[] = [];
        let stdoutBytes = 0;
        let totalBytes = 0;
        let stopReason: "timeout" | "output_cap" | null = null;
        let settled = false;
        const child = spawn(binary, [...plan.argv], { env: dockerClientEnv(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

        const stop = (reason: "timeout" | "output_cap") => {
          if (stopReason !== null) return;
          stopReason = reason;
          clearTimeout(timer);
          child.kill("SIGKILL");
        };
        const timer = setTimeout(() => stop("timeout"), plan.timeoutMs);
        const count = (chunk: Buffer, keep: boolean) => {
          if (stopReason !== null) return;
          // Buffers never grow past the cap: the chunk that would cross it is dropped and the run is stopped.
          if (totalBytes + chunk.length > plan.outputCapBytes) {
            stop("output_cap");
            return;
          }
          totalBytes += chunk.length;
          if (keep) {
            chunks.push(chunk);
            stdoutBytes += chunk.length;
          }
        };
        child.stdout?.on("data", (chunk: Buffer) => count(chunk, true));
        child.stderr?.on("data", (chunk: Buffer) => count(chunk, false));

        const settle = async (code: number | null, spawnFailed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const stdout = Buffer.concat(chunks, stdoutBytes).toString("utf8");
          const durationMs = Date.now() - started;
          if (spawnFailed) {
            resolve({ kind: "spawn_error", exitCode: null, stdout: "", outputBytes: 0, durationMs, cleanupConfirmed: null });
            return;
          }
          if (stopReason !== null) {
            const cleanupConfirmed = await cleanup(plan);
            resolve({ kind: stopReason, exitCode: null, stdout, outputBytes: totalBytes, durationMs, cleanupConfirmed });
            return;
          }
          resolve({ kind: "exited", exitCode: code, stdout, outputBytes: totalBytes, durationMs, cleanupConfirmed: null });
        };
        child.once("error", () => void settle(null, true));
        child.once("close", (code) => void settle(code, false));
      });
    },

    absent,
  };
}
