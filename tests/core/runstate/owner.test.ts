import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { exclusive } from "../../../cli/run.ts";
describe("exclusive host ownership", () => {
  it("what_bug_this_catches: a second process cannot own a run or budget target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "s41-owner-test-"));
    try { const lock = path.join(dir, "OWNER.lock"); const release = await exclusive(lock, "one"); await expect(exclusive(lock, "two")).rejects.toThrow(); await release(); const releaseTwo = await exclusive(lock, "two"); await releaseTwo(); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});
