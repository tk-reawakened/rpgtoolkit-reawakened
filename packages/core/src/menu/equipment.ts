/**
 * The pure equipment derivation shared by the inventory owner and the save
 * equipment consistency check (docs/spec/engine/plugins-and-battle.md#e-82).
 *
 * A saved `(actorId, slot, itemId)` tuple derives an actor-scoped opaque
 * reference and the actor catalog entry built from the current `.itm`
 * definition. Nothing here mutates state, applies a bonus to an actor or runs a
 * behaviour hook.
 */
import type { ActorRecord } from "../actors/model.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import type { EquipmentItemDefinition } from "../actors/rules.ts";
import type { InventoryEquipment, InventoryItem } from "./model.ts";

/** The six standard body slots as canonical save tokens (E-82). */
const STANDARD_SLOTS: Readonly<Record<string, number>> = {
  head: 1,
  neck: 2,
  "right-hand": 3,
  "left-hand": 4,
  body: 5,
  legs: 6,
};

/** The trans3 location for a canonical slot token, or null when it is unknown. */
export function slotLocation(slot: string): number | null {
  const standard = STANDARD_SLOTS[slot];
  if (standard !== undefined) return standard;
  const match = /^accessory-(\d{1,2})$/.exec(slot);
  if (match === null) return null;
  const location = Number(match[1]);
  return location >= 7 && location <= 16 ? location : null;
}

/** The deterministic actor-scoped reference a saved tuple derives (E-82). */
export function equippedReference(actorId: number, slot: string, itemId: number): string {
  return `tkr-equipment:${JSON.stringify([actorId, slot, itemId])}`;
}

/**
 * Derive one actor's equipped references and catalog from its inventory tuples
 * and the current item definitions, disambiguating deterministically against
 * the finite catalog (E-82). Returns null when an equipped definition is
 * unavailable.
 */
export function equipmentCatalog(
  actorId: number,
  equipment: readonly InventoryEquipment[],
  items: readonly InventoryItem[],
  itemForSource: (source: string) => Item | undefined,
): { readonly equipped: string[]; readonly catalog: EquipmentItemDefinition[] } | null {
  const entries = equipment.filter((entry) => entry.actorId === actorId);
  const names: string[] = [];
  const definitions: Array<{ entry: InventoryEquipment; item: Item }> = [];
  for (const entry of entries) {
    const stack = items.find((candidate) => candidate.id === entry.itemId);
    const item = stack === undefined ? undefined : itemForSource(stack.source);
    if (item === undefined) return null;
    names.push(item.name);
    definitions.push({ entry, item });
  }
  const used = new Set(names);
  const equipped: string[] = [];
  const catalog: EquipmentItemDefinition[] = [];
  for (const { entry, item } of definitions) {
    const base = equippedReference(actorId, entry.slot, entry.itemId);
    let id = base;
    let suffix = 0;
    while (used.has(id)) {
      suffix += 1;
      id = `${base}#${suffix}`;
    }
    used.add(id);
    equipped.push(id);
    catalog.push({ name: item.name, id, equipBonus: item.equipBonus });
  }
  return { equipped, catalog };
}

/** The pure eligibility rule the `equip` operation enforces (E-82). */
export function validEquipment(
  actor: ActorRecord,
  slot: string,
  item: Item,
  character: Character,
): boolean {
  const location = slotLocation(slot);
  if (location === null || item.equipable !== 1) return false;
  const names = item.allowedCharacters.filter((name) => name !== "");
  if (item.usedBy === 1 && !names.includes(actor.name)) return false;
  const slotIndex = location === 3 ? 4 : location === 4 ? 3 : location;
  const slotFlag = location <= 6 ? item.equipSlots[slotIndex] : item.equipSlots[7];
  if (slotFlag !== 1) return false;
  if (location <= 6 && character.bodySlots[slotIndex] !== 1) return false;
  if (location >= 7) {
    const characterSlot = character.accessorySlots[location - 6];
    return characterSlot !== undefined && characterSlot !== "" && characterSlot === item.accessoryName;
  }
  return true;
}
