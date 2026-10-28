import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { guardExternalPlugins } from "../src/engine/surface-guard.ts";
import { createAssetIndex, createEmptyBoard, createEngine, encodeSurfaceBytes, ENGINE_DEFAULT_MANIFEST, PACKAGE_ROOT, readSurfacePixels, writeBoard, type CommandHandler, type CommandView, type GameState, type HostObjectContext, type HostObjectType, type PluginDefinition, type ResolvedPlugin } from "../src/index.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";
import type { ObjectRecord } from "../src/script/state.ts";

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

test("host-object members and emitter keys flush before external hooks run", () => {
  const { log, flush } = recorded();
  const type: HostObjectType = {
    name: "thing",
    methods: { poke: "pokecommand" },
    readOnlyMembers: ["id"],
    emitterKey: () => { log.push("emitter key"); return "thing"; },
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
  equal(wrapped.emitterKey!({} as ObjectRecord), "thing");
  equal(wrapped.read!(context, "x"), 1);
  equal(wrapped.write!(context, "x", 2), "written");
  equal(wrapped.remove!(context, "x"), "removed");
  deepEqual(log, ["flush", "emitter key", "flush", "read", "flush", "write", "flush", "remove"]);
  const bare = guardExternalPlugins([plugin({ commands: [], hostTypes: [{ name: "inert" }] })], new Set(), flush)[0]!.definition.hostTypes![0]!;
  equal(bare.emitterKey, undefined);
  equal(bare.read, undefined);
  equal(bare.write, undefined);
  equal(bare.remove, undefined);
});

/**
 * Whether every surface snapshot on `state` encodes exactly the pixels a reader sees: false while a
 * batch holds pixels the snapshot does not have yet.
 */
function observeSurfaces(log: SurfaceObservation[], label: string, state: GameState | undefined): void {
  const entries = state === undefined ? [] : Object.values(state.surfaces.entries);
  const fresh = state !== undefined && entries.every((entry) => {
    const pixels = readSurfacePixels(state.surfaces, entry.id, entry.rev);
    return pixels !== null && encodeSurfaceBytes(pixels.rgba) === entry.bitmap.b64;
  });
  log.push({ label, fresh, b64: entries.map((entry) => entry.bitmap.b64).join("|") });
}

type SurfaceObservation = { readonly label: string; readonly fresh: boolean; readonly b64: string };

/**
 * An external package that keeps the `view` it was handed and reads that view from its host type's
 * `emitterKey`, which the engine calls mid-thread on the first emitter method of a host object.
 */
function retainingPackage(log: SurfaceObservation[]): ResolvedPlugin {
  let retained: CommandView | undefined;
  return {
    definition: {
      id: "retaining",
      version: "1.0.0",
      commands: [
        { name: "grab", aliases: [], params: [], call: (view) => { retained = view; return { value: null }; } },
        { name: "peek", aliases: [], params: [], call: (view) => { observeSurfaces(log, "command entry", view.state); return { value: null }; } },
      ],
      hostTypes: [{
        name: "media",
        emitterKey: () => { observeSurfaces(log, "emitter key", retained?.state); return null; },
      }],
    },
  };
}

function boardBytes(): Uint8Array {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

/** Run the retained-view script on a batched (default) or eager engine. */
function retainedViewProbe(eager: boolean): { seen: SurfaceObservation[]; hash: string; codes: readonly string[] } {
  const seen: SurfaceObservation[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 8,
    height: 4,
    maxTicks: 2,
    program: [
      "grab()",
      "fillrect(0, 0, 3, 3)",
      "peek()",
      "fillrect(1, 1, 5, 2)",
      'media.emit("zzz")',
      "end()",
    ].join("\n") + "\n",
    plugins: [...resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins, retainingPackage(seen)],
    ...(eager ? { effectAppliers: [{ section: "surfaces" as const, applier: () => {} }] } : {}),
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected a board asset request");
  const report = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: boardBytes() } }]);
  return { seen, hash: report.stateHash, codes: report.diagnostics.map((diagnostic) => diagnostic.code) };
}

test("an external emitter key that reads a retained view sees the same surfaces as an eager engine", () => {
  const batched = retainedViewProbe(false);
  const eager = retainedViewProbe(true);
  deepEqual(batched.codes, []);
  deepEqual(eager.codes, []);
  const labels = batched.seen.map((entry) => entry.label);
  deepEqual(labels, eager.seen.map((entry) => entry.label));
  ok(labels.includes("emitter key"), "the probe must reach the emitter key");
  for (const [index, entry] of batched.seen.entries()) {
    ok(entry.fresh, `${entry.label}: the snapshot a plugin reads is stale`);
    deepEqual(entry, eager.seen[index], `${entry.label}: batched and eager engines exposed different snapshots`);
  }
  equal(batched.hash, eager.hash);
});
