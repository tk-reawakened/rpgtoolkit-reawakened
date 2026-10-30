/**
 * Asset-aware equipment consistency for a recovery candidate
 * (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation,
 * docs/spec/engine/plugins-and-battle.md#e-82).
 *
 * Inventory equipment tuples are authoritative; an actor's equipment references
 * and bonuses are a derived projection. This check validates every tuple
 * against the current item and character definitions, derives the base
 * projection with the same pure rules the live `equip` operation uses, and
 * refuses a candidate whose saved projection disagrees.
 *
 * Pure and read-only (G2): no I/O, no mutation, no `applyEquipment` and no
 * behaviour hook. A projection customised by an `equipmentChanged` or stats hook
 * therefore fails closed; this check never resets saved progress or substitutes
 * defaults for missing assets.
 */
import type { ActorRecord, ActorsSection } from "../actors/model.ts";
import { deriveEquipmentBonuses } from "../actors/rules.ts";
import {
  ACCESSORY_SLOT_COUNT,
  BODY_SLOT_COUNT,
  EQUIP_BONUS_COUNT,
  EQUIP_SLOT_COUNT,
  type Character,
  type Item,
} from "../formats/actor/model.ts";
import { equipmentCatalog, slotLocation, validEquipmentSlot } from "../menu/equipment.ts";
import { validateInventorySection, type InventorySection, type StateIssue } from "../menu/model.ts";

/** The read-only item and character definition lookup, matching the inventory runtime shape. */
export type EquipmentAssetLookup = {
  readonly item: (source: string) => Item | undefined;
  readonly character: (source: string) => Character | undefined;
};

export type EquipmentCheckResult = { readonly ok: boolean; readonly error: StateIssue | null };

const ACCEPTED: EquipmentCheckResult = Object.freeze({ ok: true, error: null });

function reject(path: string, message: string): EquipmentCheckResult {
  return { ok: false, error: { path, message } };
}
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function itemDefinitionIssue(item: Item, path: string): StateIssue | null {
  if (typeof item.name !== "string" || item.name.length === 0) return { path, message: "item definition has no name" };
  if (!isInteger(item.equipable)) return { path, message: "item definition has no equipable flag" };
  if (!isInteger(item.usedBy)) return { path, message: "item definition has no usedBy flag" };
  if (!Array.isArray(item.allowedCharacters) || item.allowedCharacters.some((name) => typeof name !== "string")) return { path, message: "item definition has malformed allowed characters" };
  if (!Array.isArray(item.equipSlots) || item.equipSlots.length < EQUIP_SLOT_COUNT || !item.equipSlots.every(isInteger)) return { path, message: "item definition has malformed equipment slots" };
  if (typeof item.accessoryName !== "string") return { path, message: "item definition has no accessory name" };
  if (!Array.isArray(item.equipBonus) || item.equipBonus.length !== EQUIP_BONUS_COUNT || !item.equipBonus.every(isInteger)) return { path, message: "item definition has malformed equip bonuses" };
  return null;
}
function characterDefinitionIssue(character: Character, path: string): StateIssue | null {
  if (!Array.isArray(character.bodySlots) || character.bodySlots.length < BODY_SLOT_COUNT || !character.bodySlots.every(isInteger)) return { path, message: "character definition has malformed body slots" };
  if (!Array.isArray(character.accessorySlots) || character.accessorySlots.length < ACCESSORY_SLOT_COUNT || character.accessorySlots.some((name) => typeof name !== "string")) return { path, message: "character definition has malformed accessory slots" };
  return null;
}
function equipmentShapeIssue(actor: ActorRecord, path: string): StateIssue | null {
  const saved = actor.equipment as unknown;
  if (typeof saved !== "object" || saved === null) return { path, message: "saved equipment must be an object" };
  const equipment = saved as Record<string, unknown>;
  if (!Array.isArray(equipment.equipped) || equipment.equipped.some((reference) => typeof reference !== "string")) return { path: `${path}.equipped`, message: "saved equipment references must be strings" };
  const bonuses = equipment.bonuses;
  if (typeof bonuses !== "object" || bonuses === null) return { path: `${path}.bonuses`, message: "saved equipment bonuses must be an object" };
  const values = bonuses as Record<string, unknown>;
  for (const key of ["hp", "dp", "fp", "smp"]) {
    if (!isInteger(values[key])) return { path: `${path}.bonuses`, message: `saved equipment ${key} bonus must be a safe integer` };
  }
  return null;
}

/**
 * Validate a recovery candidate's equipment before it is accepted.
 *
 * The inventory section is validated first, so a tuple with an unknown actor,
 * an unknown or unavailable stack, or a duplicate actor slot is refused at the
 * section boundary. Each tuple then requires a recognised slot, a party actor,
 * available item and character definitions, and the slot/asset eligibility
 * rule; the `usedBy` name list is not consulted because `actor.name` is
 * script-writable progress. The derived references and bonuses must equal the
 * saved actor projection exactly, including order; a nonempty saved projection
 * with no inventory tuple is refused as unsafe rather than migrated or reset.
 */
export function checkEquipmentConsistency(
  inventory: InventorySection,
  actors: ActorsSection,
  assets: EquipmentAssetLookup,
): EquipmentCheckResult {
  const sectionIssue = validateInventorySection(inventory, actors);
  if (sectionIssue !== null) return { ok: false, error: sectionIssue };

  for (const [index, entry] of inventory.equipment.entries()) {
    const path = `inventory.equipment[${index}]`;
    const actor = actors.actors.find((candidate) => candidate.id === entry.actorId);
    if (actor === undefined) return reject(`${path}.actorId`, "expected a live actor id");
    if (actor.kind !== "party") return reject(`${path}.actorId`, "expected a live party actor");
    if (slotLocation(entry.slot) === null) return reject(`${path}.slot`, "unknown equipment slot");
    // E-81: quantity is the available (unequipped) count, so zero is valid while
    // an equipment tuple still references the stack. A referenced stack must exist.
    const stack = inventory.items.find((candidate) => candidate.id === entry.itemId);
    if (stack === undefined) return reject(`${path}.itemId`, "referenced inventory stack is missing");
    if (!isInteger(stack.quantity) || stack.quantity < 0) return reject(`${path}.itemId`, "referenced inventory stack has no available quantity");
    const item = assets.item(stack.source);
    if (item === undefined) return reject(`${path}.itemId`, `item definition is unavailable: ${stack.source}`);
    const itemIssue = itemDefinitionIssue(item, `${path}.itemId`);
    if (itemIssue !== null) return { ok: false, error: itemIssue };
    const character = assets.character(actor.source);
    if (character === undefined) return reject(`${path}.actorId`, `character definition is unavailable: ${actor.source}`);
    const characterIssue = characterDefinitionIssue(character, `${path}.actorId`);
    if (characterIssue !== null) return { ok: false, error: characterIssue };
    // Eligibility is slot- and asset-only: `actor.name` is script-writable progress, so a
    // rename after a valid equip must not refuse an otherwise consistent candidate.
    if (!validEquipmentSlot(entry.slot, item, character)) return reject(`${path}.slot`, "item is not eligible for this actor and slot");
  }

  for (const [index, actor] of actors.actors.entries()) {
    const path = `actors.actors[${index}].equipment`;
    const shapeIssue = equipmentShapeIssue(actor, path);
    if (shapeIssue !== null) return { ok: false, error: shapeIssue };
    const saved = actor.equipment;
    const assigned = inventory.equipment.some((entry) => entry.actorId === actor.id);
    if (!assigned) {
      if (saved.equipped.length > 0 || saved.bonuses.hp !== 0 || saved.bonuses.dp !== 0 || saved.bonuses.fp !== 0 || saved.bonuses.smp !== 0) {
        return reject(path, "saved actor equipment has no inventory assignment");
      }
      continue;
    }
    const catalog = equipmentCatalog(actor.id, inventory.equipment, inventory.items, assets.item);
    if (catalog === null) return reject(path, "an equipped item definition is unavailable");
    let derived: { readonly hp: number; readonly dp: number; readonly fp: number; readonly smp: number };
    try {
      derived = deriveEquipmentBonuses(catalog.catalog, catalog.equipped);
    } catch {
      return reject(path, "equipment bonuses cannot be derived from the available definitions");
    }
    if (saved.equipped.length !== catalog.equipped.length) return reject(`${path}.equipped`, "saved equipment references do not match the inventory assignments");
    for (const [position, reference] of saved.equipped.entries()) {
      if (reference !== catalog.equipped[position]) return reject(`${path}.equipped`, "saved equipment references do not match the inventory assignments");
    }
    if (saved.bonuses.hp !== derived.hp || saved.bonuses.dp !== derived.dp || saved.bonuses.fp !== derived.fp || saved.bonuses.smp !== derived.smp) {
      return reject(`${path}.bonuses`, "saved equipment bonuses do not match the derived bonuses");
    }
  }

  return ACCEPTED;
}
