// The six sandbox qualification probes (PLAN K18) and the probe receipt schema. Pure: probe scripts are data, and
// evaluation is a function of observations the host collects (cli/sandbox-probe.ts). Until a receipt with all six
// probes passing exists for the exact image digest and the current SANDBOX_POLICY_SHA256, the sandbox is
// unqualified and the WitnessRunner refuses to execute anything (runner.ts). Never run in Dirty Mode (DV-13).
import { z } from "zod";
import { sha256Hex } from "../hash/sha256.ts";
import { Callsign, IsoDateTime, SandboxImageDigest, Sha256Hex } from "../defectcorpus/schema.ts";
import { OUTPUT_CAP_BYTES, PINNED_IMAGE_PATTERN, SANDBOX_POLICY_SHA256, imageDigestOf } from "./argv.ts";
import type { DockerRawOutcome } from "./runner.ts";

export const PROBE_IDS = [
  "network_blocked",
  "write_outside_work_fails",
  "infinite_loop_killed",
  "memory_bomb_oom",
  "output_flood_capped",
  "path_traversal_refused",
] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

/** What the host observed for one probe. Container probes fill `raw` (+ `containerAbsent`); the host probe fills `refusals`. */
export interface ProbeObservation {
  readonly raw: DockerRawOutcome | null;
  /** After the run (and any cleanup): true if `docker ps --all` no longer lists the container. */
  readonly containerAbsent: boolean | null;
  /** Host-side traversal cases: each must be refused (true). */
  readonly refusals: readonly { readonly case: string; readonly refused: boolean }[] | null;
}

export interface ProbeVerdict {
  readonly passed: boolean;
  /** Short, fixed-vocabulary description of what was seen (never raw container output). */
  readonly observed: string;
}

export interface ProbeDefinition {
  readonly id: ProbeId;
  readonly where: "container" | "host";
  /** Script staged as /in/probe.mjs and run as `node /in/probe.mjs` under the full sandbox argv; null for host probes. */
  readonly script: string | null;
  readonly expected: string;
  evaluate(obs: ProbeObservation): ProbeVerdict;
}

/** Parse the single JSON line a probe script prints; null if absent or malformed. */
function probeReport(raw: DockerRawOutcome | null): Record<string, unknown> | null {
  if (raw === null || raw.kind !== "exited") return null;
  const line = raw.stdout.trim().split("\n").pop() ?? "";
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const describeRaw = (raw: DockerRawOutcome | null): string =>
  raw === null ? "no run" : `${raw.kind}${raw.exitCode === null ? "" : ` exit ${raw.exitCode}`}`;

export const PROBES: readonly ProbeDefinition[] = [
  {
    id: "network_blocked",
    where: "container",
    script: [
      'import { connect } from "node:net";',
      'import { lookup } from "node:dns/promises";',
      "const tcp = await new Promise((resolve) => {",
      '  const s = connect({ host: "1.1.1.1", port: 443, timeout: 3000 });',
      '  s.once("connect", () => { s.destroy(); resolve("connected"); });',
      '  s.once("timeout", () => { s.destroy(); resolve("blocked"); });',
      '  s.once("error", () => resolve("blocked"));',
      "});",
      "let dns;",
      'try { await lookup("example.com"); dns = "resolved"; } catch { dns = "blocked"; }',
      'process.stdout.write(JSON.stringify({ probe: "network_blocked", tcp, dns }) + "\\n");',
    ].join("\n"),
    expected: "exits 0 reporting tcp=blocked and dns=blocked (no route out under --network none)",
    evaluate({ raw }) {
      const r = probeReport(raw);
      const passed = raw?.exitCode === 0 && r?.["tcp"] === "blocked" && r["dns"] === "blocked";
      return { passed, observed: r === null ? describeRaw(raw) : `tcp=${String(r["tcp"])} dns=${String(r["dns"])}` };
    },
  },
  {
    id: "write_outside_work_fails",
    where: "container",
    script: [
      'import { writeFileSync } from "node:fs";',
      'const outside = ["/probe-root", "/etc/probe", "/opt/witness/probe", "/in/probe-write", "/usr/local/probe"];',
      "const refused = outside.filter((p) => { try { writeFileSync(p, \"x\"); return false; } catch { return true; } }).length;",
      'let work = "refused";',
      'try { writeFileSync("/work/probe", "x"); work = "written"; } catch { work = "refused"; }',
      'process.stdout.write(JSON.stringify({ probe: "write_outside_work_fails", outside: outside.length, refused, work }) + "\\n");',
    ].join("\n"),
    expected: "exits 0; all 5 writes outside /work refused (read-only root, read-only /in); the write to /work succeeds",
    evaluate({ raw }) {
      const r = probeReport(raw);
      const passed = raw?.exitCode === 0 && r?.["outside"] === 5 && r["refused"] === 5 && r["work"] === "written";
      return { passed, observed: r === null ? describeRaw(raw) : `refused=${String(r["refused"])}/5 work=${String(r["work"])}` };
    },
  },
  {
    id: "infinite_loop_killed",
    where: "container",
    script: "for (;;) {}\n",
    expected: "host timeout fires (30 s), `docker rm --force` is confirmed and `docker ps --all` no longer lists the container",
    evaluate({ raw, containerAbsent }) {
      const passed = raw?.kind === "timeout" && raw.cleanupConfirmed === true && containerAbsent === true;
      return { passed, observed: `${describeRaw(raw)} cleanup=${String(raw?.cleanupConfirmed ?? null)} absent=${String(containerAbsent)}` };
    },
  },
  {
    id: "memory_bomb_oom",
    where: "container",
    script: [
      "const keep = [];",
      "for (;;) keep.push(Buffer.alloc(64 * 1024 * 1024, 1));",
    ].join("\n"),
    expected:
      "the container is OOM-killed under --memory 1g --memory-swap 1g: the run exits with status 137 before the timeout " +
      "(137 = SIGKILL; --rm removes the container, so OOMKilled cannot be inspected; recorded as a limitation)",
    evaluate({ raw, containerAbsent }) {
      const passed = raw?.kind === "exited" && raw.exitCode === 137 && containerAbsent === true;
      return { passed, observed: `${describeRaw(raw)} absent=${String(containerAbsent)}` };
    },
  },
  {
    id: "output_flood_capped",
    where: "container",
    script: [
      "const chunk = Buffer.alloc(65536, 120);",
      'const pump = () => { while (process.stdout.write(chunk)) {} process.stdout.once("drain", pump); };',
      "pump();",
    ].join("\n"),
    expected: `the host stops reading at the ${OUTPUT_CAP_BYTES}-byte cap, kills the run (kind output_cap), cleanup is confirmed and the container is gone`,
    evaluate({ raw, containerAbsent }) {
      const passed =
        raw?.kind === "output_cap" && raw.outputBytes <= OUTPUT_CAP_BYTES && raw.cleanupConfirmed === true && containerAbsent === true;
      return { passed, observed: `${describeRaw(raw)} bytes=${String(raw?.outputBytes ?? null)} absent=${String(containerAbsent)}` };
    },
  },
  {
    id: "path_traversal_refused",
    where: "host",
    script: null,
    expected:
      "every traversal case is refused before Docker runs: the stager refuses `../`, absolute, drive-letter and " +
      "backslash file paths, and the argv builder refuses mount sources with `..`, commas or the Docker socket",
    evaluate({ refusals }) {
      const total = refusals?.length ?? 0;
      const refused = refusals?.filter((c) => c.refused).length ?? 0;
      return { passed: total === TRAVERSAL_CASES.length && refused === total, observed: `refused=${refused}/${total}` };
    },
  },
];

/** Host-side traversal cases for probe 6: staged file paths (stager) and mount sources (argv builder). */
export const TRAVERSAL_CASES = [
  { case: "stage ../escape.ts", kind: "stage", value: "../escape.ts" },
  { case: "stage a/../../escape.ts", kind: "stage", value: "a/../../escape.ts" },
  { case: "stage /etc/escape.ts", kind: "stage", value: "/etc/escape.ts" },
  { case: "stage C:/escape.ts", kind: "stage", value: "C:/escape.ts" },
  { case: "stage a\\..\\escape.ts", kind: "stage", value: "a\\..\\escape.ts" },
  { case: "mount /tmp/s41/../etc", kind: "mount", value: "/tmp/s41/../etc" },
  { case: "mount /tmp/s41,readonly=false", kind: "mount", value: "/tmp/s41,readonly=false" },
  { case: "mount /var/run/docker.sock", kind: "mount", value: "/var/run/docker.sock" },
] as const;

export function probeById(id: ProbeId): ProbeDefinition {
  const p = PROBES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`unknown probe ${id}`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Probe receipt (written by cli/sandbox-probe.ts, read by the WitnessRunner)
// ---------------------------------------------------------------------------------------------------------------

export const ProbeResult = z.strictObject({
  id: z.enum(PROBE_IDS),
  expected: z.string().min(1),
  observed: z.string(),
  passed: z.boolean(),
  duration_ms: z.number().int().min(0),
  /** sha256 of the captured (capped) output, or of "" for the host probe. */
  output_sha256: Sha256Hex,
});

export const ProbeReceiptSchema = z
  .strictObject({
    schema: z.literal("sandbox-probe-receipt/v1"),
    image: z.string().regex(PINNED_IMAGE_PATTERN),
    image_digest: SandboxImageDigest,
    policy_sha256: Sha256Hex,
    probes: z.array(ProbeResult).length(PROBE_IDS.length),
    all_passed: z.boolean(),
    executor: Callsign,
    recorded_at: IsoDateTime,
  })
  .superRefine((r, ctx) => {
    const ids = r.probes.map((p) => p.id);
    if (new Set(ids).size !== PROBE_IDS.length) ctx.addIssue({ code: "custom", path: ["probes"], message: "each probe exactly once" });
    if (r.all_passed !== r.probes.every((p) => p.passed)) {
      ctx.addIssue({ code: "custom", path: ["all_passed"], message: "all_passed must equal every probe passed" });
    }
    if (r.image.slice(r.image.indexOf("@") + 1) !== r.image_digest) {
      ctx.addIssue({ code: "custom", path: ["image_digest"], message: "image_digest must be the digest of image" });
    }
  });
export type ProbeReceipt = z.infer<typeof ProbeReceiptSchema>;

export interface SandboxQualification {
  readonly qualified: boolean;
  readonly reasons: readonly string[];
  /** sha256 of the exact receipt bytes, when a receipt was supplied. */
  readonly receiptSha256: string | null;
  readonly imageDigest: string | null;
}

/**
 * Fail-closed qualification. Qualified only if: a receipt text is supplied, it parses against ProbeReceiptSchema,
 * all six probes passed, its image digest equals the digest of `image`, and its policy hash equals the current
 * SANDBOX_POLICY_SHA256.
 */
export function qualifySandbox(receiptText: string | null, image: string): SandboxQualification {
  const reasons: string[] = [];
  let imageDigest: string | null = null;
  try {
    imageDigest = imageDigestOf(image);
  } catch {
    reasons.push("image is not pinned as name@sha256:<64 hex>");
  }
  if (receiptText === null) {
    reasons.push("no sandbox probe receipt supplied");
    return { qualified: false, reasons, receiptSha256: null, imageDigest };
  }
  const receiptSha256 = sha256Hex(receiptText);
  let json: unknown;
  try {
    json = JSON.parse(receiptText);
  } catch {
    reasons.push("probe receipt is not JSON");
    return { qualified: false, reasons, receiptSha256, imageDigest };
  }
  const parsed = ProbeReceiptSchema.safeParse(json);
  if (!parsed.success) {
    reasons.push("probe receipt does not match sandbox-probe-receipt/v1");
    return { qualified: false, reasons, receiptSha256, imageDigest };
  }
  const receipt = parsed.data;
  for (const p of receipt.probes) if (!p.passed) reasons.push(`probe ${p.id} did not pass`);
  if (imageDigest !== null && receipt.image_digest !== imageDigest) reasons.push("probe receipt is for a different image digest");
  if (receipt.policy_sha256 !== SANDBOX_POLICY_SHA256) reasons.push("probe receipt is for a different sandbox policy");
  return { qualified: reasons.length === 0, reasons, receiptSha256, imageDigest };
}
