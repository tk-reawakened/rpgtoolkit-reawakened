/**
 * Performance budget for the canonical size of a booted game's `vm` section (docs/adr/0035-performance-budgets.md).
 * Budgets count work, never time: the byte length of `canon(state.vm)` is the same on every machine.
 *
 * The game is the `demo` sample's shape: the bundled `stock_menu` and `stock_battle` packages, whose inline start-up
 * programs define most of the functions a live callable names after boot. Before #2767, `vm.defOwners` held each of
 * those programs' full source once per definition (151 copies, about 14.6 MB in the demo); now `vm.programs` holds each
 * program once and `vm.defOwners` maps each definition to its key.
 */

import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { TextEncoder } from "node:util";
import { assetKey, BinaryReader, canon, IR_VERSION, readMainFile, writeMainFile, type PackageCatalogueEntry } from "../src/index.ts";
import { authoredGame, bootHost, repoRoot, unwrap } from "./stock-menu-rig.ts";

/**
 * Budget: the canonical `vm` section of the booted stock-package game is at most this many bytes. It is the two
 * bundled programs' text (about 188 KB together) stored once, plus the small owner map, globals and threads, with
 * about a third more as headroom for package growth. Each extra copy of a program would add 76 KB or more, so a regression to
 * one copy per definition (about 11 MB here) fails at once.
 */
const VM_CANON_BYTES_BUDGET = 300 * 1024;

function stockEntry(folder: string): PackageCatalogueEntry {
  const root = join(repoRoot, "stock", folder);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return {
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(root, manifest.program), "utf8"), ir: IR_VERSION, dialect: "tk3" },
  };
}

test("budget: a booted game's vm section stores each bundled package program once, however many definitions it owns", () => {
  const game = authoredGame({ startup: "end()\n" });
  const mainKey = assetKey(game.main);
  const main = unwrap(readMainFile(new BinaryReader(game.files.get(mainKey)!)));
  game.files.set(mainKey, unwrap(writeMainFile({ ...main, packagePlugins: ["stock_menu", "stock_battle"] })));
  const session = bootHost({ game, catalogue: [stockEntry("stock_menu"), stockEntry("stock_battle")], width: 320, height: 240, startup: "end()\n" });
  const vm = session.state().vm;

  const definitions = Object.keys(vm.defOwners ?? {}).length;
  const programs = Object.keys(vm.programs ?? {}).length;
  ok(definitions >= 100, `the fixture is large enough to matter (${definitions} owned definitions)`);
  ok(programs === 2, `each bundled package program is stored once (${programs} programs for ${definitions} definitions)`);
  const bytes = new TextEncoder().encode(canon(vm as never)).length;
  ok(bytes <= VM_CANON_BYTES_BUDGET, `the vm section is ${bytes} canonical bytes; budget ${VM_CANON_BYTES_BUDGET}`);
});
