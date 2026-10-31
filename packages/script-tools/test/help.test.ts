import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  BATTLE_PLUGIN,
  CATALOGUE_PLUGIN,
  commandDocumentation,
  CORE_PLUGIN,
  MEDIA_PLUGIN,
  NATIVE_PACK_TABLE,
  type PluginDefinition,
  type ResolvedPlugin,
} from "@tk-reawakened/core";
import { helpFor, projectHelp } from "../src/index.ts";

/**
 * The help projection comes from `commandDocumentation()`, the one source the
 * command-docs gate validates (docs/spec/engine/rpgcode-tooling.md#tool-3), so a
 * hover, a call tip and the documentation site cannot disagree.
 */

const definitions: { readonly [id: string]: PluginDefinition } = {
  core: CORE_PLUGIN,
  media: MEDIA_PLUGIN,
  battle: BATTLE_PLUGIN,
  catalogue: CATALOGUE_PLUGIN,
  ...NATIVE_PACK_TABLE,
};

const plugins: ResolvedPlugin[] = [
  "core",
  "media",
  "battle",
  "catalogue",
  "gsmisc",
  "triuken",
  "filereadwrite",
  "proplug",
  "xfmwin",
  "kaimu",
  "twbutton",
].map((id) => ({ definition: definitions[id]! }));

test("the projection is the command documentation, one entry per name and alias", () => {
  const docs = commandDocumentation(plugins);
  const entries = projectHelp(plugins);
  equal(entries.length, docs.length);
  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index]!;
    deepEqual(entries[index], { ...doc, isAlias: doc.name !== doc.canonicalName });
  }
});

test("an alias entry points at its canonical command", () => {
  const alias = projectHelp(plugins).find((entry) => entry.isAlias);
  ok(alias, "the catalogue has at least one alias");
  equal(alias.canonicalName === alias.name, false);
  const again = helpFor(plugins, alias.name.toUpperCase());
  deepEqual(again, alias);
});

test("lookup folds the way RPGCode folds identifiers", () => {
  const entry = helpFor(plugins, "MWin");
  ok(entry, "mwin is registered");
  equal(entry.name, "mwin");
  equal(entry.canonicalName, "mwin");
  equal(entry.isAlias, false);
  equal(helpFor(plugins, "no-such-command"), null);
});
