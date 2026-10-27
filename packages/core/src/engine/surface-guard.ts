/**
 * Keep batched surface drawing invisible to code the engine does not own.
 *
 * While a thread runs, script drawing can sit in working buffers whose canonical snapshots
 * (`state.surfaces.entries[id].bitmap.b64`) are stale. The engine's own packs read pixels through the
 * surface API, which sees the buffers; a package or host plugin is handed `view.state` and can read the
 * snapshots, hash or serialise the state directly. Every entry point that runs such code
 * (a command handler, a listener's command, a host-object member hook) therefore flushes first, and
 * flushes again whenever control comes back from a lower layer it called through `next`, because that
 * layer may have drawn. First-party packs are returned untouched so built-in drawing never flushes.
 */

import type { HostObjectType } from "../script/host.ts";
import type { BuiltinSpec } from "../script/builtins.ts";
import type { CommandHandler, PluginDefinition, ResolvedPlugin } from "../script/plugin.ts";

function guardHandler(call: CommandHandler, flush: () => void): CommandHandler {
  return (view, args, next) => {
    flush();
    return call(view, args, (nextView, nextArgs, nextNext) => {
      try {
        return next(nextView, nextArgs, nextNext);
      } finally {
        flush();
      }
    });
  };
}

function guardHostType(type: HostObjectType, flush: () => void): HostObjectType {
  const { read, write, remove } = type;
  return {
    ...type,
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
