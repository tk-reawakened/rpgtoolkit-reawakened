import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINE_DEFAULT_MANIFEST,
  type PluginDefinition,
} from "@tk-reawakened/core";
import { resolvePluginManifest } from "../src/index.ts";

const CORE: PluginDefinition = { id: "core", version: "1", commands: [] };
const CATALOGUE: PluginDefinition = { id: "catalogue", version: "1", commands: [] };
const GAME: PluginDefinition = { id: "game", version: "1", commands: [] };

test("host resolver maps ids to definitions and preserves manifest order and options", () => {
  const result = resolvePluginManifest([
    { id: "core" },
    { id: "game", options: { timeout: 4 } },
    { id: "catalogue" },
  ], { core: CORE, catalogue: CATALOGUE, game: GAME }, "game/main");
  deepEqual(result.plugins.map((item) => item.definition.id), ["core", "game", "catalogue"]);
  deepEqual(result.plugins[1]?.options, { timeout: 4 });
  equal(result.diagnostics.length, 0);
});

test("disabled and unresolved ids do not stop the remaining layers", () => {
  const base = [{ id: "core" }, { id: "catalogue" }] as const;
  const result = resolvePluginManifest([
    ...base,
    { id: "disabled", enabled: false },
    { id: "missing" },
    { id: "game" },
  ], { core: CORE, catalogue: CATALOGUE, game: GAME });
  deepEqual(result.plugins.map((item) => item.definition.id), ["core", "catalogue", "game"]);
  equal(result.diagnostics.length, 1);
  equal(result.diagnostics[0]?.code, "plugin.unresolved");
  equal(result.diagnostics[0]?.index, 3);
});

test("duplicate ids produce a located diagnostic and only one definition", () => {
  const result = resolvePluginManifest([{ id: "core" }, { id: "core" }], { core: CORE });
  equal(result.plugins.length, 1);
  deepEqual(result.diagnostics, [{
    code: "manifest.duplicate-id",
    path: "manifest",
    index: 1,
    message: 'duplicate plugin id "core"',
  }]);
});

test("a package resolves like a native entry; a missing or other-version package is a located diagnostic", () => {
  const pkg: PluginDefinition = { id: "pkg_a", version: "2.0", commands: [] };
  const result = resolvePluginManifest([
    { id: "core" },
    { id: "pkg_a", version: "2.0", requests: ["asset"] },
    { id: "pkg_b", version: "1" },
    { id: "pkg_a2", version: "9" },
  ], { core: CORE, pkg_a: pkg, pkg_a2: pkg });
  deepEqual(result.plugins.map((item) => item.definition.id), ["core", "pkg_a"]);
  deepEqual(result.diagnostics.map((d) => [d.code, d.index]), [["plugin.unresolved", 2], ["plugin.version-mismatch", 3]]);
});

test("a package entry resolves with its namespace (declared, else its name); a native entry has none", () => {
  const named: PluginDefinition = { id: "pkg_a", version: "1", commands: [] };
  const declared: PluginDefinition = { id: "pkg_b", version: "1", commands: [] };
  const result = resolvePluginManifest([
    { id: "core" },
    { id: "pkg_a", version: "1" },
    { id: "pkg_b", version: "1", namespace: "Bee" },
  ], { core: CORE, pkg_a: named, pkg_b: declared });
  deepEqual(result.plugins.map((item) => item.namespace), [undefined, "pkg_a", "Bee"]);
});

test("a reserved id is unresolved in the harness, and inherited members are never a definition", () => {
  // Both a plain table (which inherits Object.prototype) and a null-prototype one must treat
  // `constructor`, `__proto__` and `toString` as unknown ids (#537).
  for (const table of [{ core: CORE } as Record<string, PluginDefinition>, Object.assign(Object.create(null) as Record<string, PluginDefinition>, { core: CORE })]) {
    for (const id of ["constructor", "__proto__", "toString"]) {
      const result = resolvePluginManifest([{ id: "core" }, { id }], table);
      deepEqual(result.plugins.map((item) => item.definition.id), ["core"], `${id}: only core resolves`);
      equal(result.diagnostics.length, 1, `${id}: one diagnostic`);
      equal(result.diagnostics[0]?.code, "plugin.unresolved", `${id}: unresolved`);
      equal(result.diagnostics[0]?.index, 1, `${id}: located at its entry`);
    }
  }
});

test("a reserved id never breaks the duplicate check for ordinary ids", () => {
  const result = resolvePluginManifest([{ id: "constructor" }, { id: "constructor" }, { id: "core" }, { id: "core" }], { core: CORE });
  equal(result.plugins.length, 1);
  deepEqual(result.diagnostics.map((item) => [item.code, item.index]), [
    ["plugin.unresolved", 0],
    ["manifest.duplicate-id", 1],
    ["manifest.duplicate-id", 3],
  ]);
});
