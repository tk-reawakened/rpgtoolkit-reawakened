import type { Value } from "../../ports/value.ts";
import { assetKey } from "../../formats/resolver/resolver.ts";
import { BinaryReader } from "../../formats/binary/reader.ts";
import { readItem } from "../../formats/actor/item.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandEffect, CommandResult, CommandView, PluginDefinition } from "../plugin.ts";

const INVENTORY_GROUP = "items-inventory-shop-gold-28";
const ITEM_NAMES = ["giveitem", "takeitem", "itemcount", "givegp", "takegp", "getgp", "equip", "remove"] as const;

type ItemOperation = "addItem" | "removeItem";

function integer(args: readonly Arg[], index: number): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : Number.NaN;
}
function text(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}
function output(args: readonly Arg[], index: number, value: Value): readonly (readonly [number, Value])[] {
  return args[index] === undefined || args[index]?.ref === null ? [] : [[index, value]];
}
function menuAction(view: CommandView, action: object): CommandResult {
  if (view.state === undefined) return { value: null };
  return { value: null, effects: [{ kind: "state-write", section: "inventory", args: [action as never] }] };
}
function docs(summary: string, behaviour: string): BuiltinDoc {
  return { summary, behaviour, groups: [INVENTORY_GROUP], tags: ["legacy"], waits: { kind: "never", summary: "Does not wait." } };
}
function itemFilename(value: string): string {
  const filename = value.trim().replaceAll("\\", "/");
  return filename.toLowerCase().endsWith(".itm") ? filename : `${filename}.itm`;
}
function itemSource(filename: string): string {
  const relative = filename.replace(/^item\//i, "");
  return assetKey(`item/${relative}`);
}
type AssetTarget = { readonly area: "items" | "characters"; readonly path: string };
function equipmentAssets(view: CommandView, actorId: number, entryId?: number, includeActor = true): AssetTarget[] {
  const state = view.state;
  if (state === undefined) return [];
  const targets: AssetTarget[] = [];
  for (const equipment of state.inventory.equipment) {
    if (equipment.actorId !== actorId) continue;
    const item = state.inventory.items.find((candidate) => candidate.id === equipment.itemId);
    if (item !== undefined) targets.push({ area: "items", path: item.source.replace(/^item\//, "") });
  }
  if (entryId !== undefined) {
    const item = state.inventory.items.find((candidate) => candidate.id === entryId);
    if (item !== undefined) targets.push({ area: "items", path: item.source.replace(/^item\//, "") });
  }
  const actor = state.actors.actors.find((candidate) => candidate.id === actorId);
  if (includeActor && actor !== undefined) targets.push({ area: "characters", path: actor.source });
  return [...new Map(targets.map((target) => [`${target.area}:${target.path.toLowerCase()}`, target])).values()];
}
function equipmentRequest(
  operation: "equip" | "unequip",
  actorId: number,
  slot: string,
  entryId: number,
  targets: readonly AssetTarget[],
): CommandResult {
  const [target, ...remaining] = targets;
  if (target === undefined) return { value: null };
  return {
    value: null,
    request: { kind: "asset", ...target },
    then: { command: "__inventory_equipment_asset", args: [operation, actorId, slot, entryId, JSON.stringify(remaining)] },
  };
}
function itemRequest(operation: ItemOperation, filename: string): CommandResult {
  const path = itemFilename(filename);
  return {
    value: null,
    request: { kind: "asset", area: "items", path },
    then: { command: "__inventory_item_asset", args: [operation, path] },
  };
}
function shopRequest(paths: readonly string[], index = 0, sources: readonly string[] = []): CommandResult {
  const path = paths[index];
  if (path === undefined) throw new ScriptError("menu.shop-invalid", "shop stock requires at least one item filename");
  return {
    value: null,
    request: { kind: "asset", area: "items", path },
    then: { command: "__inventory_shop_asset", args: [path, JSON.stringify(paths), JSON.stringify(sources)] },
  };
}
function jsonStrings(value: string, label: string): string[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new ScriptError("request.bad-reply", `${label} must be a JSON string list`);
  }
  if (!Array.isArray(decoded) || !decoded.every((entry) => typeof entry === "string")) {
    throw new ScriptError("request.bad-reply", `${label} must be a JSON string list`);
  }
  return decoded;
}
function partyActor(view: CommandView, handle: unknown): number | undefined {
  const state = view.state;
  if (state === undefined) return undefined;
  const members = new Set(state.party.members);
  const value = String(handle);
  return state.actors.actors.find((candidate) => members.has(candidate.id) &&
    (String(candidate.id) === value || candidate.name.toLowerCase() === value.toLowerCase() || candidate.source.toLowerCase() === value.toLowerCase()))?.id;
}
function slotAt(location: number): string {
  const clamped = Math.min(16, Math.max(1, location));
  switch (clamped) {
    case 1: return "head";
    case 2: return "neck";
    case 3: return "right-hand";
    case 4: return "left-hand";
    case 5: return "body";
    case 6: return "legs";
    default: return `accessory-${clamped}`;
  }
}
function params(names: readonly { name: string; optional?: boolean; byRef?: boolean }[]): BuiltinSpec["params"] {
  return names.map(({ name, optional = false, byRef = false }) => ({ name, optional, byRef, variadic: false }));
}

const GIVE_ITEM: BuiltinSpec = {
  name: "giveitem", aliases: [], params: params([{ name: "itm" }]),
  doc: docs("Add one item from an item file to the inventory.", "Resolves the supplied filename (appending .itm when absent), then adds one unit through the inventory owner."),
  call: (_view, args) => itemRequest("addItem", text(args, 0)),
};
const TAKE_ITEM: BuiltinSpec = {
  name: "takeitem", aliases: [], params: params([{ name: "itm" }]),
  doc: docs("Remove one available item from the inventory by item filename.", "Resolves the supplied filename (appending .itm when absent), then removes one available unit through the inventory owner; keyItem does not restrict this script built-in."),
  call: (_view, args) => itemRequest("removeItem", text(args, 0)),
};
const GIVE_GOLD: BuiltinSpec = {
  name: "givegp", aliases: [], params: params([{ name: "gp" }]),
  doc: docs("Add gold through the inventory owner.", "A non-negative safe integer is accepted; zero is a no-op, and invalid or overflowing additions are refused atomically."),
  call: (view, args) => menuAction(view, { type: "addGold", amount: integer(args, 0) }),
};
const TAKE_GOLD: BuiltinSpec = {
  name: "takegp", aliases: [], params: params([{ name: "gp" }]),
  doc: docs("Remove gold through the inventory owner.", "A non-negative safe integer is accepted; zero is a no-op, and invalid or unaffordable removals are refused atomically."),
  call: (view, args) => menuAction(view, { type: "removeGold", amount: integer(args, 0) }),
};
const GET_GOLD: BuiltinSpec = {
  name: "getgp", aliases: [], params: params([{ name: "ret", optional: true, byRef: true }]),
  doc: docs("Read current inventory gold.", "Returns the current gold balance and writes it to the optional by-reference output."),
  call: (view, args) => {
    const gold = view.state?.inventory.gold ?? 0;
    return { value: gold, out: output(args, 0, gold) };
  },
};
const ITEM_COUNT: BuiltinSpec = {
  name: "itemcount", aliases: [], params: params([{ name: "fileName" }, { name: "ret", optional: true, byRef: true }]),
  doc: docs("Count available inventory items by filename or handle.", "An argument ending in .itm compares filenames case-insensitively; otherwise it compares item handles case-insensitively. The result is available quantity."),
  call: (view, args) => {
    const query = text(args, 0).replaceAll("\\", "/").toLowerCase();
    const byFilename = query.endsWith(".itm");
    const wanted = byFilename ? query.replace(/^item\//, "") : query;
    let count = 0;
    for (const entry of view.state?.inventory.items ?? []) {
      const candidate = byFilename ? entry.source.toLowerCase().replace(/^item\//, "") : entry.handle.toLowerCase();
      if (candidate !== wanted) continue;
      count += entry.quantity;
      if (!Number.isSafeInteger(count)) throw new ScriptError("inventory.count-range", "item count exceeds the safe-integer range");
    }
    return { value: count, out: output(args, 1, count) };
  },
};
const EQUIP: BuiltinSpec = {
  name: "equip", aliases: [], params: params([{ name: "handle" }, { name: "location" }, { name: "item" }]),
  doc: docs("Equip one available item on a party member.", "Resolves handle as a party member handle or character filename, clamps the 1-based location to 1–16, resolves the item filename, and applies inventory and actor equipment operations atomically."),
  call: (view, args) => {
    const actorId = partyActor(view, args[0]?.value);
    if (actorId === undefined) return { value: null };
    const query = text(args, 2);
    const fromHandle = view.state?.inventory.items.find((entry) => entry.handle.toLowerCase() === query.toLowerCase());
    const source = fromHandle?.source ?? itemSource(itemFilename(query));
    const entry = view.state?.inventory.items.find((candidate) => candidate.source === source);
    if (entry === undefined) return { value: null };
    return equipmentRequest("equip", actorId, slotAt(integer(args, 1)), entry.id, equipmentAssets(view, actorId, entry.id));
  },
};
const REMOVE: BuiltinSpec = {
  name: "remove", aliases: [], params: params([{ name: "handle" }, { name: "location" }]),
  doc: docs("Unequip an item from a party member.", "Resolves handle as a party member handle or character filename and clamps the 1-based location to 1–16 before returning the item to available inventory."),
  call: (view, args) => {
    const actorId = partyActor(view, args[0]?.value);
    if (actorId === undefined) return { value: null };
    const slot = slotAt(integer(args, 1));
    const equipped = view.state?.inventory.equipment.some((entry) => entry.actorId === actorId && entry.slot === slot);
    if (!equipped) return menuAction(view, { type: "unequip", actorId, slot });
    return equipmentRequest("unequip", actorId, slot, 0, equipmentAssets(view, actorId, undefined, false));
  },
};
const EQUIPMENT_ASSET_CONTINUATION: BuiltinSpec = {
  name: "__inventory_equipment_asset", aliases: [],
  params: params([{ name: "ok" }, { name: "bytes" }, { name: "operation" }, { name: "actorId" }, { name: "slot" }, { name: "entryId" }, { name: "remaining" }]),
  doc: { ...docs("Resume an equipment asset request.", "Loads item and character definitions before applying an inventory equipment operation."), access: "internal" },
  call: (view, args) => {
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", "equipment asset not found");
    const operation = text(args, 2);
    if (operation !== "equip" && operation !== "unequip") throw new ScriptError("inventory.operation", "unknown equipment operation");
    const actorId = integer(args, 3);
    const slot = text(args, 4);
    const entryId = integer(args, 5);
    let rawRemaining: unknown;
    try {
      rawRemaining = JSON.parse(text(args, 6));
    } catch {
      throw new ScriptError("request.bad-reply", "equipment asset queue must be valid JSON");
    }
    if (!Array.isArray(rawRemaining)) throw new ScriptError("request.bad-reply", "equipment asset queue must be an array");
    const remaining: AssetTarget[] = [];
    for (const value of rawRemaining) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ScriptError("request.bad-reply", "equipment asset queue entry must be an object");
      const target = value as Record<string, unknown>;
      if ((target.area !== "items" && target.area !== "characters") || typeof target.path !== "string") {
        throw new ScriptError("request.bad-reply", "equipment asset queue entry is malformed");
      }
      remaining.push({ area: target.area, path: target.path });
    }
    if (remaining.length > 0) return equipmentRequest(operation, actorId, slot, entryId, remaining);
    return operation === "equip"
      ? menuAction(view, { type: "equip", actorId, slot, entryId })
      : menuAction(view, { type: "unequip", actorId, slot });
  },
};
const ITEM_ASSET_CONTINUATION: BuiltinSpec = {
  name: "__inventory_item_asset", aliases: [], params: params([{ name: "ok" }, { name: "bytes" }, { name: "operation" }, { name: "file" }]),
  doc: { ...docs("Resume an inventory item asset request.", "Parses the item definition and sends a typed operation through the inventory owner."), access: "internal" },
  call: (view, args) => {
    const operation = text(args, 2);
    if (operation !== "addItem" && operation !== "removeItem") throw new ScriptError("inventory.operation", "unknown item operation");
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", `inventory item asset not found: ${text(args, 3)}`);
    const hex = text(args, 1);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "item asset reply must be hexadecimal bytes");
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    const parsed = readItem(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
    const filename = text(args, 3);
    const source = itemSource(filename);
    const inventory = view.state?.inventory;
    const entry = inventory?.items.find((candidate) => candidate.source.toLowerCase() === source);
    if (operation === "removeItem") {
      if (entry === undefined) return { value: null };
      return menuAction(view, { type: "removeItem", entryId: entry.id, amount: 1 });
    }
    return menuAction(view, { type: "addItem", source, handle: parsed.value.name, amount: 1 });
  },
};

const CALL_SHOP: BuiltinSpec = {
  name: "callshop", aliases: [],
  params: [{ name: "item", optional: false, byRef: false, variadic: true }],
  doc: docs("Run a blocking shop session with the listed items.", "Resolves every filename relative to Item (appending .itm when absent) before activating any stock; then yields to the menu owner until it closes the session. The menu owns screen presentation."),
  call: (_view, args) => {
    if (args.length === 0) throw new ScriptError("menu.shop-invalid", "CallShop requires at least one item filename");
    return shopRequest(args.map((arg) => itemFilename(String(arg.value))));
  },
};
const SHOP_ASSET_CONTINUATION: BuiltinSpec = {
  name: "__inventory_shop_asset", aliases: [],
  params: params([{ name: "ok" }, { name: "bytes" }, { name: "file" }, { name: "paths" }, { name: "sources" }]),
  doc: { ...docs("Resume a shop item request.", "Parses every stock item before committing the active shop context, then waits until the shop closes."), access: "internal" },
  call: (_view, args) => {
    const path = text(args, 2);
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", `shop item asset not found: ${path}`);
    const hex = text(args, 1);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "shop item reply must be hexadecimal bytes");
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    const parsed = readItem(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
    const paths = jsonStrings(text(args, 3), "shop paths");
    const sources = [...jsonStrings(text(args, 4), "shop sources"), itemSource(path)];
    if (paths.length === 0 || paths[sources.length - 1] !== path) throw new ScriptError("request.bad-reply", "shop request sequence is inconsistent");
    if (sources.length < paths.length) return shopRequest(paths, sources.length, sources);
    return {
      value: null,
      effects: [{ kind: "state-write", section: "menu", args: [{ type: "shop.open", sources }] }],
      wait: { kind: "menu.screen", global: true, id: "callshop", payload: [sources], resumeRefs: [] },
    };
  },
};
const INN: BuiltinSpec = {
  name: "inn", aliases: [], params: [],
  doc: { ...docs("Fully heal the player party.", "Sets every party member's current HP and SMP to their maxima immediately, including fallen members; it does not change status effects, equipment, inventory, roster or gold."), groups: [INVENTORY_GROUP, "battle-stats-menus-33"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "party", args: [{ type: "inn" }] }] }),
};
export const INVENTORY_COMMANDS: readonly BuiltinSpec[] = [GIVE_ITEM, TAKE_ITEM, ITEM_COUNT, GIVE_GOLD, TAKE_GOLD, GET_GOLD, EQUIP, REMOVE, EQUIPMENT_ASSET_CONTINUATION, ITEM_ASSET_CONTINUATION, CALL_SHOP, SHOP_ASSET_CONTINUATION, INN];
export const INVENTORY_COMMAND_NAMES = new Set<string>([...ITEM_NAMES, "inn", "callshop", "__inventory_item_asset", "__inventory_equipment_asset", "__inventory_shop_asset"]);
export const INVENTORY_PLUGIN: PluginDefinition = { id: "inventory", version: "1.0.0", commands: INVENTORY_COMMANDS };
