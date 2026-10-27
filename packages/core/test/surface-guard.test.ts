import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { guardExternalPlugins } from "../src/engine/surface-guard.ts";
import type { CommandHandler, CommandView, HostObjectContext, HostObjectType, PluginDefinition, ResolvedPlugin } from "../src/index.ts";

const VIEW = {} as CommandView;

function recorded(): { log: string[]; flush: () => void } {
  const log: string[] = [];
  return { log, flush: () => { log.push("flush"); } };
}

function plugin(definition: Partial<PluginDefinition> & Pick<PluginDefinition, "commands">): ResolvedPlugin {
  return { definition: { id: "external", version: "1.0.0", ...definition } };
}

test("first-party plugins are returned untouched and external ones flush before their handlers run", () => {
  const { log, flush } = recorded();
  const builtIn = plugin({ commands: [{ name: "draw", aliases: [], params: [], call: () => { log.push("built-in"); return { value: 1 }; } }] });
  const external = plugin({ commands: [{ name: "peek", aliases: [], params: [], call: () => { log.push("peek"); return { value: 2 }; } }] });
  const [guardedBuiltIn, guardedExternal] = guardExternalPlugins([builtIn, external], new Set([builtIn.definition]), flush);
  equal(guardedBuiltIn, builtIn, "a first-party plugin must not be wrapped");
  guardedBuiltIn!.definition.commands[0]!.call(VIEW, [], () => ({ value: null }));
  deepEqual(log, ["built-in"]);
  log.length = 0;
  equal(guardedExternal!.definition.commands[0]!.call(VIEW, [], () => ({ value: null })).value, 2);
  deepEqual(log, ["flush", "peek"]);
  equal(guardedExternal!.definition.id, "external");
});

test("an external wrapper sees a flushed state after the layer below it has drawn, even if that layer throws", () => {
  for (const failing of [false, true]) {
    const { log, flush } = recorded();
    const wrapper = plugin({
      commands: [{
        name: "setpixel", aliases: [], params: [],
        call: (view, args, next) => {
          log.push("wrapper start");
          try { next(view, args, next); } catch { log.push("caught"); }
          log.push("wrapper reads state");
          return { value: null };
        },
      }],
    });
    const below: CommandHandler = () => { log.push("lower layer draws"); if (failing) throw new Error("lower layer failed"); return { value: null }; };
    const [guarded] = guardExternalPlugins([wrapper], new Set(), flush);
    guarded!.definition.commands[0]!.call(VIEW, [], below);
    deepEqual(log, failing
      ? ["flush", "wrapper start", "lower layer draws", "flush", "caught", "wrapper reads state"]
      : ["flush", "wrapper start", "lower layer draws", "flush", "wrapper reads state"]);
  }
});

test("a wrapped handler still propagates its errors and keeps the plugin's aliases and listener declarations", () => {
  const { flush } = recorded();
  const external = plugin({
    commands: [{ name: "boom", aliases: ["bang"], params: [], call: () => { throw new Error("handler failed"); } }],
    listeners: [{ emitter: "game", type: "ping", command: "boom" }],
  });
  const [guarded] = guardExternalPlugins([external], new Set(), flush);
  equal(guarded!.definition.commands[0]!.aliases[0], "bang");
  deepEqual(guarded!.definition.listeners, external.definition.listeners);
  throws(() => guarded!.definition.commands[0]!.call(VIEW, [], () => ({ value: null })), /handler failed/);
});

test("host-object members flush before external read, write and remove hooks run", () => {
  const { log, flush } = recorded();
  const type: HostObjectType = {
    name: "thing",
    methods: { poke: "pokecommand" },
    readOnlyMembers: ["id"],
    read: () => { log.push("read"); return 1; },
    write: () => { log.push("write"); return "written"; },
    remove: () => { log.push("remove"); return "removed"; },
  };
  const [guarded] = guardExternalPlugins([plugin({ commands: [], hostTypes: [type] })], new Set(), flush);
  const wrapped = guarded!.definition.hostTypes![0]!;
  equal(wrapped.name, "thing");
  deepEqual(wrapped.methods, { poke: "pokecommand" });
  deepEqual(wrapped.readOnlyMembers, ["id"]);
  const context = {} as HostObjectContext;
  equal(wrapped.read!(context, "x"), 1);
  equal(wrapped.write!(context, "x", 2), "written");
  equal(wrapped.remove!(context, "x"), "removed");
  deepEqual(log, ["flush", "read", "flush", "write", "flush", "remove"]);
  const bare = guardExternalPlugins([plugin({ commands: [], hostTypes: [{ name: "inert" }] })], new Set(), flush)[0]!.definition.hostTypes![0]!;
  equal(bare.read, undefined);
  equal(bare.write, undefined);
  equal(bare.remove, undefined);
});
