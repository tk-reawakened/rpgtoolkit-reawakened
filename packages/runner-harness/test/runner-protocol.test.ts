/**
 * The runner boundary schema and its vector kit (docs/spec/engine/runners.md#conformance-lane).
 *
 * Three checks, in the order the page states them:
 *  - the committed schema is well formed and every `$ref` resolves inside it;
 *  - every vector's recorded verdict matches what the schema says — a valid record
 *    is accepted, a refusal is refused;
 *  - the kit covers every kind the core can put on the boundary. The maps below
 *    are `Record<Kind, true>`, so a new command, input event or request kind in
 *    `core` fails the type check until it has a vector, and the runtime assertion
 *    then fails until the vector exists. That is the drift gate: neither the page,
 *    the schema nor the kit can quietly fall behind the code.
 */

import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_REQUEST_KINDS } from "@tk-reawakened/core";
import type { DrawCommand, InputEvent, InputRecord, RunnerRequest } from "@tk-reawakened/core";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json | Schema };
type Family = "draw" | "input" | "request";
interface Vector {
  readonly id: string;
  readonly family: Family;
  readonly valid: boolean;
  readonly why?: string;
  readonly record: Record<string, Json>;
}
interface Vectors {
  readonly protocol: string;
  readonly counts: Record<Family, number>;
  readonly vectors: readonly Vector[];
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(here, "../schema/runner-protocol-v1.schema.json"), "utf8"),
) as unknown as Schema;
const kit = JSON.parse(
  readFileSync(join(here, "../../../tools/fixtures/runner-protocol/vectors.json"), "utf8"),
) as Vectors;

function object(value: Json | Schema): { [key: string]: Json | Schema } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("schema object expected");
  return value as { [key: string]: Json | Schema };
}
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Small JSON-Schema 2020-12 evaluator for the subset this schema uses. */
function schemaErrors(root: Schema, value: Json, current: Schema = root, path = "$"): string[] {
  const errors: string[] = [];
  const ref = current.$ref;
  if (typeof ref === "string") {
    if (!ref.startsWith("#/")) {
      errors.push(`${path}: unsupported $ref ${ref}`);
      return errors;
    }
    const target = ref.split("/").slice(1).reduce<Json | Schema>((part, key) => object(part)[key] as Json | Schema, root);
    errors.push(...schemaErrors(root, value, object(target), path));
  }
  const type = current.type;
  if (typeof type === "string") {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const wanted = type === "integer" ? "number" : type;
    if (actual !== wanted || (type === "integer" && typeof value === "number" && !Number.isInteger(value))) {
      errors.push(`${path}: expected ${type}, got ${actual}`);
    }
  }
  const constant = current.const;
  if (constant !== undefined && JSON.stringify(constant) !== JSON.stringify(value)) errors.push(`${path}: const mismatch`);
  const enumeration = current.enum;
  if (Array.isArray(enumeration) && !enumeration.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    errors.push(`${path}: not in enum`);
  }
  const minLength = current.minLength;
  if (typeof minLength === "number" && typeof value === "string" && value.length < minLength) errors.push(`${path}: too short`);
  const pattern = current.pattern;
  if (typeof pattern === "string" && typeof value === "string" && !new RegExp(pattern).test(value)) {
    errors.push(`${path}: pattern mismatch`);
  }
  if (typeof value === "number") {
    for (const key of ["minimum", "maximum"] as const) {
      const bound = current[key];
      if (typeof bound === "number" && (key === "minimum" ? value < bound : value > bound)) errors.push(`${path}: ${key} mismatch`);
    }
  }
  const oneOf = current.oneOf;
  if (Array.isArray(oneOf)) {
    const matches = oneOf.filter((candidate) => schemaErrors(root, value, object(candidate), path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: oneOf matched ${matches}`);
  }
  if (Array.isArray(value) && current.items !== undefined) {
    value.forEach((item, index) => errors.push(...schemaErrors(root, item, object(current.items as Schema), `${path}[${index}]`)));
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const required = current.required;
    if (Array.isArray(required)) {
      for (const key of required) if (typeof key === "string" && !hasOwn(value, key)) errors.push(`${path}: missing ${key}`);
    }
    const properties = current.properties === undefined ? {} : object(current.properties);
    if (current.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!hasOwn(properties, key)) errors.push(`${path}: extra ${key}`);
    } else if (current.additionalProperties !== undefined && typeof current.additionalProperties === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (!hasOwn(properties, key)) errors.push(...schemaErrors(root, child as Json, object(current.additionalProperties as Schema), `${path}.${key}`));
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (hasOwn(value, key)) errors.push(...schemaErrors(root, value[key] as Json, object(child), `${path}.${key}`));
    }
  }
  return errors;
}

function collectRefs(node: Json | Schema, refs: string[] = []): string[] {
  if (node === null || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item as Json | Schema, refs);
    return refs;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") refs.push(value);
    else collectRefs(value as Json | Schema, refs);
  }
  return refs;
}

test("the runner schema is well formed and every $ref resolves inside it", () => {
  equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  ok(typeof schema.$id === "string" && String(schema.$id).endsWith("runner-protocol-v1.schema.json"));
  const defs = object(schema.$defs as Schema);
  for (const ref of collectRefs(schema)) {
    ok(ref.startsWith("#/$defs/"), `external or unexpected $ref: ${ref}`);
    const name = ref.slice("#/$defs/".length);
    ok(hasOwn(defs, name), `unresolved $ref: ${ref}`);
  }
});

test("the schema accepts every valid vector and refuses every recorded refusal", () => {
  for (const vector of kit.vectors) {
    const errors = schemaErrors(schema, vector.record as Json);
    if (vector.valid) deepEqual(errors, [], `${vector.id} should be valid`);
    else ok(errors.length > 0, `${vector.id} should be refused${vector.why === undefined ? "" : ` (${vector.why})`}`);
  }
});

/* Exhaustive kind maps: a new kind in core fails the type check here first. */
const DRAW_KINDS: Record<DrawCommand["kind"], true> = {
  blit: true,
  fill: true,
  line: true,
  rect: true,
  ellipse: true,
  text: true,
  pushTarget: true,
  popTarget: true,
};
const INPUT_KINDS: Record<InputEvent["kind"], true> = {
  key: true,
  pointer: true,
  gamepad: true,
  focus: true,
  asset: true,
  "blob.loaded": true,
  "blob.saved": true,
  "blob.listed": true,
  "extension.result": true,
  "audio.ended": true,
  "video.ended": true,
};
const REQUEST_KINDS: Record<RunnerRequest["kind"], true> = {
  asset: true,
  loadBlob: true,
  saveBlob: true,
  listBlobs: true,
  "extension.call": true,
  quit: true,
  openUrl: true,
  playVideo: true,
};

function covered(family: Family): string[] {
  const kinds = new Set<string>();
  for (const vector of kit.vectors) {
    if (!vector.valid || vector.family !== family) continue;
    if (family === "draw") {
      for (const command of vector.record.commands as readonly Record<string, Json>[]) kinds.add(String(command.kind));
    } else if (family === "input") {
      kinds.add(String((vector.record.event as Record<string, Json>).kind));
    } else {
      kinds.add(String(vector.record.kind));
    }
  }
  return [...kinds].sort();
}

test("the kit covers every draw command, input event and request kind", () => {
  deepEqual(covered("draw"), Object.keys(DRAW_KINDS).sort());
  deepEqual(covered("input"), Object.keys(INPUT_KINDS).sort());
  deepEqual(covered("request"), Object.keys(REQUEST_KINDS).sort());
  deepEqual(Object.keys(REQUEST_KINDS).sort(), [...HOST_REQUEST_KINDS].sort(), "the requests a package may declare and the kinds on the wire are the same set");
  deepEqual(kit.counts, { draw: 12, input: 15, request: 10 });
});

test("an input record stamps its event with the consuming tick", () => {
  const record = kit.vectors.find((vector) => vector.family === "input" && vector.valid);
  ok(record !== undefined);
  const stamped = record.record as unknown as InputRecord;
  equal(stamped.tick, 12);
  ok(typeof (stamped.event as InputEvent).kind === "string");
});
