import { actorEmitterKey } from "../actors/model.ts";
import { emitEffect, readEvent } from "../events/native.ts";
import type { PluginDefinition } from "./plugin.ts";

/** Host-owned native commands for the stock RPG package (docs/spec/engine/actors.md#standard-actor-and-board-events). */
export const STOCK_RPG_PLUGIN: PluginDefinition = {
  id: "stock_rpg",
  version: "1.0.0",
  commands: [
    {
      name: "bridgefallen",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state === undefined) return { value: 0 };
        const event = readEvent(view.state, args[0]?.value);
        if (event === undefined) return { value: 0 };
        const actor = Number(event.emitter.slice("actor:".length));
        const cause = event.detail.cause;
        const source = event.detail.source;
        return {
          value: 1,
          effects: [emitEffect("game", "stock-rpg.fallen", {
            actor: Number.isSafeInteger(actor) && actor > 0 ? actor : 0,
            cause: typeof cause === "string" ? cause : "",
            source: typeof source === "number" ? source : 0,
          })],
        };
      },
    },
    // dialogue.completed details. Malformed details and unregistered source emitters are ignored.
    // The source emitter must exist; targetId is validated by shape only because it may be
    // removed after the completion was queued. Producer-valid values, including null targetId, are preserved exactly.
    {
      name: "bridgetalked",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state === undefined) return { value: 0 };
        const event = readEvent(view.state, args[0]?.value);
        if (
          event === undefined ||
          event.type !== "dialogue.completed" ||
          event.emitter !== "game"
        ) return { value: 0 };
        const actorId = event.detail.actorId;
        const targetId = event.detail.targetId;
        const text = event.detail.text;
        if (
          typeof actorId !== "number" || !Number.isSafeInteger(actorId) || actorId < 1 ||
          view.state.events.emitters === undefined ||
          !Object.hasOwn(view.state.events.emitters, actorEmitterKey(actorId)) ||
          typeof text !== "string" ||
          (targetId !== null && (typeof targetId !== "number" || !Number.isSafeInteger(targetId) || targetId < 1))
        ) return { value: 0 };
        return {
          value: 1,
          effects: [emitEffect(actorEmitterKey(actorId), "talked", { actorId, targetId, text })],
        };
      },
    },
  ],
  listeners: [{ emitter: "actor:*", type: "fallen", command: "bridgefallen" }],
};
