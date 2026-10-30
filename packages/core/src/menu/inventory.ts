import type { ActorsSection } from "../actors/model.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import type { EquipmentItemDefinition } from "../actors/rules.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import { equipmentCatalog, slotLocation, validEquipment } from "./equipment.ts";
import {
  validateActionFields,
  validateInventorySection,
  type InventoryEquipment,
  type InventoryItem,
  type InventorySection,
  type MenuStateResult,
  type StateIssue,
} from "./model.ts";

export type InventoryAction =
  | { readonly type: "addItem"; readonly source: string; readonly handle: string; readonly amount: number }
  | { readonly type: "removeItem"; readonly entryId: number; readonly amount: number }
  | { readonly type: "consumeBattleItem"; readonly item: string; readonly target: number; readonly handle: string | null }
  | { readonly type: "equip"; readonly actorId: number; readonly slot: string; readonly entryId: number }
  | { readonly type: "unequip"; readonly actorId: number; readonly slot: string }
  | { readonly type: "buyItem"; readonly source: string; readonly amount: number }
  | { readonly type: "sellItem"; readonly entryId: number; readonly amount: number }
  | { readonly type: "addGold"; readonly amount: number }
  | { readonly type: "removeGold"; readonly amount: number };

export type InventoryEvent =
  | { readonly type: "itemAdded" | "itemRemoved"; readonly detail: { readonly entryId: number; readonly source: string; readonly handle: string; readonly amount: number; readonly previousQuantity: number; readonly currentQuantity: number } }
  | { readonly type: "goldChanged"; readonly detail: { readonly previous: number; readonly current: number; readonly delta: number } };

export type InventoryRuntime = {
  readonly item: (source: string) => Item | undefined;
  readonly character: (source: string) => Character | undefined;
  readonly applyEquipment: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) => boolean;
  readonly shopStock?: () => readonly string[];
  readonly setShopStock?: (sources: readonly string[]) => boolean | void;
  readonly closeShop?: () => void;
};

const ACCEPTED: MenuStateResult = Object.freeze({ ok: true, error: null });
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function rejected(path: string, message: string): MenuStateResult {
  return { ok: false, error: { path, message } };
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function safeAmount(value: unknown, allowZero = false): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
}
function exactAction(recordValue: Record<string, unknown>, keys: readonly string[]): StateIssue | null {
  return validateActionFields(recordValue, keys, "inventory.action");
}

/** Apply one inventory action atomically; event details describe committed available-quantity changes. */
export function applyInventoryAction(
  state: { inventory: InventorySection; actors: ActorsSection },
  value: unknown,
  runtime: InventoryRuntime | undefined,
): { readonly result: MenuStateResult; readonly events: readonly InventoryEvent[] } {
  const action = record(value);
  if (action === null) return { result: rejected("inventory.action", "expected an action object"), events: [] };
  const current = state.inventory;
  let next: InventorySection = current;
  let event: InventoryEvent | null = null;
  let actorOperation: { readonly actorId: number; readonly equipment: readonly InventoryEquipment[] } | null = null;
  let keys: readonly string[];
  let trailingEvent: InventoryEvent | null = null;

  switch (action.type) {
    case "buyItem": {
      keys = ["type", "source", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.amount) || typeof action.source !== "string") return { result: rejected("inventory.action", "expected item source and positive safe integer amount"), events: [] };
      const source = assetKey(`item/${action.source.replaceAll("\\", "/").replace(/^item\//i, "")}`);
      if (!(runtime?.shopStock?.() ?? []).includes(source)) return { result: rejected("shop.stock", "item is not in the active shop stock"), events: [] };
      const definition = runtime?.item(source);
      if (definition === undefined) return { result: rejected("inventory.action.asset", "item definition is unavailable"), events: [] };
      if (!Number.isSafeInteger(definition.buyPrice) || definition.buyPrice < 0) return { result: rejected("inventory.action.price", "buy price must be a non-negative safe integer"), events: [] };
      const cost = definition.buyPrice * action.amount;
      if (!Number.isSafeInteger(cost)) return { result: rejected("inventory.gold", "trade total exceeds the safe-integer range"), events: [] };
      if (cost > current.gold) return { result: rejected("inventory.gold", "insufficient gold"), events: [] };
      const old = current.items.find((entry) => entry.source === source && entry.handle === definition.name);
      const previousQuantity = old?.quantity ?? 0;
      const currentQuantity = previousQuantity + action.amount;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      let item: InventoryItem;
      if (old === undefined) {
        if (!safeAmount(current.nextId) || current.nextId === MAX_SAFE) return { result: rejected("inventory.nextId", "item identity counter is exhausted"), events: [] };
        item = { id: current.nextId, source, handle: definition.name, quantity: currentQuantity };
        next = { ...current, nextId: current.nextId + 1, items: [...current.items, item] };
      } else {
        item = old;
        next = { ...current, items: current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry) };
      }
      next = { ...next, gold: current.gold - cost };
      event = { type: "itemAdded", detail: { entryId: item.id, source, handle: item.handle, amount: action.amount, previousQuantity, currentQuantity } };
      if (cost > 0) trailingEvent = { type: "goldChanged", detail: { previous: current.gold, current: next.gold, delta: -cost } };
      break;
    }
    case "sellItem": {
      keys = ["type", "entryId", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.entryId) || !safeAmount(action.amount)) return { result: rejected("inventory.action", "expected positive entry id and amount"), events: [] };
      if ((runtime?.shopStock?.().length ?? 0) === 0) return { result: rejected("shop.stock", "selling requires an active shop"), events: [] };
      const old = current.items.find((entry) => entry.id === action.entryId);
      if (old === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (old.quantity < action.amount) return { result: rejected("inventory.items.quantity", "insufficient available quantity"), events: [] };
      const definition = runtime?.item(old.source);
      if (definition === undefined) return { result: rejected("inventory.action.asset", "item definition is unavailable"), events: [] };
      if (!Number.isSafeInteger(definition.sellPrice) || definition.sellPrice < 0) return { result: rejected("inventory.action.price", "sell price must be a non-negative safe integer"), events: [] };
      const proceeds = definition.sellPrice * action.amount;
      const gold = current.gold + proceeds;
      if (!Number.isSafeInteger(proceeds) || !Number.isSafeInteger(gold)) return { result: rejected("inventory.gold", "trade total exceeds the safe-integer range"), events: [] };
      const currentQuantity = old.quantity - action.amount;
      const retained = currentQuantity !== 0 || current.equipment.some((entry) => entry.itemId === old.id);
      next = { ...current, gold, items: retained
        ? current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry)
        : current.items.filter((entry) => entry.id !== old.id) };
      event = { type: "itemRemoved", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity: old.quantity, currentQuantity } };
      if (proceeds > 0) trailingEvent = { type: "goldChanged", detail: { previous: current.gold, current: gold, delta: proceeds } };
      break;
    }
    case "addItem": {
      keys = ["type", "source", "handle", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (typeof action.source !== "string" || !action.source.toLowerCase().endsWith(".itm")) return { result: rejected("inventory.action.source", "expected an .itm asset reference"), events: [] };
      const relativeSource = action.source.replaceAll("\\", "/").replace(/^item\//i, "");
      const source = assetKey(`item/${relativeSource}`);
      if (typeof action.handle !== "string") return { result: rejected("inventory.action.handle", "expected an item handle"), events: [] };
      if (!safeAmount(action.amount)) return { result: rejected("inventory.action.amount", "expected a positive safe integer"), events: [] };
      const old = current.items.find((entry) => entry.source === source && entry.handle === action.handle);
      const previousQuantity = old?.quantity ?? 0;
      const currentQuantity = previousQuantity + action.amount;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      if (old === undefined) {
        if (!safeAmount(current.nextId) || current.nextId === MAX_SAFE) return { result: rejected("inventory.nextId", "item identity counter is exhausted"), events: [] };
        const item: InventoryItem = { id: current.nextId, source, handle: action.handle, quantity: currentQuantity };
        next = { ...current, nextId: current.nextId + 1, items: [...current.items, item] };
        event = { type: "itemAdded", detail: { entryId: item.id, source: item.source, handle: item.handle, amount: action.amount, previousQuantity, currentQuantity } };
      } else {
        next = { ...current, items: current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry) };
        event = { type: "itemAdded", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity, currentQuantity } };
      }
      break;
    }
    case "consumeBattleItem": {
      keys = ["type", "item", "target", "handle"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (typeof action.item !== "string" || action.item.trim() === "") {
        return { result: rejected("inventory.consume.item", "expected an item asset source"), events: [] };
      }
      if (!safeAmount(action.target)) {
        return { result: rejected("inventory.consume.target", "expected a positive actor id"), events: [] };
      }
      const relative = action.item.replaceAll("\\", "/").replace(/^item\//i, "");
      if (!relative.toLowerCase().endsWith(".itm")) {
        return { result: rejected("inventory.consume.item", "expected an .itm asset source"), events: [] };
      }
      const source = assetKey(`item/${relative}`);
      const definition = runtime?.item(source);
      if (definition === undefined) {
        return { result: rejected("inventory.consume.item", "item definition is unavailable"), events: [] };
      }
      if (!state.actors.actors.some((actor) => actor.id === action.target)) {
        return { result: rejected("inventory.consume.target", "target actor is unavailable"), events: [] };
      }
      if (action.handle !== null && (typeof action.handle !== "string" || action.handle === "")) {
        return { result: rejected("inventory.consume.handle", "expected null or a non-empty stack handle"), events: [] };
      }
      const sourceEntries = current.items.filter((entry) => entry.source === source);
      // A named stack is exact: never fall back to the canonical or sole stack of the source.
      const entry = action.handle !== null
        ? sourceEntries.find((candidate) => candidate.handle === action.handle)
        : sourceEntries.find((candidate) => candidate.handle === definition.name) ?? (sourceEntries.length === 1 ? sourceEntries[0] : undefined);
      if (entry === undefined) {
        return {
          result: rejected("inventory.consume.entry", action.handle !== null
            ? "no inventory stack matches the item source and handle"
            : sourceEntries.length === 0
              ? "no inventory stack matches the item source"
              : "item source matches multiple non-canonical inventory stacks"),
          events: [],
        };
      }
      return applyInventoryAction(state, { type: "removeItem", entryId: entry.id, amount: 1 }, runtime);
    }
    case "removeItem": {
      keys = ["type", "entryId", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.entryId) || !safeAmount(action.amount)) return { result: rejected("inventory.action", "expected a positive entry id and amount"), events: [] };
      const old = current.items.find((entry) => entry.id === action.entryId);
      if (old === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (old.quantity < action.amount) return { result: rejected("inventory.items.quantity", "insufficient available quantity"), events: [] };
      const currentQuantity = old.quantity - action.amount;
      const retained = currentQuantity !== 0 || current.equipment.some((entry) => entry.itemId === old.id);
      next = { ...current, items: retained
        ? current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry)
        : current.items.filter((entry) => entry.id !== old.id) };
      event = { type: "itemRemoved", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity: old.quantity, currentQuantity } };
      break;
    }
    case "equip": {
      keys = ["type", "actorId", "slot", "entryId"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.actorId) || typeof action.slot !== "string" || !safeAmount(action.entryId)) return { result: rejected("inventory.action", "expected actor, slot, and entry identities"), events: [] };
      const actor = state.actors.actors.find((candidate) => candidate.id === action.actorId);
      const entry = current.items.find((candidate) => candidate.id === action.entryId);
      const slot = action.slot;
      if (actor === undefined || actor.kind !== "party") return { result: rejected("inventory.action.actorId", "expected a live party actor"), events: [] };
      if (entry === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (entry.quantity < 1) return { result: rejected("inventory.items.quantity", "no available item to equip"), events: [] };
      if (current.equipment.some((candidate) => candidate.actorId === actor.id && candidate.slot === slot)) return { result: rejected("inventory.action.slot", "actor slot is already occupied"), events: [] };
      if (runtime === undefined) return { result: rejected("inventory.action.asset", "item and character definitions are unavailable"), events: [] };
      const item = runtime.item(entry.source);
      const character = runtime.character(actor.source);
      if (item === undefined || character === undefined) return { result: rejected("inventory.action.asset", "item or character definition is not available"), events: [] };
      if (!validEquipment(actor, slot, item, character)) return { result: rejected("inventory.action.eligibility", "item is not eligible for this actor and slot"), events: [] };
      const previousQuantity = entry.quantity;
      const currentQuantity = previousQuantity - 1;
      const equipment = [...current.equipment, { actorId: actor.id, slot, itemId: entry.id }];
      const retained = currentQuantity !== 0 || equipment.some((candidate) => candidate.itemId === entry.id);
      next = { ...current,
        items: retained ? current.items.map((candidate) => candidate.id === entry.id ? { ...candidate, quantity: currentQuantity } : candidate) : current.items.filter((candidate) => candidate.id !== entry.id),
        equipment,
      };
      actorOperation = { actorId: actor.id, equipment };
      event = { type: "itemRemoved", detail: { entryId: entry.id, source: entry.source, handle: entry.handle, amount: 1, previousQuantity, currentQuantity } };
      break;
    }
    case "unequip": {
      keys = ["type", "actorId", "slot"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.actorId) || typeof action.slot !== "string") return { result: rejected("inventory.action", "expected actor and slot identities"), events: [] };
      if (slotLocation(action.slot) === null) return { result: rejected("inventory.action.slot", "unknown equipment slot"), events: [] };
      const actor = state.actors.actors.find((candidate) => candidate.id === action.actorId);
      if (actor === undefined || actor.kind !== "party") return { result: rejected("inventory.action.actorId", "expected a live party actor"), events: [] };
      const oldEquipment = current.equipment.find((candidate) => candidate.actorId === actor.id && candidate.slot === action.slot);
      if (oldEquipment === undefined) return { result: { ok: true, error: null }, events: [] };
      if (runtime === undefined) return { result: rejected("inventory.action.asset", "item definitions are unavailable"), events: [] };
      const itemEntry = current.items.find((candidate) => candidate.id === oldEquipment.itemId);
      if (itemEntry === undefined) return { result: rejected("inventory.equipment.itemId", "equipped item entry is missing"), events: [] };
      const currentQuantity = itemEntry.quantity + 1;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      const equipment = current.equipment.filter((candidate) => candidate !== oldEquipment);
      next = { ...current,
        items: current.items.map((candidate) => candidate.id === itemEntry.id ? { ...candidate, quantity: currentQuantity } : candidate),
        equipment,
      };
      actorOperation = { actorId: actor.id, equipment };
      event = { type: "itemAdded", detail: { entryId: itemEntry.id, source: itemEntry.source, handle: itemEntry.handle, amount: 1, previousQuantity: itemEntry.quantity, currentQuantity } };
      break;
    }
    case "addGold":
    case "removeGold": {
      keys = ["type", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.amount, true)) return { result: rejected("inventory.action.amount", "expected a non-negative safe integer"), events: [] };
      if (action.amount === 0) return { result: ACCEPTED, events: [] };
      const currentGold = action.type === "addGold" ? current.gold + action.amount : current.gold - action.amount;
      if (!Number.isSafeInteger(currentGold) || currentGold < 0) return { result: rejected("inventory.gold", "gold operation exceeds available safe-integer bounds"), events: [] };
      next = { ...current, gold: currentGold };
      event = { type: "goldChanged", detail: { previous: current.gold, current: currentGold, delta: currentGold - current.gold } };
      break;
    }
    default:
      return { result: rejected("inventory.action.type", "unknown inventory action"), events: [] };
  }

  const validation = validateInventorySection(next, state.actors);
  if (validation !== null) return { result: { ok: false, error: validation }, events: [] };
  if (actorOperation !== null) {
    if (runtime === undefined) return { result: rejected("inventory.action.asset", "item definitions are unavailable"), events: [] };
    const catalog = equipmentCatalog(actorOperation.actorId, actorOperation.equipment, next.items, runtime.item);
    if (catalog === null) return { result: rejected("inventory.equipment", "an equipped item definition is not available"), events: [] };
    try {
      if (!runtime.applyEquipment(actorOperation.actorId, catalog.equipped, catalog.catalog)) {
        return { result: rejected("inventory.equipment", "actor equipment operation refused"), events: [] };
      }
    } catch {
      return { result: rejected("inventory.equipment", "actor equipment operation refused"), events: [] };
    }
  }
  state.inventory = next;
  return { result: ACCEPTED, events: event === null ? [] : trailingEvent === null ? [event] : [event, trailingEvent] };
}
