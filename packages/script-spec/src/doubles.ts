/**
 * Test doubles and spies of one spec run (TOOL-5, docs/spec/engine/rpgcode-tooling.md#tool-5-doubles).
 *
 * Scheduled key edges, scripted RNG draws, spies and their call records are host-side state of **one run** (a case,
 * a `beforeAll` or an `afterAll` run). The runner makes a fresh `SpecDoubles` for every run, so nothing carries
 * between runs or into a restored group snapshot, and nothing here is ever saved or hashed: only what a double
 * causes in the simulation (a key edge in the input section, a command's effects) is.
 *
 * Spies and scripted draws work by wrapping the handlers of the plugins the runner registers (`wrapPlugins`). The
 * wrapping happens only inside the test runner, per run; a game's command list is never touched.
 */

import {
  applyInputEvent,
  CATALOGUE_STUBS_PLUGIN,
  ScriptError,
  type CommandHandler,
  type CommandView,
  type InputSection,
  type KeyInput,
  type ResolvedPlugin,
  type RngPort,
} from "@tk-reawakened/core";
import { captureArg, type Snap } from "./snapshot.ts";

/** The plugin id whose commands no spy may target. */
const SPEC_PLUGIN_ID = "script-spec";

/** One scheduled key edge: the absolute fixture tick it enters the input section in, and the event. */
export type ScheduledKey = { readonly tick: number; readonly event: KeyInput };

export type Spy = {
  readonly handle: string;
  /** The command's own (folded) name, for messages. */
  readonly name: string;
  /** One argument-picture list per recorded call, in call order. */
  readonly calls: Snap[][];
};

export type SpecDoubles = {
  /** Key edges not yet applied, in scheduling order. */
  readonly pending: ScheduledKey[];
  /** The scripted draws, or `null` when the seeded generator serves every draw. */
  draws: readonly number[] | null;
  /** The next scripted draw to hand out. */
  drawAt: number;
  /** Spies by handle. */
  readonly spies: Map<string, Spy>;
  /** Spies by target layer key (`<plugin index>:<command name>`). */
  readonly byTarget: Map<string, Spy>;
  /** The top layer a folded name or alias reaches, by the plugin list this run registered. */
  readonly topLayer: ReadonlyMap<string, { readonly key: string; readonly plugin: string; readonly name: string; readonly stub: boolean }>;
};

export function createDoubles(): SpecDoubles {
  return { pending: [], draws: null, drawAt: 0, spies: new Map(), byTarget: new Map(), topLayer: new Map() };
}

/**
 * Wrap every command handler of `plugins` so spies record their calls and scripted draws replace the RNG port, and
 * fill `doubles.topLayer` with the layer each name reaches (a later plugin's layer runs first, ADR 0004). Without a
 * spy or scripted draws a wrapped handler calls the original with the same view and arguments.
 */
export function wrapPlugins(plugins: readonly ResolvedPlugin[], doubles: SpecDoubles): readonly ResolvedPlugin[] {
  const stubs = new Set<CommandHandler>(CATALOGUE_STUBS_PLUGIN.commands.map((command) => command.call));
  const top = doubles.topLayer as Map<string, { key: string; plugin: string; name: string; stub: boolean }>;
  const scripted: RngPort = {
    nextUint32: () => {
      const draws = doubles.draws!;
      if (doubles.drawAt >= draws.length) {
        throw new ScriptError("spec.rng-exhausted", `specRng: all ${draws.length} scripted draw(s) were used; a further draw has no number`);
      }
      const draw = draws[doubles.drawAt]!;
      doubles.drawAt += 1;
      return draw;
    },
  };
  return plugins.map((plugin, index) => ({
    ...plugin,
    definition: {
      ...plugin.definition,
      commands: plugin.definition.commands.map((command) => {
        const key = `${index}:${command.name}`;
        const layer = { key, plugin: plugin.definition.id, name: command.name, stub: stubs.has(command.call) };
        for (const name of [command.name, ...command.aliases]) top.set(name, layer);
        const call: CommandHandler = (view, args, next) => {
          const spy = doubles.byTarget.get(key);
          // Pictures are taken at call time, before the command can change a by-reference argument.
          if (spy !== undefined) spy.calls.push(args.map((arg) => captureArg(view, arg)));
          const inner: CommandView = doubles.draws === null ? view : Object.create(view, { rng: { value: scripted, enumerable: true } });
          return command.call(inner, args, next);
        };
        return { ...command, call };
      }),
    },
  }));
}

/** Install a spy on the layer a plain call of `name` reaches; the folded name and the handle text are returned. */
export function installSpy(doubles: SpecDoubles, name: string): string {
  const folded = name.toLowerCase();
  const layer = doubles.topLayer.get(folded);
  if (layer === undefined) throw new ScriptError("spec.spy-target", `spyOn: no command is named "${name}"`);
  if (layer.plugin === SPEC_PLUGIN_ID) throw new ScriptError("spec.spy-target", `spyOn: "${name}" is a script-spec command, which cannot be spied on`);
  if (layer.stub) throw new ScriptError("spec.spy-target", `spyOn: "${name}" is a catalogue placeholder with no implementation`);
  if (doubles.byTarget.has(layer.key)) throw new ScriptError("spec.spy-exists", `spyOn: "${layer.name}" already has a spy in this run`);
  const handle = `<spy ${layer.name} #${doubles.spies.size + 1}>`;
  const spy: Spy = { handle, name: layer.name, calls: [] };
  doubles.spies.set(handle, spy);
  doubles.byTarget.set(layer.key, spy);
  return handle;
}

/**
 * Apply the edges scheduled for `tick` to the input section, in scheduling order, exactly as a host key event is
 * applied, and forget them. The runner calls this at the start of each tick, before its wait poll.
 */
export function applyDue(doubles: SpecDoubles, input: InputSection, tick: number): void {
  for (let index = 0; index < doubles.pending.length;) {
    const item = doubles.pending[index]!;
    if (item.tick === tick) {
      applyInputEvent(input, item.event);
      doubles.pending.splice(index, 1);
    } else {
      index += 1;
    }
  }
}
