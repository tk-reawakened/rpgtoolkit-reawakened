// Epic 8.6 integrated shop, gold, party, and Inn coverage (#595).
// Contracts: docs/spec/engine/rpgcode-functions.md#e-83 and #e-84;
// docs/spec/engine/plugins-and-battle.md#e-83 and #e-85.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyItem,
  IR_VERSION,
  STOCK_RPG_PLUGIN,
  writeItem,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { authoredGame, bootHost, catalogue as menuCatalogue, repoRoot, type HostGame } from "./stock-menu-rig.ts";

const shopPackage = (() => {
  const path = join(repoRoot, "stock", "stock_rpg");
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as {
    name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string;
  };
  return { manifest, source: readFileSync(join(path, manifest.program), "utf8") };
})();
const stock = ["item/stock-potion.itm", "item/stock-tonic.itm"] as const;
const catalogue: readonly PackageCatalogueEntry[] = [
  ...menuCatalogue(),
  { name: shopPackage.manifest.name, version: shopPackage.manifest.version, namespace: shopPackage.manifest.namespace,
    requests: shopPackage.manifest.requests, definition: STOCK_RPG_PLUGIN,
    startup: { kind: "inline", text: shopPackage.source, ir: IR_VERSION, dialect: "tk3" } },
];

function gameWithShopItems(): HostGame {
  const base = authoredGame({ allies: 1, startup: "end()\n" });
  const files = new Map(base.files);
  const itemDefinitions = [
    ["stock-potion.itm", "Stock Potion", 10, 5],
    ["stock-tonic.itm", "Stock Tonic", 20, 8],
  ] as const;
  const itemPaths = itemDefinitions.map(([filename]) => assetKey(`Item/${filename}`));
  for (const [filename, name, buyPrice, sellPrice] of itemDefinitions) {
    const bytes = writeItem({ ...createEmptyItem(), minor: 4, movementAnimations: Array(8).fill(""), name,
      description: name, buyPrice, sellPrice, menuUsable: 1 });
    if (!bytes.ok) throw new Error(bytes.error.message);
    files.set(assetKey(`item/${filename}`), bytes.value);
  }
  return { ...base, files, index: createAssetIndex([...base.index.paths, ...itemPaths]) };
}

test("full-engine CallShop resolves stock then real owner buy/sell and party swap actions affect state and gold", () => {
  // Full-engine duration is intentional: a focused owner test cannot prove RPGCode filename resolution,
  // host-served item bytes, a parked CallShop stock payload, and owner actions while that live context exists.
  // The scenario stays minimal (two listed items, one buy and one sale) to avoid replaying unrelated engine behavior.
  let ownerActionsApplied = false;
  const session = bootHost({ game: gameWithShopItems(), catalogue, width: 320, height: 240,
    startup: 'givegp(100)\naddplayer("ally1.tem")\ncallshop("stock-potion", "stock-tonic.itm")\n',
    phaseRegistrations: [{ phase: "events", run: (state, postEffect) => {
      const waiter = state.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
      if (ownerActionsApplied || waiter === undefined || postEffect === undefined) return;
      ownerActionsApplied = true;
      const post = (section: "inventory" | "party" | "menu", action: Record<string, string | number>): void => {
        postEffect(section, {
          name: "state",
          kind: "state-write",
          args: [action],
          thread: waiter.id,
          out: {},
          result: null,
          patch: { section, path: [], op: "merge", value: null },
          wait: null,
          request: null,
        });
      };
      post("inventory", { type: "buyItem", source: stock[0], amount: 2 });
      const bought = state.inventory.items.find((item) => item.source === stock[0]);
      if (bought === undefined) throw new Error("inventory owner did not commit the shop buy");
      post("inventory", { type: "sellItem", entryId: bought.id, amount: 1 });
      const [firstActorId, secondActorId] = state.party.members;
      if (firstActorId === undefined || secondActorId === undefined) throw new Error("party fixture needs two members");
      post("party", { type: "swap", firstActorId, secondActorId });
      // Closing through the menu owner releases the real CallShop waiter on the next waits phase.
      post("menu", { type: "shop.close" });
    } }] });
  const state = session.pump((current) => current.vm.threads.every((thread) => thread.wait?.kind !== "menu.screen" || thread.wait.id !== "callshop"));
  const waiter = state.vm.effects;
  ok(session.requests.filter((request) => request === "asset").length >= 2, "both item definitions were loaded by the headless host");
  equal(ownerActionsApplied, true, "the live CallShop stock context reached the owner-dispatch phase");
  equal(state.inventory.gold, 85, "buy debits 20 GP and sale credits 5 GP through inventory owner");
  equal(state.inventory.items.find((item) => item.source === stock[0])?.quantity, 1, "two bought units, one sold unit remain");
  deepEqual(state.party.members, [2, 1], "party owner swaps the two actor IDs without copying actor state");
  ok(waiter.some((effect) => effect.name === "state" && effect.kind === "state-write"), "owner actions were recorded through the normal effect bus");
  equal(state.menu.screens.length, 0);
});

test("RPGCode Inn restores active party members including fallen members without charging gold", () => {
  const session = bootHost({ game: authoredGame({ allies: 1, startup: "end()\n" }), catalogue, width: 320, height: 240,
    startup: 'givegp(37)\naddplayer("ally1.tem")\nhp("Hero", 0)\ninn()\n' });
  const state = session.pump((current) => current.vm.threads.every((thread) => thread.status === "finished" || thread.kind !== "blocking"));
  equal(state.inventory.gold, 37);
  equal(state.party.members.length, 2);
  for (const id of state.party.members) {
    const actor = state.actors.actors.find((candidate) => candidate.id === id);
    ok(actor, `party actor ${id} exists`);
    equal(actor.stats.hp, actor.stats.maxHp);
    equal(actor.stats.smp, actor.stats.maxSmp);
  }
  deepEqual(session.diagnostics, []);
});
