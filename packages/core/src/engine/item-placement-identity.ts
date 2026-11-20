import { boardItemSources } from "../sprites/model.ts";
import { itemKey } from "../sprites/runtime.ts";
import { ScriptError } from "../script/errors.ts";
import type { GameState } from "../save/state.ts";

/** Rebind saved item identities to authored placements before a load is committed. */
export function reconcileItemPlacementIdentities(state: GameState): void {
  const board = state.world.board;
  if (board === null || board === undefined) return;
  const idsBySlot = new Map(boardItemSources(board).map((source) => [source.sourceSlot!, source.id]));
  const previousKeys = new Map<string, number>();
  const linkedThreads = new Set<number>();
  for (const item of state.sprites.items) {
    const key = itemKey(item);
    previousKeys.set(key, (previousKeys.get(key) ?? 0) + 1);
  }
  for (const item of state.sprites.items) {
    const id = item.sourceSlot === null ? undefined : idsBySlot.get(item.sourceSlot);
    if (id === undefined) {
      throw new ScriptError("restore.item-identity", `item at source slot ${item.sourceSlot} has no authored placement`);
    }
  }
  for (const item of state.sprites.items) {
    const oldKey = itemKey(item);
    if ((previousKeys.get(oldKey) ?? 0) < 2) continue;
    const threadId = item.multitaskThread;
    if (threadId === null) continue;
    if (linkedThreads.has(threadId)) {
      throw new ScriptError("restore.item-identity", `multiple placements claim item thread ${threadId}`);
    }
    const thread = state.vm.threads.find((entry) => entry.id === threadId);
    if (thread === undefined) continue;
    if (thread.kind !== "item") {
      throw new ScriptError("restore.item-identity", `placement at source slot ${item.sourceSlot} links to a non-item thread`);
    }
    linkedThreads.add(threadId);
    const id = idsBySlot.get(item.sourceSlot!);
    if (id === undefined) throw new ScriptError("restore.item-identity", `item at source slot ${item.sourceSlot} has no authored placement`);
    const nextKey = `item:${id === item.source ? item.source : id}`;
    if (thread.source === oldKey) thread.source = nextKey;
    if (thread.target === oldKey) thread.target = nextKey;
  }
  for (const [oldKey, count] of previousKeys) {
    if (count < 2) continue;
    for (const thread of state.vm.threads) {
      if (thread.frames.some((frame) => frame.programRoot?.restore?.source === oldKey || frame.programRoot?.restore?.target === oldKey)) {
        throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous nested item placement reference`);
      }
      if (thread.source !== oldKey && thread.target !== oldKey) continue;
      if (!linkedThreads.has(thread.id)) {
        throw new ScriptError("restore.item-identity", `thread ${thread.id} has an ambiguous item placement reference`);
      }
    }
  }
  state.sprites.items = state.sprites.items.map((item) => {
    const id = item.sourceSlot === null ? undefined : idsBySlot.get(item.sourceSlot);
    return id === undefined || item.id === id ? item : { ...item, id };
  });
}
