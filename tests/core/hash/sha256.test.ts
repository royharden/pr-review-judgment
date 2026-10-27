// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-05).
// Expected digests: FIPS 180-4 / NIST CAVP examples ("", "abc", the 448-bit message, one million "a"), plus padding
// boundary and UTF-8 vectors whose expected values were produced by GNU coreutils `sha256sum` on the same bytes.
import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Hex, utf8Encode } from "../../../src/core/hash/sha256.ts";

describe("sha256Hex: standard test vectors", () => {
  it("empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("448-bit two-block message", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("one million 'a'", () => {
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
});

describe("sha256Hex: padding boundaries (sha256sum reference)", () => {
  it("55 bytes fits length in one block", () => {
    expect(sha256Hex("a".repeat(55))).toBe("9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
  });

  it("56 bytes spills the length into a second block", () => {
    expect(sha256Hex("a".repeat(56))).toBe("b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
  });

  it("64 bytes is exactly one data block", () => {
    expect(sha256Hex("a".repeat(64))).toBe("ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
  });
});

describe("UTF-8 and byte input", () => {
  it("encodes 2-, 3- and 4-byte sequences like TextEncoder", () => {
    expect([...utf8Encode("é")]).toEqual([0xc3, 0xa9]);
    expect([...utf8Encode("€")]).toEqual([0xe2, 0x82, 0xac]);
    expect([...utf8Encode("\u{1F600}")]).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect([...utf8Encode("\ud800")]).toEqual([0xef, 0xbf, 0xbd]); // lone surrogate -> U+FFFD
  });

  it("hashes a string as its UTF-8 bytes", () => {
    const text = "é€\u{1F600}";
    expect(sha256Hex(text)).toBe("df9226927fd572c1ee66eec85de1bb139497614899f36e4e90474cb71f6ef9d0");
    expect(sha256Hex(utf8Encode(text))).toBe(sha256Hex(text));
  });

  it("returns 32 raw bytes and lowercase 64-hex", () => {
    expect(sha256Bytes(new Uint8Array(0)).length).toBe(32);
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex("abc"));
  });
});
