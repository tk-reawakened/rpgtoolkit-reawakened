import { equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sha256Hex } from "../src/sha256.ts";

test("SHA-256 matches the FIPS vectors and Node's digest for every padding boundary", () => {
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);
  equal(sha256Hex(text("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  equal(sha256Hex(text("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  equal(sha256Hex(text("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  for (const size of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
    const bytes = new Uint8Array(size).map((_, index) => (index * 31 + size) & 0xff);
    equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"), `${size} bytes`);
  }
});
