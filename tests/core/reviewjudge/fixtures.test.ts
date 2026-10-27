// Written, never run in Dirty Mode. These examples exercise the public viewer seam against shared M3 contracts.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MOCK_REVIEW_CASES } from "../../../fixtures/reviews/index.ts";
import { parseReviewOutput } from "../../../src/core/reviewjudge/contract.ts";
import { classifyDefectSlot, observeCleanSlot } from "../../../src/core/reviewjudge/classify.ts";
import { deriveRegions } from "../../../src/core/defectcorpus/region.ts";
import { DIFF_HEURISTIC_RULES, DIFF_HEURISTIC_VERSION, RULESET_SHA256 } from "../../../src/core/reviewjudge/baselines/diffHeuristic.ts";
import { changeContentSha256 } from "../../../src/core/defectcorpus/hashes.ts";
import { PublicManifestRecordSchema } from "../../../src/core/defectcorpus/schema.ts";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
describe("MOCK review fixtures", () => {
  it("covers every named outcome through the shared parser and matcher", () => {
    expect(MOCK_REVIEW_CASES.map((c) => c.label)).toEqual(["clean", "HIT", "DEFER", "WRONG-PLACE", "false rejection", "INVALID"]);
    for (const c of MOCK_REVIEW_CASES) {
      expect(c.mock).toBe(true);
      const bounds = c.files.map((f) => ({ path: f.path, lineCount: f.head.replace(/\n$/, "").split("\n").length }));
      const parsed = parseReviewOutput(c.raw_response, bounds);
      expect(parsed.status).toBe(c.reply.status);
      if (parsed.status === "valid") expect(parsed.review).toEqual(c.reply.review);
      if (c.variantKind === "defect") {
        const actual = classifyDefectSlot(c.reply, c.regions, bounds, 2).outcome;
        expect(actual).toBe(c.label === "INVALID" ? "UNAVAILABLE" : c.label);
      } else {
        expect(c.regions).toEqual([]);
        expect(observeCleanSlot(c.reply, c.outputTokens).verdict).toBe(c.label === "clean" ? "approve" : "request_changes");
      }
    }
  });
  it("B recordings cover both authors on two dev tasks without claiming witnesses", () => {
    for (const task of ["T01", "T02"]) {
      const record = JSON.parse(read(`fixtures/b/${task}.json`));
      expect(record.mock).toBe(true);
      expect(record.author_recordings.map((a: { author: string }) => a.author)).toEqual(["A", "B"]);
      expect(record.pin).toBeNull();
      for (const author of record.author_recordings) for (const seed of author.seeds) {
        expect(seed.admitted).toBe(false);
        expect(seed.witness_status).toBe("NOT RUN");
        expect(seed.regions).toEqual(deriveRegions(author.output.files, seed.head_files));
      }
    }
  });
  it("S45 public records carry no tests or private labels; companions join only by id", () => {
    const records = read("fixtures/s45-stub/public.jsonl").trim().split("\n").map((s) => JSON.parse(s));
    const companions = read("fixtures/s45-stub/private.jsonl").trim().split("\n").map((s) => JSON.parse(s));
    expect(records).toHaveLength(3);
    // The fixture digest binds exact UTF-8 LF file bytes, including its final newline.
    // Reject CRLF drift instead of silently normalizing the hash input.
    const manifestBytes = readFileSync(new URL("../../../fixtures/s45-stub/manifest.json", import.meta.url));
    expect(manifestBytes.includes(13)).toBe(false);
    const hash = createHash("sha256").update(manifestBytes).digest("hex");
    for (const [i, r] of records.entries()) {
      expect(r.mock).toBe(true);
      const { mock, ...payload } = r;
      expect(mock).toBe(true);
      expect(PublicManifestRecordSchema.parse(payload)).toEqual(payload);
      expect(r.id).toBe(`c_${changeContentSha256(r.spec, r.files).slice(0, 10)}`);
      expect(r.manifestHash).toBe(hash);
      expect(r.id).toBe(companions[i].id);
      expect(Object.keys(r).sort()).toEqual(["mock", "id", "files", "taskId", "spec", "manifestHash", "license", "embargoStatus"].sort());
    }
  });
  it("freezes the actual rule descriptors and exact source bytes", () => {
    const freeze = JSON.parse(read("protocol/diff-heuristic.rules.json"));
    expect(freeze.version).toBe(DIFF_HEURISTIC_VERSION);
    expect(freeze.ruleset_sha256).toBe(RULESET_SHA256);
    expect(freeze.rules).toEqual(DIFF_HEURISTIC_RULES);
    for (const [path, hash] of Object.entries(freeze.source_bytes_sha256)) {
      const bytes = readFileSync(new URL(`../../../${path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    }
  });
});
