/**
 * A conformance check for the JSON Schema subset the committed schemas use
 * (docs/spec/schemas/). No validator dependency (G6): the supported keywords are listed, and a
 * keyword outside the list fails the check instead of being ignored.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Schema = { readonly [key: string]: unknown };

const SUPPORTED = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description", "type", "additionalProperties", "required",
  "properties", "items", "pattern", "minLength", "minimum", "minItems", "enum", "const",
]);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function loadSchema(name: string): Schema {
  const schema = JSON.parse(readFileSync(join(repoRoot, "docs/spec/schemas", name), "utf8")) as Schema;
  const found = new Set<string>();
  keywords(schema, found);
  for (const keyword of found) if (!SUPPORTED.has(keyword)) throw new Error(`the schema ${name} uses ${keyword}, which this checker does not implement`);
  return schema;
}

function keywords(schema: unknown, found: Set<string>): void {
  if (schema === null || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "$defs") {
      for (const child of Object.values(value as object)) keywords(child, found);
      continue;
    }
    found.add(key);
    if (key === "items") keywords(value, found);
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function resolveRef(ref: string, root: Schema): Schema {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref ${ref}`);
  const def = (root.$defs as Record<string, Schema>)[ref.slice(prefix.length)];
  if (def === undefined) throw new Error(`$ref ${ref} names no definition`);
  return def;
}

/** The problems of `value` against `schema`; empty when it conforms. */
export function problems(value: unknown, schema: Schema, root: Schema = schema, at = "document"): string[] {
  if (typeof schema.$ref === "string") return problems(value, resolveRef(schema.$ref, root), root, at);
  const errors: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const matches = actual === "number" && types.includes("integer") && Number.isInteger(value);
    if (!matches && !types.includes(actual)) return [`${at}: expected ${types.join("|")}, got ${actual}`];
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${at}: ${value} is below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items !== undefined) value.forEach((item, index) => errors.push(...problems(item, schema.items as Schema, root, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!Object.hasOwn(record, key)) errors.push(`${at}: missing required ${key}`);
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) if (!Object.hasOwn(properties, key)) errors.push(`${at}: unexpected property ${key}`);
    }
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(record, key)) errors.push(...problems(record[key], child, root, `${at}.${key}`));
  }
  return errors;
}
