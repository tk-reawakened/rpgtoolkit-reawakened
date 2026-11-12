import { test } from "node:test";
import { deepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../runner-protocol/generate.mjs";
import { schemaErrors } from "../runner-protocol/schema.mjs";

test("runner protocol vectors are reproducible in check mode", async () => {
  deepEqual(await check(), []);
});

test("v1 protocol validation remains independent of later core input-event kinds", async () => {
  deepEqual(await check({
    sources: {
      "packages/core/src/ports/input.ts": (text) => text.replace(
        'readonly kind: "action";',
        'readonly kind: "future.action";',
      ),
    },
  }), []);
});

test("v1 checker rejects a schema that admits the published v2 action", async () => {
  const v1 = JSON.parse(readFileSync(new URL("../../../packages/runner-harness/schema/runner-protocol-v1.schema.json", import.meta.url), "utf8"));
  const v2 = JSON.parse(readFileSync(new URL("../../../packages/runner-harness/schema/runner-protocol-v2.schema.json", import.meta.url), "utf8"));
  const action = { tick: 12, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: null } };
  ok(schemaErrors(v1, action).length > 0, "published v1 refuses the action");
  deepEqual(schemaErrors(v2, action), [], "published v2 accepts the action");
  const widened = structuredClone(v1);
  widened.$defs.actionInput = v2.$defs.actionInput;
  widened.$defs.inputEvent.oneOf.push({ $ref: "#/$defs/actionInput" });
  deepEqual(schemaErrors(widened, action), [], "the mutation admits the action");
  ok((await check({ schema: widened })).includes("v1 schema must reject semantic action input"));
});

const blitWith = (blend) => ({
  tick: 12, width: 640, height: 480,
  commands: [{ kind: "blit", source: { asset: "ui/overlay.bmp", tile: null }, src: { x: 0, y: 0, w: 2, h: 2 }, dst: { x: 0, y: 0, w: 2, h: 2 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 128, blend, iso2d: false }],
});
const loadSchema = (version) => JSON.parse(readFileSync(new URL(`../../../packages/runner-harness/schema/runner-protocol-v${version}.schema.json`, import.meta.url), "utf8"));

test("published v1 and v2 refuse source-over while v3 accepts it", () => {
  ok(schemaErrors(loadSchema(1), blitWith("source-over")).length > 0, "v1 refuses source-over");
  deepEqual(schemaErrors(loadSchema(1), blitWith("additive")), [], "v1 still accepts its own blends");
  ok(schemaErrors(loadSchema(2), { ...blitWith("source-over"), marginCommands: [] }).length > 0, "v2 refuses source-over");
  deepEqual(schemaErrors(loadSchema(3), { protocolVersion: 3, ...blitWith("source-over"), marginCommands: [] }), [], "v3 accepts source-over");
});

test("v1 checker rejects a schema that admits source-over", async () => {
  const widened = loadSchema(1);
  widened.$defs.blit.properties.blend.enum.push("source-over");
  ok((await check({ schema: widened })).includes("v1 schema must reject source-over blend"));
});

test("v1 type check compares the historical DrawListV1, not the active DrawList", async () => {
  const drawPath = "packages/core/src/ports/draw.ts";
  const widenedV1 = await check({
    sources: { [drawPath]: (text) => text.replace('export type BlendV1 = "normal" | "additive" | "translucent";', 'export type BlendV1 = "normal" | "additive" | "translucent" | "source-over";') },
  });
  ok(widenedV1.some((problem) => problem.includes('TypeScript allows "source-over"; the schema does not')));
  // Perturbing only the active v3 blend leaves the frozen v1 comparison untouched.
  deepEqual(await check({
    sources: { [drawPath]: (text) => text.replace('export type Blend = BlendV1 | "source-over";', 'export type Blend = BlendV1 | "source-over" | "multiply";') },
  }), []);
});
