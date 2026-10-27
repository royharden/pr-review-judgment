// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-07).
import { describe, expect, it } from "vitest";
import { assertUniqueNeutralIds, neutralChangeId } from "../../../src/core/defectcorpus/ids.ts";
import { canonicalJson, changeContentSha256, hashCanonical } from "../../../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../../../src/core/hash/sha256.ts";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("neutralChangeId", () => {
  it("is c_ + the first 10 hex of the content hash", () => {
    expect(neutralChangeId(ABC)).toBe("c_ba7816bf8f");
    expect(neutralChangeId(sha256Hex("abc"))).toBe("c_ba7816bf8f");
  });

  it("rejects anything that is not 64 lowercase hex", () => {
    expect(() => neutralChangeId(ABC.toUpperCase())).toThrow();
    expect(() => neutralChangeId(ABC.slice(1))).toThrow();
    expect(() => neutralChangeId("")).toThrow();
  });

  it("detects a 10-hex prefix collision between distinct hashes", () => {
    const other = `${ABC.slice(0, 10)}${"0".repeat(54)}`;
    expect(() => assertUniqueNeutralIds([ABC, other])).toThrow(/collision/);
    expect(() => assertUniqueNeutralIds([ABC, ABC])).not.toThrow();
  });
});

describe("canonical hashing", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }));
  });

  it("rejects values two hosts could serialize differently", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
  });

  it("change hash is independent of file order and sensitive to content", () => {
    const f1 = { path: "src/a.ts", base: "x\n", head: "y\n" };
    const f2 = { path: "src/b.ts", base: null, head: "z\n" };
    expect(changeContentSha256("spec", [f1, f2])).toBe(changeContentSha256("spec", [f2, f1]));
    expect(changeContentSha256("spec", [f1])).not.toBe(changeContentSha256("spec", [{ ...f1, head: "y \n" }]));
    expect(changeContentSha256("spec", [f1])).not.toBe(changeContentSha256("spec2", [f1]));
    expect(changeContentSha256("spec", [f1])).toMatch(/^[0-9a-f]{64}$/);
  });
});
