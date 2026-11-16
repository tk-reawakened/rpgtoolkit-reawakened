/** Observation-only service data; ADR 0010, never VM state. */
import type { StepOp, SourcePos } from "./ops.ts";
import type { EffectRecord } from "./effects.ts";
import type { CommandHandler, ResolvedPlugin } from "./plugin.ts";
import { CATALOGUE_STUBS_PLUGIN } from "./catalogue-stubs.ts";

export type CallObservation = {
  readonly kind: "callable" | "builtin" | "script" | "extension";
  readonly name: string;
  readonly argc: number;
  readonly plugin?: string;
  readonly via: "source" | "handle" | "continuation";
  readonly pos: SourcePos;
};

export type HandlerObservation = {
  readonly plugin: string;
  readonly name: string;
  readonly generatedStub: boolean;
};

export type ScriptObservers = {
  readonly postStep?: (op: StepOp, thread: number) => void;
  readonly postCall?: (call: CallObservation, thread: number) => void;
  /** Separate from resolutions: records each native layer actually entered. */
  readonly postHandler?: (handler: HandlerObservation, thread: number) => void;
  /** Runs once per effect record at the moment it is produced (ADR 0010, effect observer), before drain or eviction. */
  readonly onEffect?: (effect: EffectRecord, thread: number) => void;
};

function freezeTree(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}

/** Detached, recursively frozen plain data. A host observer cannot fail a script. */
export function observe<T>(callback: (payload: T, thread: number) => void, payload: T, thread: number): void {
  try {
    const copy = JSON.parse(JSON.stringify(payload)) as T;
    freezeTree(copy);
    callback(copy, thread);
  } catch {
    // ADR 0010: observer failures have no effect on script execution.
  }
}

/** Instrument actual handler entries, outside the pure registry. No wrappers when absent. */
export function observePlugins(plugins: readonly ResolvedPlugin[], postHandler: ScriptObservers["postHandler"]): readonly ResolvedPlugin[] {
  if (postHandler === undefined) return plugins;
  const stubs = new Set<CommandHandler>(CATALOGUE_STUBS_PLUGIN.commands.map((command) => command.call));
  return plugins.map((plugin) => ({
    ...plugin,
    definition: {
      ...plugin.definition,
      commands: plugin.definition.commands.map((command) => ({
        ...command,
        call: (view, args, next) => {
          observe(postHandler, { plugin: plugin.definition.id, name: command.name, generatedStub: stubs.has(command.call) }, view.thread ?? 0);
          return command.call(view, args, next);
        },
      })),
    },
  }));
}
