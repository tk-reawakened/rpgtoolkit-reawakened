import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  applyPluginManifestPatch,
  assembleCommands,
  ENGINE_DEFAULT_MANIFEST,
  ENGINE_PLUGIN_TABLE,
  HOST_REQUEST_KINDS,
  isPackageManifestEntry,
  listPackageDeclarations,
  parsePluginManifest,
  type BuiltinSpec,
  type Logger,
} from "../src/index.ts";

const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function command(name: string, call: BuiltinSpec["call"]): BuiltinSpec {
  return { name, aliases: [], params: [], call };
}

test("the default manifest is core and catalogue followed by owner/native packs", () => {
  deepEqual(ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id), [
    "core",
    "media",
    "battle",
    "catalogue",
    "world",
    "render",
    "gsmisc",
    "triuken",
    "filereadwrite",
    "proplug",
    "xfmwin",
    "kaimu",
    "twbutton",
  ]);
});

test("the one engine table holds exactly the default manifest's ids, each under its own id", () => {
  deepEqual(Object.keys(ENGINE_PLUGIN_TABLE), ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id));
  for (const [id, definition] of Object.entries(ENGINE_PLUGIN_TABLE)) equal(definition.id, id);
});

test("manifest patch applies append, disable, replace and remove by id", () => {
  const base = [{ id: "core" }, { id: "catalogue" }] as const;
  const result = applyPluginManifestPatch(base, [
    { op: "append", entry: { id: "game", options: { timeout: 3 } } },
    { op: "replace", id: "game", entry: { id: "game.v2", enabled: true } },
    { op: "disable", id: "catalogue" },
    { op: "remove", id: "game.v2" },
  ], "game.tkr/plugins");
  deepEqual(result.manifest, [{ id: "core" }, { id: "catalogue", enabled: false }]);
  equal(result.diagnostics.length, 0);
});

test("reorder must retain every id and cannot move the pinned core layer", () => {
  const base = [{ id: "core" }, { id: "catalogue" }] as const;
  const valid = applyPluginManifestPatch(base, [
    { op: "append", entry: { id: "game" } },
    { op: "reorder", ids: ["core", "game", "catalogue"] },
  ]);
  deepEqual(valid.manifest.map((entry) => entry.id), ["core", "game", "catalogue"]);
  const invalid = applyPluginManifestPatch(base, [
    { op: "reorder", ids: ["catalogue", "core"] },
  ], "main/plugins");
  deepEqual(invalid.manifest, base);
  equal(invalid.diagnostics[0]?.code, "manifest.core-pinned");
  equal(invalid.diagnostics[0]?.path, "main/plugins");
  equal(invalid.diagnostics[0]?.index, 0);
});

test("remove, disable and replace of core are refused with located diagnostics", () => {
  const result = applyPluginManifestPatch(ENGINE_DEFAULT_MANIFEST, [
    { op: "remove", id: "core" },
    { op: "disable", id: "core" },
    { op: "replace", id: "core", entry: { id: "other" } },
  ]);
  deepEqual(result.manifest, ENGINE_DEFAULT_MANIFEST);
  deepEqual(result.diagnostics.map((item) => item.code), [
    "manifest.core-pinned",
    "manifest.core-pinned",
    "manifest.core-pinned",
  ]);
});

test("unknown and duplicate ids are diagnosed without ambiguous assembly", () => {
  const result = applyPluginManifestPatch(ENGINE_DEFAULT_MANIFEST, [
    { op: "remove", id: "missing" },
    { op: "append", entry: { id: "catalogue" } },
    { op: "reorder", ids: ["core", "catalogue", "catalogue"] },
  ]);
  deepEqual(result.manifest, ENGINE_DEFAULT_MANIFEST);
  equal(result.diagnostics.length >= 3, true);
});

test("manifest parser rejects unknown fields and non-plain options at their entry", () => {
  const parsed = parsePluginManifest([
    { id: "one", unexpected: true },
    { id: "two", options: { value: undefined } },
  ], "project/main");
  equal(parsed.manifest, null);
  deepEqual(parsed.diagnostics.map((item) => [item.code, item.index, item.path]), [
    ["manifest.unknown-field", 0, "project/main"],
    ["manifest.options", 1, "project/main"],
  ]);
});

test("resolved layer options are injected only into the owning command view", () => {
  let seen: unknown;
  const base = command("probe", (view) => {
    seen = view.options;
    return { value: "base" };
  });
  const registry = assembleCommands([
    { definition: { id: "core", version: "1", commands: [base] } },
    { definition: { id: "game", version: "1", commands: [] }, options: { speed: 2 } },
  ], logger);
  const resolved = registry.get("probe")!;
  resolved.spec.call({ rng: { nextUint32: () => 0 }, clock: { tick: () => 0 } }, [], resolved.next);
  equal(seen, undefined);

  const configured = assembleCommands([
    { definition: { id: "core", version: "1", commands: [base] }, options: { core: true } },
  ], logger).get("probe")!;
  configured.spec.call({ rng: { nextUint32: () => 0 }, clock: { tick: () => 0 } }, [], configured.next);
  deepEqual(seen, { core: true });
});

test("a package entry parses with name, version, default namespace and declared requests", () => {
  const result = parsePluginManifest([
    { id: "core" },
    { id: "stock-battle", version: "1.2.0", requests: ["saveBlob", "playVideo"] },
    { id: "extras", version: "0.1", namespace: "extras-alt" },
  ]);
  deepEqual(result.diagnostics, []);
  deepEqual(listPackageDeclarations(result.manifest!), [
    { name: "stock-battle", version: "1.2.0", namespace: "stock-battle", requests: ["saveBlob", "playVideo"], enabled: true },
    { name: "extras", version: "0.1", namespace: "extras-alt", requests: [], enabled: true },
  ]);
  equal(isPackageManifestEntry(result.manifest![0]!), false);
});

test("reserved lower-case package IDs remain valid manifest names", () => {
  const result = parsePluginManifest([
    { id: "core" },
    { id: "constructor", version: "1" },
    { id: "core-tools", version: "1" },
    { id: "stock_battle", version: "1", namespace: "stock_battle" },
  ]);
  deepEqual(result.diagnostics, []);
  deepEqual(result.manifest?.map((entry) => entry.id), ["core", "constructor", "core-tools", "stock_battle"]);
});

test("package fields are validated with located diagnostics", () => {
  const cases: readonly [unknown, string][] = [
    [{ id: "p", version: "" }, "manifest.version"],
    [{ id: "p", version: 3 }, "manifest.version"],
    [{ id: "Stock", version: "1" }, "manifest.package-name"],
    [{ id: "p", version: "1", namespace: "Stock" }, "manifest.namespace"],
    [{ id: "p", version: "1", requests: "saveBlob" }, "manifest.requests"],
    [{ id: "p", version: "1", requests: ["teleport"] }, "manifest.request-kind"],
    [{ id: "p", version: "1", requests: ["quit", "quit"] }, "manifest.request-kind"],
    [{ id: "p", namespace: "x" }, "manifest.package-version"],
    [{ id: "p", requests: [] }, "manifest.package-version"],
  ];
  for (const [entry, code] of cases) {
    const result = parsePluginManifest([{ id: "core" }, entry]);
    equal(result.manifest, null);
    deepEqual(result.diagnostics.map((d) => [d.code, d.index]), [[code, 1]], code);
  }
});

test("a duplicate namespace is a located diagnostic", () => {
  const result = parsePluginManifest([
    { id: "core" },
    { id: "alpha-pack", version: "1" },
    { id: "beta-pack", version: "1", namespace: "alpha-pack" },
  ]);
  equal(result.manifest, null);
  deepEqual(result.diagnostics.map((d) => [d.code, d.index]), [["manifest.duplicate-namespace", 2]]);
});

test("package entries patch and order exactly like native entries", () => {
  const base = parsePluginManifest([{ id: "core" }, { id: "catalogue" }]).manifest!;
  const result = applyPluginManifestPatch(base, [
    { op: "append", entry: { id: "pkg-a", version: "1", requests: ["asset"] } },
    { op: "append", entry: { id: "pkg-b", version: "2" } },
    { op: "reorder", ids: ["core", "pkg-b", "catalogue", "pkg-a"] },
    { op: "disable", id: "pkg-b" },
  ]);
  deepEqual(result.diagnostics, []);
  deepEqual(result.manifest.map((e) => e.id), ["core", "pkg-b", "catalogue", "pkg-a"]);
  deepEqual(listPackageDeclarations(result.manifest).map((d) => [d.name, d.enabled]), [["pkg-b", false], ["pkg-a", true]]);
  const clash = applyPluginManifestPatch(result.manifest, [
    { op: "append", entry: { id: "pkg-c", version: "1", namespace: "pkg-a" } },
    { op: "replace", id: "pkg-b", entry: { id: "pkg-b", version: "3", namespace: "pkg-a" } },
  ]);
  deepEqual(clash.diagnostics.map((d) => [d.code, d.index]), [["manifest.duplicate-namespace", 0], ["manifest.duplicate-namespace", 1]]);
  deepEqual(clash.manifest, result.manifest);
});

test("every runner request kind is declarable", () => {
  deepEqual([...HOST_REQUEST_KINDS].sort(), ["asset", "extension.call", "listBlobs", "loadBlob", "openUrl", "playVideo", "quit", "saveBlob"]);
});
