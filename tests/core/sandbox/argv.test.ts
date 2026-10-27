// Pure argv tests; no process, Docker or container is started. Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-18).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  SANDBOX_POLICY_SHA256,
  WITNESS_ENTRY,
  assertHostMountPath,
  assertNoForbiddenArgs,
  buildCleanupArgv,
  buildDockerRunArgv,
  buildPresenceArgv,
  imageDigestOf,
  validateLimits,
} from "../../../src/core/sandbox/argv.ts";

const IMAGE = `s41-prj-witness@sha256:${"a".repeat(64)}`;
const NAME = "s41-prj-witness-0123abcd";
const spec = { image: IMAGE, containerName: NAME, inputDir: "/tmp/s41-prj-stage-x1", owner: "0900_Grok_X_Validator" };
const value = (argv: readonly string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];

describe("buildDockerRunArgv", () => {
  const argv = buildDockerRunArgv(spec);

  it("carries every PLAN M2.2 isolation flag", () => {
    expect(argv[0]).toBe("run");
    expect(value(argv, "--network")).toBe("none");
    expect(value(argv, "--user")).toBe("10001:10001");
    expect(argv).toContain("--read-only");
    expect(value(argv, "--cap-drop")).toBe("ALL");
    expect(value(argv, "--security-opt")).toBe("no-new-privileges");
    expect(argv.filter((a, i) => argv[i - 1] === "--tmpfs" && a.startsWith("/work:"))).toHaveLength(1);
    expect(value(argv, "--memory")).toBe("1g");
    expect(value(argv, "--memory-swap")).toBe("1g");
    expect(value(argv, "--cpus")).toBe("1");
    expect(value(argv, "--pids-limit")).toBe("128");
    expect(value(argv, "--pull")).toBe("never");
    expect(argv).toContain("--rm");
    expect(value(argv, "--name")).toBe(NAME);
  });

  it("uses the digest-pinned image, a read-only /in bind, owned labels, and no published port or env", () => {
    expect(argv.slice(argv.indexOf(IMAGE))).toEqual([IMAGE, ...WITNESS_ENTRY]);
    expect(value(argv, "--mount")).toBe("type=bind,source=/tmp/s41-prj-stage-x1,destination=/in,readonly");
    expect(argv).toContain("agentports.owner=0900_Grok_X_Validator");
    expect(argv).toContain("agentports.project=s41-pr-review-judgment");
    for (const forbidden of ["-p", "--publish", "-P", "-e", "--env", "--env-file", "-v", "--volume", "--privileged"]) {
      expect(argv).not.toContain(forbidden);
    }
    expect(argv.join(" ")).not.toMatch(/docker\.sock|API_KEY/);
  });

  it("refuses unpinned images", () => {
    for (const image of ["node:22", "s41-prj-witness:latest", `s41@sha256:${"a".repeat(63)}`, `S41@sha256:${"a".repeat(64)}`]) {
      expect(() => buildDockerRunArgv({ ...spec, image })).toThrow();
    }
    expect(imageDigestOf(IMAGE)).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("refuses unsafe mounts, names, owners and entries", () => {
    for (const inputDir of ["relative/dir", "/tmp/a/../etc", "/tmp/a,readonly=false", "/var/run/docker.sock", "C:\\x\\..\\y"]) {
      expect(() => buildDockerRunArgv({ ...spec, inputDir }), inputDir).toThrow();
    }
    expect(() => assertHostMountPath("C:\\Users\\Roy Harden\\AppData\\Local\\Temp\\s41-prj-stage-x1")).not.toThrow();
    expect(() => buildDockerRunArgv({ ...spec, containerName: "other-name" })).toThrow();
    expect(() => buildDockerRunArgv({ ...spec, owner: "x y" })).toThrow();
    expect(() => buildDockerRunArgv({ ...spec, entry: ["--privileged"] })).toThrow();
    expect(() => buildDockerRunArgv({ ...spec, entry: ["/in/../etc/passwd"] })).toThrow();
    expect(buildDockerRunArgv({ ...spec, entry: ["/in/probe.mjs"] }).at(-1)).toBe("/in/probe.mjs");
  });

  it("refuses forbidden flags in either form", () => {
    expect(() => assertNoForbiddenArgs(["run", "--publish=8080:80"])).toThrow();
    expect(() => assertNoForbiddenArgs(["run", "-p", "8080:80"])).toThrow();
  });
});

describe("cleanup, presence and limits", () => {
  it("builds the explicit cleanup and presence argv", () => {
    expect(buildCleanupArgv(NAME)).toEqual(["rm", "--force", NAME]);
    expect(buildPresenceArgv(NAME)).toContain(`name=^/${NAME}$`);
    expect(() => buildCleanupArgv("evil; rm -rf /")).toThrow();
  });

  it("defaults to 30 s and 1 MiB and refuses loosening", () => {
    expect(DEFAULT_LIMITS).toEqual({ timeoutMs: 30_000, outputCapBytes: 1_048_576 });
    expect(validateLimits({ timeoutMs: 5_000, outputCapBytes: 1024 })).toEqual({ timeoutMs: 5_000, outputCapBytes: 1024 });
    expect(() => validateLimits({ timeoutMs: 30_001, outputCapBytes: 1024 })).toThrow();
    expect(() => validateLimits({ timeoutMs: 0, outputCapBytes: 1024 })).toThrow();
    expect(() => validateLimits({ timeoutMs: 1000, outputCapBytes: 1_048_577 })).toThrow();
  });

  it("hashes the policy", () => {
    expect(SANDBOX_POLICY_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
