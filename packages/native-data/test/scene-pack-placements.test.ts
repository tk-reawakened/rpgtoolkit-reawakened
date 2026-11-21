import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { formatSceneProblems, readScene, writeScene, type Scene } from "../src/scene.ts";
import { setScenePackPlacements } from "../src/scene-pack-placements.ts";

const SOURCE = `contract: scene
version: 1.0.0-pre.2
name: Pond # keep this comment
projection: 2d
size: {width: 4, height: 3}
floors: [{id: ground}, {id: upper}]
placedPacks:
  - instanceId: lantern-1 # the lantern
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
terrainRegions: []
pluginData:
  com.example.weather: # plugin-owned block
    version: 0.1.0
    data:
      wind: 3
`;

const lantern = { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 24, y: 40 } as const;
const arch = { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 8, y: 16 } as const;

void test("a placement is written beside the list in contract order, leaving every other byte as written", () => {
  const result = setScenePackPlacements(SOURCE, [lantern, arch]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  equal(result.text, SOURCE.replace(`    y: 40
terrainRegions`, `    y: 40
  - instanceId: arch-1
    pack: Packs/props.tkrpack
    asset: arch
    floor: ground
    x: 8
    y: 16
terrainRegions`));
  ok(result.text.includes("name: Pond # keep this comment"));
  ok(result.text.includes("  com.example.weather: # plugin-owned block"));
  const parsed = readScene(result.text);
  ok(parsed.ok);
  deepEqual(parsed.scene.placedPacks, [lantern, arch]);
});

void test("a record is updated where it stands: identity, comments and unrelated keys stay", () => {
  const result = setScenePackPlacements(SOURCE, [{ ...lantern, floor: "upper", x: 56, y: 72 }]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  equal(result.text, SOURCE
    .replace("    floor: ground\n    x: 24", "    floor: upper\n    x: 56")
    .replace("    y: 40", "    y: 72"));
  ok(result.text.includes("instanceId: lantern-1 # the lantern"));
});

void test("removing a record takes its own lines; removing the last also removes the key", () => {
  withTwo(SOURCE, (text) => {
    const middle = setScenePackPlacements(text, [arch]);
    ok(middle.ok, middle.ok ? "" : formatSceneProblems(middle.problems));
    ok(!middle.text.includes("instanceId: lantern-1"));
    ok(middle.text.includes("instanceId: arch-1"));
    ok(middle.text.includes("name: Pond # keep this comment"));

    const last = setScenePackPlacements(middle.text, []);
    ok(last.ok, last.ok ? "" : formatSceneProblems(last.problems));
    ok(!last.text.includes("placedPacks"));
    ok(last.text.includes("terrainRegions: []"));
    ok(last.text.includes("pluginData:"));
    const parsed = readScene(last.text);
    ok(parsed.ok);
    equal(parsed.scene.placedPacks, undefined);
  });
});

void test("a list that writeScene emits as empty takes its first placement", () => {
  const written = writeScene({
    contract: "scene", version: "1.0.0-pre.2", projection: "2d", size: { width: 1, height: 1 },
    floors: [{ id: "ground" }], placedPacks: [],
  } satisfies Scene);
  ok(written.ok, written.ok ? "" : formatSceneProblems(written.problems));
  ok(written.text.includes("placedPacks: []"));
  const result = setScenePackPlacements(written.text, [lantern]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  const parsed = readScene(result.text);
  ok(parsed.ok);
  deepEqual(parsed.scene.placedPacks, [lantern]);
});

void test("an authored empty list takes its first placement without reprinting the key or its comments", () => {
  const seed = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
# pack seeds
placedPacks: [] # none yet
atmosphere: {music: pond.ogg}
`;
  const result = setScenePackPlacements(seed, [lantern]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  equal(result.text, `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
# pack seeds
placedPacks:
  - instanceId: lantern-1
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40 # none yet
atmosphere: {music: pond.ogg}
`);
  const second = setScenePackPlacements(result.text, [lantern, arch]);
  ok(second.ok, second.ok ? "" : formatSceneProblems(second.problems));
  ok(second.text.includes("instanceId: arch-1"));
});

void test("a new list goes after the last earlier key and before the first later one", () => {
  const without = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
images: []
atmosphere: {music: pond.ogg}
start: {x: 16, y: 16}
`;
  const result = setScenePackPlacements(without, [lantern]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  equal(result.text, `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
images: []
placedPacks:
  - instanceId: lantern-1
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
atmosphere: {music: pond.ogg}
start: {x: 16, y: 16}
`);
});

void test("an invalid placement is refused and the document is not written", () => {
  const duplicate = setScenePackPlacements(SOURCE, [lantern, { ...arch, instanceId: "lantern-1" }]);
  ok(!duplicate.ok);
  equal(duplicate.problems[0]?.path, "placedPacks");
  const floor = setScenePackPlacements(SOURCE, [{ ...lantern, floor: "attic" }]);
  ok(!floor.ok);
  ok(floor.problems.some((problem) => problem.path === "placedPacks[0].floor"));
  const pack = setScenePackPlacements(SOURCE, [{ ...lantern, pack: "Packs/props.png" }]);
  ok(!pack.ok);
  ok(pack.problems.some((problem) => problem.path === "placedPacks[0].pack"));
  const reordered = setScenePackPlacements(withTwoText(), [arch, lantern]);
  ok(!reordered.ok);
  ok(reordered.problems[0]?.message.includes("order"));
});

void test("a flow list, a scalar list and a flow root are refused rather than reprinted", () => {
  const flow = setScenePackPlacements(SOURCE.replace(`placedPacks:
  - instanceId: lantern-1 # the lantern
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
`, "placedPacks: [{instanceId: lantern-1, pack: Packs/props.tkrpack, asset: lantern, floor: ground, x: 24, y: 40}]\n"), [lantern, arch]);
  ok(!flow.ok);
  ok(flow.problems[0]?.message.includes("flow"));
  const scalar = setScenePackPlacements(SOURCE.replace(`placedPacks:
  - instanceId: lantern-1 # the lantern
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
`, "placedPacks: 3\n"), [lantern]);
  ok(!scalar.ok);
  ok(scalar.problems[0]?.message.includes("a list"));
  const root = setScenePackPlacements("{contract: scene, version: 1.0.0-pre.2, projection: 2d, size: {width: 1, height: 1}, floors: [{id: ground}]}", [lantern]);
  ok(!root.ok);
  ok(root.problems[0]?.message.includes("block scene mapping"));
});

void test("a new record can lead the list, and a list with no later key appends at the end", () => {
  const leading = setScenePackPlacements(SOURCE, [arch, lantern]);
  ok(leading.ok, leading.ok ? "" : formatSceneProblems(leading.problems));
  ok(leading.text.indexOf("instanceId: arch-1") < leading.text.indexOf("instanceId: lantern-1"));
  ok(leading.text.includes("# the lantern"));
  const tail = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
`;
  const appended = setScenePackPlacements(tail, [lantern]);
  ok(appended.ok, appended.ok ? "" : formatSceneProblems(appended.problems));
  equal(appended.text, `${tail}placedPacks:
  - instanceId: lantern-1
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
`);
  const noop = setScenePackPlacements(appended.text, [lantern]);
  ok(noop.ok);
  equal(noop.text, appended.text);
});

void test("removal keeps the next record's own comment", () => {
  const text = withTwoText().replace("  - instanceId: arch-1", "  # about arch\n  - instanceId: arch-1");
  const removed = setScenePackPlacements(text, [arch]);
  ok(removed.ok, removed.ok ? "" : formatSceneProblems(removed.problems));
  ok(removed.text.includes("# about arch"));
  ok(!removed.text.includes("instanceId: lantern-1"));
});

void test("an edited placement list keeps Windows line endings", () => {
  const crlf = SOURCE.replaceAll("\n", "\r\n");
  const result = setScenePackPlacements(crlf, [lantern, arch]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  ok(result.text.includes("\r\n  - instanceId: arch-1\r\n"));
  ok(!/[^\r]\n/.test(result.text), "every newline keeps its carriage return");
});

function withTwoText(): string {
  const result = setScenePackPlacements(SOURCE, [lantern, arch]);
  ok(result.ok);
  return result.text;
}

function withTwo(source: string, body: (text: string) => void): void {
  const result = setScenePackPlacements(source, [lantern, arch]);
  ok(result.ok, result.ok ? "" : formatSceneProblems(result.problems));
  body(result.text);
}
