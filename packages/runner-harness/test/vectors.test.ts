import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { checkVectors } from "../src/vectors.ts";

const VALID_VECTORS = {
  canon: [
    {
      id: "rfc8785-3.2.2-sample",
      input: {
        numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
        string: "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
        literals: [null, true, false],
      },
      canonical:
        '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    },
    {
      id: "rfc8785-negative-zero",
      bits: "8000000000000000",
      canonical: "0",
    },
  ],
  fnv1a64: [
    {
      id: "fnv-empty",
      utf8: "",
      hash: "cbf29ce484222325",
    },
    {
      id: "fnv-bytes",
      hex: "616263",
      hash: "e71fa2190541574b",
    },
  ],
  hashState: [
    {
      id: "state-simple",
      input: { a: 1, b: "hello" },
      hash: "1d9910066157913d",
    },
  ],
  hashDrawList: [
    {
      id: "draw-simple",
      input: { protocolVersion: 3, tick: 0, width: 320, height: 240, commands: [] },
      hash: "a4c8af5374ed8af0",
    },
  ],
  rev: [
    {
      id: "rev-diff",
      a: {
        tick: 0,
        width: 320,
        height: 240,
        commands: [
          {
            kind: "blit",
            source: { surface: "s1", rev: 1 },
            src: { x: 0, y: 0, w: 10, h: 10 },
            dst: { x: 0, y: 0, w: 10, h: 10 },
            key: null,
            tint: { r: 0, g: 0, b: 0 },
            alpha: 255,
            blend: "normal",
            iso2d: false,
          },
        ],
      },
      b: {
        tick: 0,
        width: 320,
        height: 240,
        commands: [
          {
            kind: "blit",
            source: { surface: "s1", rev: 2 },
            src: { x: 0, y: 0, w: 10, h: 10 },
            dst: { x: 0, y: 0, w: 10, h: 10 },
            key: null,
            tint: { r: 0, g: 0, b: 0 },
            alpha: 255,
            blend: "normal",
            iso2d: false,
          },
        ],
      },
    },
  ],
};

test("checkVectors succeeds on valid vectors", () => {
  const result = checkVectors(JSON.stringify(VALID_VECTORS));
  equal(result.count, 7);
});

test("checkVectors rejects zero vector rows and bad JSON", () => {
  throws(() => checkVectors("not json"), /hash-vectors.json: invalid JSON/);
  throws(() => checkVectors("[]"), /hash-vectors.json: root must be an object/);
  throws(
    () => checkVectors(JSON.stringify({ canon: [] })),
    /hash-vectors.json: zero vector rows/,
  );
});

test("checkVectors reports first mismatch naming row id, expected, and actual", () => {
  const diffCases: readonly { name: string; mutate: (base: typeof VALID_VECTORS) => unknown; expectedSnippet: string }[] = [
    {
      name: "altered canon row",
      mutate: (base) => ({
        ...base,
        canon: [
          { ...base.canon[0], canonical: "wrong-canonical" },
          base.canon[1],
        ],
      }),
      expectedSnippet: "vector rfc8785-3.2.2-sample: canon mismatch",
    },
    {
      name: "altered fnv1a64 row",
      mutate: (base) => ({
        ...base,
        fnv1a64: [
          { ...base.fnv1a64[0], hash: "0000000000000000" },
          base.fnv1a64[1],
        ],
      }),
      expectedSnippet: "vector fnv-empty: fnv1a64 mismatch",
    },
    {
      name: "altered hashState row",
      mutate: (base) => ({
        ...base,
        hashState: [
          { ...base.hashState[0], hash: "0000000000000000" },
        ],
      }),
      expectedSnippet: "vector state-simple: hashState mismatch",
    },
    {
      name: "altered hashDrawList row",
      mutate: (base) => ({
        ...base,
        hashDrawList: [
          { ...base.hashDrawList[0], hash: "0000000000000000" },
        ],
      }),
      expectedSnippet: "vector draw-simple: hashDrawList mismatch",
    },
    {
      name: "rev pair with equal hashes",
      mutate: (base) => ({
        ...base,
        rev: [
          { ...base.rev[0], b: base.rev[0]!.a },
        ],
      }),
      expectedSnippet: "vector rev-diff: rev pair hashes must differ",
    },
  ];

  for (const { name, mutate, expectedSnippet } of diffCases) {
    const mutated = mutate(VALID_VECTORS);
    throws(
      () => checkVectors(JSON.stringify(mutated)),
      (err: unknown) => {
        return (
          err instanceof Error &&
          err.message.includes(expectedSnippet) &&
          err.message.includes("expected") &&
          err.message.includes("actual")
        );
      },
      `expected checkVectors to throw on ${name}`,
    );
  }
});
