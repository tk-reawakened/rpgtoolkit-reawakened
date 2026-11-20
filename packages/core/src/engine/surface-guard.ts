/**
 * Keep batched drawing and deferred presentation pixels invisible to external code.
 *
 * While a thread runs, script drawing can sit in working buffers whose canonical snapshots
 * (`state.surfaces.entries[id].bitmap.b64`) are stale; a newly presented screen frame can likewise
 * retain current decoded pixels while its canonical bytes are deferred. The engine's own packs read
 * pixels through the surface API, which sees the current buffers; a package or host plugin is handed
 * `view.state` and can read snapshots, hash or serialise the state directly. Every entry point that runs
 * such code (a command handler, a listener's command, a host-object member hook, an emitter key) therefore
 * flushes first, and flushes again whenever control returns through a lower layer it called through
 * `next`, because that layer may have drawn. External commands' `refreshScreen` port is wrapped too, so
 * a new frame is canonical before that callback resumes. First-party packs are returned untouched so
 * built-in drawing never flushes.
 *
 * External code may keep the `view` or a host-object `record` it was handed and read through it later,
 * from a callback the engine invokes at an arbitrary point in a thread. `emitterKey` is such a
 * callback: it runs on the first emitter method of a host object, mid-thread, and the plugin can read
 * the state it retained. Menu providers and actor behaviour hooks are the other externally supplied
 * callbacks, but neither is offered a state or surface view (menu ports expose only the party,
 * inventory and menu sections), so they have nothing to flush for.
 */

import type { HostObjectType } from "../script/host.ts";
import type { ObjectRecord } from "../script/state.ts";
import type { BuiltinSpec } from "../script/builtins.ts";
import type { CommandHandler, CommandView, PluginDefinition, ResolvedPlugin } from "../script/plugin.ts";

function viewWithGuardedRefreshScreen(view: CommandView, refreshScreen: () => void, flush: () => void): CommandView {
  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(view) as PropertyDescriptorMap;
  const original = descriptors.refreshScreen;
  const guardedRefreshScreen = () => {
    try {
      refreshScreen();
    } finally {
      flush();
    }
  };
  if (original === undefined) {
    descriptors.refreshScreen = { configurable: true, enumerable: true, writable: true, value: guardedRefreshScreen };
  } else if ("get" in original || "set" in original) {
    descriptors.refreshScreen = {
      configurable: original.configurable ?? false,
      enumerable: original.enumerable ?? false,
      get: () => guardedRefreshScreen,
      ...(original.set === undefined ? {} : { set: original.set.bind(view) }),
    };
  } else {
    descriptors.refreshScreen = { ...original, value: guardedRefreshScreen };
  }
  const guarded = Object.create(Object.getPrototypeOf(view), descriptors) as CommandView;
  if (!Object.isExtensible(view)) Object.preventExtensions(guarded);
  return guarded;
}

function guardHandler(call: CommandHandler, flush: () => void): CommandHandler {
  return (view, args, next) => {
    flush();
    const refreshScreen = view.refreshScreen;
    const guardedView = refreshScreen === undefined ? view : viewWithGuardedRefreshScreen(view, refreshScreen, flush);
    return call(guardedView, args, (nextView, nextArgs, nextNext) => {
      try {
        return next(nextView, nextArgs, nextNext);
      } finally {
        flush();
      }
    });
  };
}

function guardHostType(type: HostObjectType, flush: () => void): HostObjectType {
  const { emitterKey, read, write, remove } = type;
  return {
    ...type,
    ...(emitterKey === undefined ? {} : { emitterKey: (record: ObjectRecord) => { flush(); return emitterKey(record); } }),
    ...(read === undefined ? {} : { read: (context, name) => { flush(); return read(context, name); } }),
    ...(write === undefined ? {} : { write: (context, name, value) => { flush(); return write(context, name, value); } }),
    ...(remove === undefined ? {} : { remove: (context, name) => { flush(); return remove(context, name); } }),
  };
}

/**
 * The plugin list with every definition outside `firstParty` wrapped so `flush` runs before its code
 * can see the game state. `flush` must be cheap when nothing is dirty.
 */
export function guardExternalPlugins(
  plugins: readonly ResolvedPlugin[],
  firstParty: ReadonlySet<PluginDefinition>,
  flush: () => void,
): readonly ResolvedPlugin[] {
  return plugins.map((plugin) => {
    const definition = plugin.definition;
    if (firstParty.has(definition)) return plugin;
    const commands: readonly BuiltinSpec[] = definition.commands.map((spec) => ({ ...spec, call: guardHandler(spec.call, flush) }));
    const hostTypes = definition.hostTypes?.map((type) => guardHostType(type, flush));
    return { ...plugin, definition: { ...definition, commands, ...(hostTypes === undefined ? {} : { hostTypes }) } };
  });
}
