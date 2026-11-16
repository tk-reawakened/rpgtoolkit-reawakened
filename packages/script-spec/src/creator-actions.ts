import type { ActionInput, InputRecord } from "@tk-reawakened/core";

const BUILT_IN_ACTIONS = new Set(["up", "down", "left", "right", "confirm", "cancel", "menu"]);

export class SpecActionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "SpecActionError";
    this.code = code;
  }
}

export type CreatorAction = {
  readonly ordinal: number;
  readonly action: string;
  readonly source: string;
  readonly requestedAt: number;
  readonly pressAt: number;
  readonly releaseAt: number;
  readonly completedAt: number | null;
};

export type CreatorActionSnapshot = {
  readonly nextOrdinal: number;
  readonly actions: readonly CreatorAction[];
  readonly pending: readonly InputRecord[];
};

/** Host-side action schedule and report state; intentionally separate from the engine's canonical state. */
export type CreatorActionScheduler = {
  readonly actions: readonly CreatorAction[];
  schedule(action: string, ticks: number, currentTick: number, registeredActions: readonly string[]): CreatorAction;
  takeInputs(tick: number): readonly InputRecord[];
  completeTick(tick: number): void;
  snapshot(): CreatorActionSnapshot;
};

const folded = (value: string): string => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

function validAction(action: string, registeredActions: readonly string[]): boolean {
  const key = folded(action);
  return BUILT_IN_ACTIONS.has(key) || registeredActions.some((registered) => folded(registered) === key);
}

function edge(action: string, down: boolean, source: string): ActionInput {
  return { kind: "action", action, down, source, modalId: null };
}

/** Create one independent claim per call and schedule its press/release on future whole-tick boundaries. */
export function createCreatorActionScheduler(initial?: CreatorActionSnapshot): CreatorActionScheduler {
  let nextOrdinal = initial?.nextOrdinal ?? 1;
  const actions: CreatorAction[] = initial?.actions.map((action) => ({ ...action })) ?? [];
  const pending: InputRecord[] = initial?.pending.map((record) => ({ tick: record.tick, event: { ...record.event } })) ?? [];

  return {
    get actions() {
      return actions.map((action) => ({ ...action }));
    },
    schedule(action, ticks, currentTick, registeredActions) {
      if (!validAction(action, registeredActions)) {
        throw new SpecActionError("spec.bad-action", `specAction: "${action}" is not a built-in or registered game action`);
      }
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 1000) {
        throw new SpecActionError("spec.bad-ticks", "specAction: ticks must be a whole number from 1 to 1,000");
      }
      if (!Number.isSafeInteger(currentTick) || currentTick < 0 || currentTick > Number.MAX_SAFE_INTEGER - ticks - 1) {
        throw new SpecActionError("spec.bad-ticks", "specAction: the requested tick range is invalid");
      }

      const ordinal = nextOrdinal++;
      const source = `spec.action:${ordinal}`;
      const pressAt = currentTick + 1;
      const releaseAt = pressAt + ticks;
      const scheduled: CreatorAction = { ordinal, action, source, requestedAt: currentTick, pressAt, releaseAt, completedAt: null };
      actions.push(scheduled);
      pending.push({ tick: pressAt, event: edge(action, true, source) }, { tick: releaseAt, event: edge(action, false, source) });
      return { ...scheduled };
    },
    takeInputs(tick) {
      const due: { readonly record: InputRecord; readonly ordinal: number; readonly edge: number }[] = [];
      const remaining: InputRecord[] = [];
      for (const record of pending) {
        const match = /^spec\.action:(\d+)$/.exec(record.event.kind === "action" ? record.event.source : "");
        if (record.tick !== tick || match === null) {
          remaining.push(record);
          continue;
        }
        const ordinal = Number(match[1]);
        const down = record.event.kind === "action" && record.event.down;
        due.push({ record, ordinal, edge: down ? 0 : 1 });
      }
      pending.length = 0;
      pending.push(...remaining);
      due.sort((left, right) => left.ordinal - right.ordinal || left.edge - right.edge);
      return due.map(({ record }) => record);
    },
    completeTick(tick) {
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index]!;
        if (action.completedAt === null && action.releaseAt <= tick) actions[index] = { ...action, completedAt: action.releaseAt };
      }
    },
    snapshot() {
      return {
        nextOrdinal,
        actions: actions.map((action) => ({ ...action })),
        pending: pending.map((record) => ({ tick: record.tick, event: { ...record.event } })),
      };
    },
  };
}
