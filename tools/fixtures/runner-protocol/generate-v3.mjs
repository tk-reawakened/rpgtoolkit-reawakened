// Strict runner boundary protocol v3 vectors (docs/spec/engine/runners.md#draw-list).
//
//   node tools/fixtures/runner-protocol/generate-v3.mjs          # write schema and vectors
//   node tools/fixtures/runner-protocol/generate-v3.mjs --check   # validate committed schema and vectors
//
// V3 is derived from the frozen v2 contract. Its marker and source-over blend are additive; v1/v2 stay untouched.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../fetch.mjs";
import { schemaErrors, schemaProblems, refName } from "./schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const schemaPath = join(repo, "packages/runner-harness/schema/runner-protocol-v3.schema.json");
const vectorsPath = join(here, "vectors-v3.json");
const baseSchemaPath = join(repo, "packages/runner-harness/schema/runner-protocol-v2.schema.json");
const baseVectorsPath = join(here, "vectors-v2.json");
const command = { kind: "fill", rgb: { r: 10, g: 20, b: 30 } };
const hashInput = { protocolVersion: 3, tick: 12, width: 640, height: 480, commands: [], marginCommands: [] };
const hashWithMargin = { ...hashInput, marginCommands: [command] };
const blit = (blend, alpha = 128) => ({
  kind: "blit", source: { asset: "ui/overlay.bmp", tile: null },
  src: { x: 0, y: 0, w: 2, h: 2 }, dst: { x: 4, y: 6, w: 2, h: 2 },
  key: null, tint: { r: 0, g: 0, b: 0 }, alpha, blend, iso2d: false,
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function drawHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
function documentOf(value) { return JSON.stringify(value, null, 2) + "\n"; }

function createSchema() {
  const schema = JSON.parse(readFileSync(baseSchemaPath, "utf8"));
  schema.$id = "https://tk-reawakened.dev/schema/runner-protocol-v3.schema.json";
  schema.title = "TK Reawakened runner boundary protocol v3";
  schema.description = `${schema.description} V3 DrawList records require protocolVersion 3 and support source-over.`;
  schema.$defs.drawList.required = ["protocolVersion", "tick", "width", "height", "commands", "marginCommands"];
  schema.$defs.drawList.properties.protocolVersion = { type: "integer", const: 3 };
  schema.$defs.blit.properties.blend.enum.push("source-over");
  return schema;
}

function createVectors() {
  const old = JSON.parse(readFileSync(baseVectorsPath, "utf8"));
  const rows = old.vectors.map((vector) => vector.family !== "draw" ? structuredClone(vector) : {
    ...structuredClone(vector), record: { protocolVersion: 3, ...vector.record },
  });
  rows.push(
    { id: "draw-blit-additive", family: "draw", valid: true, record: { ...hashInput, commands: [blit("additive")] } },
    { id: "draw-blit-source-over", family: "draw", valid: true, record: { ...hashInput, commands: [blit("source-over")] } },
    { id: "draw-margin-blit-source-over", family: "draw", valid: true, record: { ...hashInput, marginCommands: [blit("source-over", 255)] } },
    { id: "refuse-draw-missing-protocol-version", family: "draw", valid: false, why: "v3 requires an explicit protocolVersion", record: { tick: 12, width: 640, height: 480, commands: [], marginCommands: [] } },
    { id: "refuse-draw-unsupported-protocol-version", family: "draw", valid: false, why: "v3 accepts only protocolVersion 3", record: { ...hashInput, protocolVersion: 2 } },
    { id: "refuse-blit-unknown-blend", family: "draw", valid: false, why: "v3 rejects unknown blend modes", record: { ...hashInput, commands: [blit("multiply")] } },
  );
  return {
    schema: 3,
    protocol: "runner-protocol-v3",
    note: "V3 is the strict runner contract: every DrawList requires protocolVersion 3, both command planes, and supports source-over. V1 and v2 schemas and vectors remain unchanged. Validate against packages/runner-harness/schema/runner-protocol-v3.schema.json.",
    counts: {
      draw: rows.filter((vector) => vector.family === "draw").length,
      input: rows.filter((vector) => vector.family === "input").length,
      request: rows.filter((vector) => vector.family === "request").length,
      valid: rows.filter((vector) => vector.valid).length,
      invalid: rows.filter((vector) => !vector.valid).length,
    },
    vectors: rows,
    hashDrawList: [
      { id: "draw-empty-margin-hash", input: hashInput, hash: drawHash(hashInput) },
      { id: "draw-margin-only-change", a: hashInput, b: hashWithMargin, hashA: drawHash(hashInput), hashB: drawHash(hashWithMargin) },
    ],
  };
}

function kindSetFromOneOf(schema, node) {
  const values = new Set();
  const visit = (current, seen = new Set()) => {
    if (current == null) return;
    if (current.$ref !== undefined) {
      const name = refName(current.$ref);
      if (name === null || seen.has(name)) return;
      visit(schema.$defs[name], new Set(seen).add(name));
      return;
    }
    if (current.properties?.kind?.const !== undefined) values.add(current.properties.kind.const);
    for (const alternative of current.oneOf ?? []) visit(alternative, seen);
  };
  visit(node);
  return values;
}

export async function check({ schema: schemaOverride, committedSchema, vectors: vectorsOverride, committedVectors, sources = {} } = {}) {
  const schema = schemaOverride ?? JSON.parse(readFileSync(schemaPath, "utf8"));
  const vectors = vectorsOverride ?? createVectors();
  const problems = [];
  const expectedSchema = createSchema();
  const schemaText = committedSchema ?? (existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : null);
  const vectorText = committedVectors ?? (existsSync(vectorsPath) ? readFileSync(vectorsPath, "utf8") : null);
  if (schemaText !== null && schemaText !== documentOf(expectedSchema)) problems.push(`${schemaPath} differs; run node tools/fixtures/runner-protocol/generate-v3.mjs`);
  if (vectorText !== null && vectorText !== documentOf(vectors)) problems.push(`${vectorsPath} differs; run node tools/fixtures/runner-protocol/generate-v3.mjs`);
  problems.push(...schemaProblems(schema));
  for (const vector of vectors.vectors) {
    const errors = schemaErrors(schema, vector.record);
    if (vector.valid && errors.length > 0) problems.push(`vector ${vector.id}: should be valid but ${errors.join("; ")}`);
    else if (!vector.valid && errors.length === 0) problems.push(`vector ${vector.id}: should be refused${vector.why === undefined ? "" : ` (${vector.why})`}`);
  }
  for (const family of ["draw", "input", "request"]) {
    const covered = new Set(vectors.vectors.filter((vector) => vector.family === family && vector.valid).flatMap((vector) => {
      if (family === "draw") return [...vector.record.commands, ...vector.record.marginCommands].map((draw) => draw.kind);
      if (family === "input") return [vector.record.event.kind];
      return [vector.record.kind];
    }));
    const definition = schema.$defs[family === "draw" ? "drawCommand" : family === "input" ? "inputEvent" : "request"];
    for (const kind of kindSetFromOneOf(schema, definition)) if (!covered.has(kind)) problems.push(`vector kit covers ${family} kind "${kind}" defined in the schema`);
  }
  const blends = schema.$defs.blit?.properties?.blend?.enum ?? [];
  if (!blends.includes("source-over")) problems.push('schema: v3 blit blend must allow "source-over"');
  const usedBlends = new Set(vectors.vectors.filter((vector) => vector.family === "draw" && vector.valid)
    .flatMap((vector) => [...vector.record.commands, ...vector.record.marginCommands])
    .filter((draw) => draw.kind === "blit").map((draw) => draw.blend));
  for (const blend of blends) if (!usedBlends.has(blend)) problems.push(`vector kit covers blit blend "${blend}" defined in the schema`);
  for (const id of ["refuse-draw-missing-protocol-version", "refuse-draw-unsupported-protocol-version", "refuse-blit-unknown-blend"]) {
    if (!vectors.vectors.some((vector) => vector.id === id && vector.valid === false)) problems.push(`vector kit requires refusal vector "${id}"`);
  }
  for (const row of vectors.hashDrawList) {
    if (row.id === "draw-margin-only-change" && row.hashA === row.hashB) problems.push("draw-margin-only-change: marginCommands must affect the draw hash");
  }
  const { typeProblems } = await import("./types.mjs");
  problems.push(...typeProblems(schema, { sources, drawAlias: "DrawList", inputAlias: "InputRecord" }));
  return problems;
}

if (isEntryPoint(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = await check();
    if (problems.length > 0) { console.error(problems.join("\n")); process.exitCode = 1; }
  } else {
    writeFileSync(schemaPath, documentOf(createSchema()));
    writeFileSync(vectorsPath, documentOf(createVectors()));
  }
}
