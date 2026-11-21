import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { LineCounter, parseDocument } from "yaml";
import {
  checkDocuments,
  documentId,
  formatReport,
  REPORT_CLASSES,
  validateConfig,
  validatePluginData,
  type CheckConfig,
  type CheckReport,
  type DocumentInput,
  type Registry,
} from "../src/index.ts";

const TEST_REGISTRY: Registry = [
  { extension: ".tkranm", contract: "animation-clip" },
  { extension: ".tkract", contract: "actor" },
];
const config: CheckConfig = { registry: TEST_REGISTRY };
const shipped: CheckConfig = {};
const doc = (path: string, contract: string, ...lines: string[]): DocumentInput => ({
  path,
  text: [`contract: ${contract}`, "version: 1.0.0", ...lines, ""].join("\n"),
});
const check = (...documents: DocumentInput[]): CheckReport[] => checkDocuments(documents, config);

void test("valid flat plugin blocks are checked only at the envelope", () => {
  deepEqual(check(doc("clip.tkranm", "animation-clip", "delay: 0.15", "pluginData:", "  com.example.weather: # retained", "    version: 1.10.0", "    data: {wind: 3, future: 1.10}")), []);
});

void test("the checker reports each of the seven plugin block problem kinds", () => {
  const pluginKinds = (text: string): string[] =>
    checkDocuments([{ path: "clip.tkranm", text: `contract: animation-clip\nversion: 1.0.0\n${text}` }], shipped)
      .filter((report) => report.class === "plugin-block")
      .map((report) => report.kind);
  deepEqual(pluginKinds("pluginData: [one, two]\n"), ["container"]);
  deepEqual(pluginKinds("pluginData:\n  Com.Example.weather: {version: 1.0.0, data: {}}\n"), ["id"]);
  deepEqual(pluginKinds("pluginData:\n  com.example.weather: {version: 1.0.0, data: {}}\n  com.example.weather: {version: 1.0.0, data: {}}\n"), ["duplicate"]);
  deepEqual(pluginKinds("pluginData:\n  com.example.weather: {version: 1.0.0, data: {}, extra: true}\n"), ["shape"]);
  deepEqual(pluginKinds('pluginData:\n  com.example.weather: {version: "1.0", data: {}}\n'), ["version"]);
  deepEqual(pluginKinds("pluginData:\n  com.example.weather: {version: 1.0.0, data: [1, 2]}\n"), ["data"]);
  deepEqual(pluginKinds("outside: &shared {wind: 3}\npluginData:\n  com.example.weather:\n    version: 1.0.0\n    data: {value: *shared}\n"), ["boundary"]);
});

void test("anchors inside a plugin block cannot be referenced outside it", () => {
  const text = "contract: animation-clip\nversion: 1.0.0\npluginData:\n  com.example.weather:\n    version: 1.0.0\n    data: {value: &inside {wind: 3}}\noutside: *inside\n";
  deepEqual(checkDocuments([{ path: "clip.tkranm", text }], shipped).filter((report) => report.class === "plugin-block").map((report) => report.kind), ["boundary"]);
});

void test("reserved top-level and clip fields cannot be plugin ids", () => {
  const text = "contract: animation-clip\nversion: 1.0.0\npluginData:\n  delay: {version: 1.0.0, data: {}}\n";
  deepEqual(checkDocuments([{ path: "clip.tkranm", text }], shipped).filter((report) => report.class === "plugin-block").map((report) => report.kind), ["id"]);
});

void test("scene core fields cannot be used as plugin ids", () => {
  const text = "contract: scene\nversion: 1.0.0\npluginData:\n  size: {version: 1.0.0, data: {}}\n";
  deepEqual(checkDocuments([{ path: "map.tkrscn", text }], shipped).filter((report) => report.class === "plugin-block").map((report) => report.kind), ["id"]);
});

void test("scene checker reports invalid core fields", () => {
  const text = "contract: scene\nversion: 1.0.0-pre.2\nprojection: 2d\nsize: {width: 0, height: 1}\nfloors: [{id: ground}]\n";
  const reports = checkDocuments([{ path: "map.tkrscn", text }], shipped);
  equal(reports.some((report) => report.class === "native-scene" && report.field === "size.width"), true);
});

void test("an unresolved scene alias does not prevent checking other scenes", () => {
  const reports = checkDocuments([
    { path: "bad.tkrscn", text: "contract: scene\nversion: 1.0.0-pre.2\nprojection: 2d\nsize: {width: 1, height: 1}\nfloors: [{id: ground}]\ntitle: *missing\n" },
    { path: "other.tkrscn", text: "contract: scene\nversion: 1.0.0-pre.2\nprojection: 2d\nsize: {width: -1, height: 1}\nfloors: [{id: ground}]\n" },
  ], shipped);
  equal(reports.some((report) => report.class === "native-scene" && report.path === "bad.tkrscn" && report.message.includes("alias") && report.line === 6), true);
  equal(reports.some((report) => report.class === "native-scene" && report.path === "other.tkrscn" && report.field === "size.width"), true);
});

void test("the shared validator accepts the clip-consumable AST and line-counter interface", () => {
  const text = "pluginData: {com.example.weather: {version: 1.0.0, data: {unknown: true}}}\n";
  const lines = new LineCounter();
  const parsed = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  deepEqual(validatePluginData(parsed, text, lines, ["delay"]), []);
});

void test("plugin block reports carry all structured fields and format readably", () => {
  const text = 'contract: animation-clip\nversion: 1.0.0\npluginData:\n  com.example.weather: {version: "1.0", data: {}}\n';
  const [report] = checkDocuments([{ path: "clip.tkranm", text }], shipped);
  deepEqual(report, {
    class: "plugin-block",
    path: "clip.tkranm",
    kind: "version",
    pluginId: "com.example.weather",
    found: '"1.0"',
    reason: "patch is missing",
    line: 4,
  });
  equal(formatReport(report!), 'clip.tkranm:4: plugin block plugin `com.example.weather` `version`: patch is missing; found "\\"1.0\\""');
});

void test("document identity, report ordering, config validation and legacy exclusion remain", () => {
  equal(documentId("./clips//walk.tkranm"), "clips/walk.tkranm");
  deepEqual(REPORT_CLASSES, ["stamp", "duplicate-id", "fold-collision", "plugin-block", "extension-contract-mismatch", "native-art", "native-scene"]);
  throws(() => validateConfig({ documentExtensions: [] }), RangeError);
  throws(() => validateConfig({ documentExtensions: [""] }), RangeError);
  throws(() => validateConfig({ registry: [{ extension: ".anm", contract: "animation" }] }), RangeError);
  deepEqual(checkDocuments([{ path: "legacy.anm", text: "pluginData: [bad]\n" }], shipped), []);
});

void test("duplicate IDs and case-folded collisions remain distinct", () => {
  deepEqual(checkDocuments([doc("walk.tkranm", "animation-clip"), doc("walk.tkranm", "animation-clip")], shipped), [
    { class: "duplicate-id", id: "walk.tkranm", paths: ["walk.tkranm", "walk.tkranm"] },
  ]);
  deepEqual(checkDocuments([doc("Walk.tkranm", "animation-clip"), doc("walk.tkranm", "animation-clip")], shipped), [
    { class: "fold-collision", foldedId: "walk.tkranm", paths: ["Walk.tkranm", "walk.tkranm"] },
  ]);
});

void test("extension and contract mismatch is reported without checking unregistered files", () => {
  const mismatch = check(doc("walk.tkranm", "actor"));
  deepEqual(mismatch.map((report) => report.class), ["extension-contract-mismatch"]);
  equal(formatReport(mismatch[0]!), "walk.tkranm: the extension `.tkranm` is registered for the contract `animation-clip`, but the stamp names `actor`. Either the extension or the stamp is wrong; the checker cannot tell which.");
  deepEqual(checkDocuments([{ path: "walk.tkrxyz", text: "invalid: [\n" }], shipped), []);
});

