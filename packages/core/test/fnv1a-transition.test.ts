import { equal } from "node:assert/strict";
import { test } from "node:test";
import { createFnv1a64State, fnv1a64Finish, fnv1a64Update } from "../src/canon/fnv1a.ts";
import { applyFnvByteTransition, createFnvAsciiTransition } from "../src/canon/fnv1a-transition.ts";
import { utf8Encode } from "../src/canon/utf8.ts";

test("a byte transition over non-ASCII UTF-8 matches the direct FNV-1a scan for every incoming low byte", () => {
  const bytes = utf8Encode("// stock_menu — the default player menu 😀 café\n".repeat(40));
  const transition = createFnvAsciiTransition(bytes.length);
  for (let lane = 0; lane < 256; lane += 1) {
    for (const prefix of [`a${lane}`, `bb${lane}-é`]) {
      // Steer the accumulator to a chosen low byte, then hash twice: the first call learns, the second reuses.
      const start = createFnv1a64State();
      fnv1a64Update(prefix, start);
      start.low = ((start.low & 0xffffff00) | lane) >>> 0;
      for (let pass = 0; pass < 2; pass += 1) {
        const direct = { ...start };
        fnv1a64Update(bytes, direct);
        const cached = { ...start };
        applyFnvByteTransition(transition, bytes, cached);
        equal(fnv1a64Finish(cached), fnv1a64Finish(direct));
      }
    }
  }
});
