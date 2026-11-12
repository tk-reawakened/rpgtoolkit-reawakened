import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { check as checkV2 } from "../runner-protocol/generate-v2.mjs";
import { check as checkV3 } from "../runner-protocol/generate-v3.mjs";
import { schemaErrors } from "../runner-protocol/schema.mjs";

const v2SchemaPath = "packages/runner-harness/schema/runner-protocol-v2.schema.json";
const v3SchemaPath = "packages/runner-harness/schema/runner-protocol-v3.schema.json";
const v2VectorsPath = "tools/fixtures/runner-protocol/vectors-v2.json";
const v3VectorsPath = "tools/fixtures/runner-protocol/vectors-v3.json";
const drawPath = "packages/core/src/ports/draw.ts";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const v2Schema = () => readJson(v2SchemaPath);
const v2Vectors = () => readJson(v2VectorsPath);
const v3Schema = () => readJson(v3SchemaPath);
const v3Vectors = () => readJson(v3VectorsPath);

async function v3Problems({ schema, vectors, sources } = {}) {
  return checkV3({ schema: schema ?? v3Schema(), vectors: vectors ?? v3Vectors(), sources });
}

test("historical protocol schemas and vector kits remain byte-for-byte frozen", () => {
  const frozen = [
    ["packages/runner-harness/schema/runner-protocol-v1.schema.json", "1017bcbcef40c4b5530c09509a21e462d8c96d144eb549634265b20b22046d41"],
    ["tools/fixtures/runner-protocol/vectors.json", "8313d922ad7cf6a743e4bc70731cb5386c0f0c080bb6aa951bfe30b91483ab0c"],
    [v2SchemaPath, "ce541916646a8f5b7639cb52054e464af8ef4f09ad6c5459cdc98c65134a06c2"],
    [v2VectorsPath, "227773ce6cd9d32104fbae34ee71da9c3eab6c6cf8dde57fe0574d2c159497f2"],
  ];
  for (const [path, expected] of frozen) {
    equal(createHash("sha256").update(readFileSync(path)).digest("hex"), expected, path);
  }
});

test("v3 schema-only marker weakening is caught by refusal vectors", async () => {
  const schema = v3Schema();
  schema.$defs.drawList.required = schema.$defs.drawList.required.filter((key) => key !== "protocolVersion");
  delete schema.$defs.drawList.properties.protocolVersion;
  ok((await v3Problems({ schema })).some((problem) => problem.includes("vector refuse-draw-missing-protocol-version: should be refused")));
});

test("v3 TypeScript-only marker drift is caught", async () => {
  const problems = await v3Problems({
    sources: { [drawPath]: (text) => text.replace("readonly protocolVersion: 3;", "readonly protocolVersion: 2;") },
  });
  ok(problems.some((problem) => problem.includes("protocolVersion")));
});

test("v3 vector kit removal of source-over coverage is caught", async () => {
  const vectors = v3Vectors();
  vectors.vectors = vectors.vectors.filter((vector) => vector.id !== "draw-blit-source-over" && vector.id !== "draw-margin-blit-source-over");
  ok((await v3Problems({ vectors })).some((problem) => problem.includes('vector kit covers blit blend "source-over"')));
});

test("v3 unknown-blend refusal vector catches schema widening", async () => {
  const schema = v3Schema();
  schema.$defs.blit.properties.blend = { type: "string" };
  ok((await v3Problems({ schema })).some((problem) => problem.includes("vector refuse-blit-unknown-blend: should be refused")));
});

test("v3 schema refuses missing and unsupported protocol versions", () => {
  const schema = v3Schema();
  const draw = v3Vectors().vectors.find((vector) => vector.id === "draw-blit-source-over").record;
  const missing = { ...draw };
  delete missing.protocolVersion;
  ok(schemaErrors(schema, missing).length > 0);
  ok(schemaErrors(schema, { ...draw, protocolVersion: 2 }).length > 0);
});

test("v2 and v3 refuse each other's draw-list frames", async () => {
  const v3Record = v3Vectors().vectors.find((vector) => vector.id === "draw-empty-margin-plane").record;
  const oldV2Schema = v2Schema();
  ok(schemaErrors(oldV2Schema, v3Record).length > 0);
  const oldV2 = v2Vectors();
  oldV2.vectors.push({ id: "v2-refuses-v3", family: "draw", valid: false, record: v3Record });
  const oldV2Problems = await checkV2({ schema: oldV2Schema, vectors: oldV2 });
  ok(!oldV2Problems.some((problem) => problem.includes("vector v2-refuses-v3: should be refused")));

  const v2Record = v2Vectors().vectors.find((vector) => vector.family === "draw" && vector.valid).record;
  ok(schemaErrors(v3Schema(), v2Record).length > 0);
  const v3 = v3Vectors();
  v3.vectors.push({ id: "v3-refuses-v2", family: "draw", valid: true, record: v2Record });
  const newV3Problems = await checkV3({ schema: v3Schema(), vectors: v3 });
  ok(newV3Problems.some((problem) => problem.includes("vector v3-refuses-v2: should be valid but")));
});

test("v3 runner-protocol artifacts are reproducible and conformant", async () => {
  ok(await checkV3().then((problems) => problems.length === 0));
});
