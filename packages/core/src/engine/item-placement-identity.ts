import { boardItemSources } from "../sprites/model.ts";
import { itemKey } from "../sprites/runtime.ts";
import { ScriptError } from "../script/errors.ts";
import type { GameState } from "../save/state.ts";

/** Rebind repeated saved item identities to authored placements before a load is committed. */
export function reconcileItemPlacementIdentities(state: GameState): void {
  const board = state.world.board;
  if (board === null || board === undefined) return;
  const idsBySlot = new Map(boardItemSources(board).map((source) => [source.sourceSlot!, source.id]));
  type Placement = {
    item: GameState["sprites"]["items"][number];
    oldId: string;
    oldKey: string;
    canonicalId: string;
    nextId: string;
    nextKey: string;
    rekey: boolean;
  };
  const placements: Placement[] = state.sprites.items.map((item) => {
    const canonicalId = item.sourceSlot === null ? undefined : idsBySlot.get(item.sourceSlot);
    if (canonicalId === undefined) {
      throw new ScriptError("restore.item-identity", `item at source slot ${item.sourceSlot} has no authored placement`);
    }
    return {
      item,
      oldId: item.id,
      oldKey: itemKey(item),
      canonicalId,
      nextId: item.id,
      nextKey: itemKey(item),
      rekey: false,
    };
  });
  const keyCounts = new Map<string, number>();
  for (const placement of placements) {
    keyCounts.set(placement.oldId, (keyCounts.get(placement.oldId) ?? 0) + 1);
    if (placement.oldKey !== placement.oldId) {
      keyCounts.set(placement.oldKey, (keyCounts.get(placement.oldKey) ?? 0) + 1);
    }
  }
  const isSharedKey = (key: string): boolean => (keyCounts.get(key) ?? 0) > 1;
  let anyRekeyed = false;
  for (const placement of placements) {
    placement.rekey = isSharedKey(placement.oldId)
      || (placement.oldKey !== placement.oldId && isSharedKey(placement.oldKey));
    if (!placement.rekey) continue;
    anyRekeyed = true;
    placement.nextId = placement.canonicalId;
    placement.nextKey = placement.item.handle === null
      ? placement.nextId
      : `item:${placement.nextId === placement.item.source ? placement.item.source : placement.nextId}`;
  }
  const occupiedIds = new Set<string>();
  for (const placement of placements) {
    if (!placement.rekey) occupiedIds.add(placement.oldId);
  }
  for (const placement of placements) {
    if (!placement.rekey) continue;
    if (occupiedIds.has(placement.nextId)) {
      throw new ScriptError("restore.item-identity", `slot identity ${placement.nextId} collides with another saved item ID`);
    }
    occupiedIds.add(placement.nextId);
  }

  const placementOwnerByThread = new Map<number, { index: number; multiple: boolean }>();
  for (let index = 0; index < placements.length; index += 1) {
    const threadId = placements[index]!.item.multitaskThread;
    if (threadId === null) continue;
    const owner = placementOwnerByThread.get(threadId);
    if (owner === undefined) placementOwnerByThread.set(threadId, { index, multiple: false });
    else owner.multiple = true;
  }
  const threadsById = new Map(state.vm.threads.map((thread) => [thread.id, thread] as const));
  const linkedPlacementsByThread = new Map<number, number>();
  for (const [threadId, claim] of placementOwnerByThread) {
    const placement = placements[claim.index]!;
    if (!placement.rekey) continue;
    if (claim.multiple) {
      throw new ScriptError("restore.item-identity", `multiple placements claim item thread ${threadId}`);
    }
    const thread = threadsById.get(threadId);
    if (thread === undefined) continue;
    if (thread.kind !== "item") {
      throw new ScriptError("restore.item-identity", `placement at source slot ${placement.item.sourceSlot} links to a non-item thread`);
    }
    linkedPlacementsByThread.set(threadId, claim.index);
  }

  const threadUpdates = new Map<number, { source: string | null; target: string | null }>();
  for (const thread of state.vm.threads) {
    const ownerIndex = linkedPlacementsByThread.get(thread.id);
    const owner = ownerIndex === undefined ? undefined : placements[ownerIndex]!;
    const wait = thread.wait;
    if (wait?.kind === "movement") {
      for (const move of wait.moves) {
        if (isSharedKey(move.sprite)) {
          throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous movement wait for item placement ${move.sprite}`);
        }
      }
    } else if (wait?.kind === "sprite.movement" || wait?.kind === "sprite.stance") {
      if (isSharedKey(wait.actor)) {
        throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous ${wait.kind} wait for item placement ${wait.actor}`);
      }
    }
    if (thread.source !== null && isSharedKey(thread.source)
      && (owner === undefined || (thread.source !== owner.oldId && thread.source !== owner.oldKey))) {
      throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous item placement reference ${thread.source}`);
    }
    if (thread.target !== null && isSharedKey(thread.target)
      && (owner === undefined || (thread.target !== owner.oldId && thread.target !== owner.oldKey))) {
      throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous item placement reference ${thread.target}`);
    }
    for (const frame of thread.frames) {
      const restore = frame.programRoot?.restore;
      if (restore !== undefined && restore !== null
        && ((restore.source !== null && isSharedKey(restore.source))
          || (restore.target !== null && isSharedKey(restore.target)))) {
        throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous nested item placement reference`);
      }
    }
    if (owner === undefined) continue;
    const source = thread.source !== null && (thread.source === owner.oldId || thread.source === owner.oldKey)
      ? owner.nextKey
      : thread.source;
    const target = thread.target !== null && (thread.target === owner.oldId || thread.target === owner.oldKey)
      ? owner.nextKey
      : thread.target;
    if (source !== thread.source || target !== thread.target) threadUpdates.set(thread.id, { source, target });
  }

  for (const [threadId, update] of threadUpdates) {
    const thread = threadsById.get(threadId)!;
    thread.source = update.source;
    thread.target = update.target;
  }
  if (anyRekeyed) {
    state.sprites.items = placements.map((placement) =>
      placement.rekey ? { ...placement.item, id: placement.nextId } : placement.item,
    );
  }
}
