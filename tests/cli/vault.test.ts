// Deferred source: exercises real filesystem boundaries only when Dirty Mode closes.
import { describe, it, expect } from "vitest";
import { mkdtemp, realpath, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contained, privateError } from "../../cli/lib/vault.ts";
describe("canonical custody boundary", () => {
  it("what_bug_this_catches: another directory named .heldout is not the canonical vault", async () => {
    const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "s41-custody-")));
    try { const vault = path.join(temp, "vault"); await mkdir(vault); await mkdir(path.join(temp, "other", ".heldout"), { recursive: true }); await expect(contained(vault, path.join(temp, "other", ".heldout", "out.json"), true)).rejects.toThrow(); }
    finally { await rm(temp, { recursive: true, force: true }); }
  });
  it("what_bug_this_catches: symlinked inputs, output ancestors and run directories cannot escape custody", async () => {
    const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "s41-custody-")));
    try {
      const vault = path.join(temp, "vault"), outside = path.join(temp, "outside"); await mkdir(vault); await mkdir(outside); await writeFile(path.join(outside, "input.json"), "private sentinel");
      await symlink(outside, path.join(vault, "redirect"), "junction");
      await expect(contained(vault, path.join(vault, "redirect", "input.json"))).rejects.toThrow();
      await expect(contained(vault, path.join(vault, "redirect", "new", "out.json"), true)).rejects.toThrow();
      await expect(contained(vault, path.join(vault, "redirect"))).rejects.toThrow();
      expect(await contained(vault, path.join(vault, "new", "out.json"), true)).toBe(path.join(vault, "new", "out.json"));
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  it("what_bug_this_catches: private parse diagnostics never enter the public refusal", () => { expect(privateError("eval")).toBe("eval: refused/stopped (private details withheld)\n"); });
});
