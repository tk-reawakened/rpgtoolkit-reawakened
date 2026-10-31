import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  PACKAGE_ROOT,
  utf8Encode,
  type ProgramLoader,
} from "@tk-reawakened/core";
import { buildIndex, INDEX_SCHEMA, type IndexDocument } from "../src/index.ts";

/**
 * The index document (docs/spec/engine/rpgcode-tooling.md#tool-6): one versioned
 * JSON value, validated against the committed schema, byte-stable across two
 * runs, and honest about a program that does not compile.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const schemaPath = join(repoRoot, "docs/spec/schemas/tkr-script-index.schema.json");

// --- A conformance check for the exact JSON Schema subset the committed schema uses. ---
// No validator dependency (G6): the supported keywords are listed, and a keyword
// outside the list fails the test instead of being ignored.

type Schema = { readonly [key: string]: unknown };

const SUPPORTED = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "additionalProperties",
  "required",
  "properties",
  "items",
  "pattern",
  "minLength",
  "minimum",
  "enum",
  "const",
]);

function schemaKeywords(schema: unknown, found: Set<string>): void {
  if (schema === null || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "$defs") {
      for (const child of Object.values(value as object)) schemaKeywords(child, found);
      continue;
    }
    found.add(key);
    if (key === "items") schemaKeywords(value, found);
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

function validate(value: unknown, schema: Schema, root: Schema, at: string): string[] {
  if (typeof schema.$ref === "string") return validate(value, resolveRef(schema.$ref, root), root, at);
  const errors: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const matches = actual === "number" && types.includes("integer") && Number.isInteger(value);
    if (!matches && !types.includes(actual)) {
      errors.push(`${at}: expected ${types.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${at}: ${value} is below ${schema.minimum}`);
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validate(item, schema.items as Schema, root, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!Object.hasOwn(record, key)) errors.push(`${at}: missing required ${key}`);
    }
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${at}: unexpected property ${key}`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(record, key)) errors.push(...validate(record[key], child, root, `${at}.${key}`));
    }
  }
  return errors;
}

function assertSchema(document: unknown): void {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Schema;
  const keywords = new Set<string>();
  schemaKeywords(schema, keywords);
  for (const keyword of keywords) {
    ok(SUPPORTED.has(keyword), `the schema uses ${keyword}, which this checker does not implement`);
  }
  deepEqual(validate(document, schema, schema, "document"), []);
}

// --- fixtures ---

const MAIN = [
  '#include "lib.prg"',
  'function twice(n) { return n + n }',
  'function twice(a, b) { return a + b }',
  'class counter {',
  '  public:',
  '  var value',
  '  method bump() { this->value = this->value + 1 }',
  '}',
  ':start',
  'x = MWin("hi")',
  'y = lib.helper(1)',
  'on("error", handler)',
  'game.on("dialogue.completed", (e) => { done(e) })',
  'while (x == 1) { x = 2 }',
  '',
].join("\n");

const LIB = ['function helper(a) { return a }', ':again', ''].join("\n");

function loader(files: Readonly<Record<string, string>>): ProgramLoader {
  const paths = Object.keys(files).map((name) => `Prg/${name}`);
  const bytes = new Map<string, Uint8Array>();
  for (const [name, text] of Object.entries(files)) bytes.set(assetKey(`Prg/${name}`), utf8Encode(text));
  return {
    index: createAssetIndex(paths),
    root: PACKAGE_ROOT,
    read: (key) => bytes.get(key),
  };
}

function fixtureIndex(): IndexDocument {
  // A file ref needs the source hash the index does not check here; compile the main
  // file through the loader as a file program with its real hash would, so use inline
  // text for main and a loader for its includes.
  return buildIndex(
    [
      { name: "main.prg", ref: { kind: "inline", text: MAIN, ir: "1" } },
    ],
    { loader: loader({ "main.prg": MAIN, "lib.prg": LIB }), startups: [{ package: "mypkg", program: "main.prg" }] },
  );
}

test("the document validates against the committed schema", () => {
  const document = fixtureIndex();
  equal(document.schema, INDEX_SCHEMA);
  assertSchema(document);
});

test("two runs produce identical bytes", () => {
  equal(JSON.stringify(fixtureIndex(), null, 2), JSON.stringify(fixtureIndex(), null, 2));
});

test("definitions: functions with arity, a class with members and methods, labels across files", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  deepEqual(
    program.functions.map((fn) => [fn.name, fn.arity, fn.file, fn.line]),
    [
      ["twice", 1, "<inline>", 2],
      ["twice", 2, "<inline>", 3],
      ["helper", 1, "prg/lib.prg", 1],
    ],
  );
  equal(program.functions[0]?.id, "<inline>#function:twice");
  const [counter] = program.classes;
  ok(counter);
  equal(counter.qualifiedName, "counter");
  deepEqual(counter.bases, []);
  deepEqual(
    counter.members.map((member) => [member.name, member.access, member.arraySize]),
    [["value", "public", null]],
  );
  deepEqual(
    counter.methods.map((method) => [method.qualifiedName, method.arity, method.access, method.isPure]),
    [["counter.bump", 0, "public", false]],
  );
  deepEqual(
    program.labels.map((label) => [label.name, label.file]),
    [
      ["start", "<inline>"],
      ["again", "prg/lib.prg"],
    ],
  );
});

test("includes: the explicit #include and the implicit file.func call, both resolved", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  deepEqual(
    program.includes.map((include) => [include.path, include.implicit, include.key, include.file, include.line]),
    [
      ["lib.prg", false, "prg/lib.prg", "<inline>", 1],
      ["lib.prg", true, "prg/lib.prg", "<inline>", 11],
      // `game.on(...)` reads like a `file.func` call to the compiler, so it queues
      // `game.prg` as an implicit include; nothing serves it, so it has no key.
      ["game.prg", true, undefined, "<inline>", 13],
    ],
  );
  deepEqual(program.files, ["<inline>", "prg/lib.prg"]);
});

test("calls keep the folded name and the written spelling, and a file call keeps its file", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  const mwin = program.calls.find((call) => call.name === "mwin");
  ok(mwin);
  equal(mwin.written, "MWin");
  equal(mwin.arity, 1);
  deepEqual(mwin.pos, { file: "<inline>", line: 10, col: 5, endCol: 8 });
  const helper = program.calls.find((call) => call.name === "helper");
  ok(helper);
  equal(helper.file, "lib");
  equal(helper.arity, 1);
  ok(program.calls.some((call) => call.name === "done"));
});

test("references cover reads, declarations, members and stores", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  const read = program.references.find((site) => site.kind === "read" && site.name === "handler");
  ok(read);
  equal(read.written, "handler");
  ok(program.references.some((site) => site.kind === "member" && site.name === "value"));
  const store = program.references.find((site) => site.kind === "store");
  ok(store, "an assignment lowers a storeRef");
  equal(store.name, null, "the IR keeps a store target on the stack, so the site has no name");
});

test("listeners: a plain on() and a game.on() both name their literal event", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  deepEqual(
    program.listeners.map((listener) => [listener.event, listener.call]),
    [
      ["error", "on"],
      ["dialogue.completed", "on"],
    ],
  );
});

test("a package start-up program is marked", () => {
  const [program] = fixtureIndex().programs;
  ok(program);
  deepEqual(program.startup, ["mypkg"]);
});

test("a program that does not compile yields its diagnostic and no fabricated facts", () => {
  const document = buildIndex([{ name: "broken.prg", ref: { kind: "inline", text: "x = )\n", ir: "1" } }]);
  assertSchema(document);
  const [program] = document.programs;
  ok(program);
  equal(program.diagnostics.length, 1);
  equal(program.diagnostics[0]?.code, "syntax.error");
  deepEqual([program.files, program.functions, program.classes, program.labels, program.includes, program.calls, program.references, program.listeners], [[], [], [], [], [], [], [], []]);
  equal(document.diagnostics.length, 1);
});

test("a real stock program: its listener, calls and the game reference", () => {
  const text = readFileSync(join(repoRoot, "stock/stock_rpg/startup.prg"), "utf8");
  const document = buildIndex([{ name: "stock_rpg/startup.prg", ref: { kind: "inline", text, ir: "1" } }]);
  assertSchema(document);
  const [program] = document.programs;
  ok(program);
  deepEqual(
    program.listeners.map((listener) => [listener.event, listener.call]),
    [["dialogue.completed", "on"]],
  );
  // `game.on(...)` binds as the compiler reads it: a call to `on` in file `game`.
  deepEqual(
    program.calls.map((call) => [call.name, call.arity, call.file]),
    [
      ["on", 2, "game"],
      ["bridgetalked", 1, null],
    ],
  );
  const onCall = program.calls.find((call) => call.name === "on");
  ok(onCall);
  equal(onCall.written, "game", "the call's position is the receiver token, so it slices `game`");
  ok(program.references.some((site) => site.kind === "read" && site.name === "e"));
});
