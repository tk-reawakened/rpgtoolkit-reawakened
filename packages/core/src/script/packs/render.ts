import type { PlainData } from "../../ports/plain-data.ts";
import type { Wait } from "../../ports/wait.ts";
import { ScriptError } from "../errors.ts";
import type { BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import { effectCommand, pack } from "./common.ts";
import { GRAPHICS_COMMANDS } from "./graphics.ts";
import { validateFxArgument } from "../../render/fx.ts";
import { UI_COMMANDS } from "./ui.ts";

function transitionDoc(summary: string, behaviour: string, wait: string): BuiltinDoc {
  return {
    summary,
    behaviour,
    groups: ["board-tiles-vectors-screen-effects-33"],
    waits: { kind: "ticks", summary: wait },
    see: ["docs/spec/engine/rpgcode-functions.md#e-59"],
  };
}

function sleepWait(viewTick: number, ticks: number): Wait {
  return { kind: "sleep", global: true, until: viewTick + ticks, resumesCall: true };
}

function transition(name: string, params: BuiltinSpec["params"], doc: BuiltinDoc, ticks: (args: readonly { readonly value: unknown }[]) => number): BuiltinSpec {
  return {
    name,
    aliases: [],
    params,
    doc,
    call: (view, args) => {
      validateFxArgument(name, args);
      const values = args.map((arg) => arg.value as PlainData);
      if (name === "fade" && values.length > 0 && typeof values[0] === "number" && (values[0] < 0 || values[0] > 5)) return { value: null };
      return {
        value: null,
        effects: [{ kind: "mixed", section: "fx", args: values }],
        wait: sleepWait(view.clock.tick(), ticks(args)),
      };
    },
  };
}

const FADE = transition(
  "fade",
  [{ name: "type", optional: true, byRef: false, variadic: false }],
  transitionDoc(
    "Play one of the six deterministic screen fades.",
    "Plays the selected growing-box, stripe, grey-ramp, grey-strip, ellipse-ring or colour-overlay effect. Technically, omitted type is 0, valid types are 0 to 5, the effect takes exactly 30 fixed ticks and the script waits; other types do nothing and do not wait.",
    "Blocks for the fixed 30-tick transition.",
  ),
  () => 30,
);

const WIPE = transition(
  "wipe",
  [
    { name: "file", optional: false, byRef: false, variadic: false },
    { name: "effect", optional: false, byRef: false, variadic: false },
    { name: "speed", optional: true, byRef: false, variadic: false },
  ],
  transitionDoc(
    "Reveal an image with a directional wipe.",
    "Reveals an image from a side, diagonal corner or push direction. Technically, effects 1 to 12 select the documented geometry, speed is logical pixels per fixed tick and defaults to 1, and the last frame is exactly the resolved image; non-positive speed is a catchable bad-argument error and the script waits until completion.",
    "Blocks for the fixed-tick wipe transition.",
  ),
  (args) => {
    const speed = typeof args[2]?.value === "number" ? args[2].value : 1;
    const effect = typeof args[1]?.value === "number" ? Math.trunc(args[1].value) : 1;
    const total = effect >= 5 && effect <= 8 ? 640 + 480 - 1 : effect === 3 || effect === 4 || effect >= 11 ? 480 : 640;
    return Math.max(1, Math.ceil(total / speed));
  },
);

const ZOOM = transition(
  "zoom",
  [{ name: "percent", optional: false, byRef: false, variadic: false }],
  transitionDoc(
    "Zoom the board toward its current centre.",
    "Shrinks the visible part of the board by the requested amount. Technically, percent is a shrink amount from 0 to 75, nearest-neighbour sampling keeps the current logical centre, the target is reached in 30 fixed ticks and the script waits; other values raise a catchable bad-argument error.",
    "Blocks for the fixed 30-tick zoom.",
  ),
  () => 30,
);

const EARTHQUAKE = transition(
  "earthquake",
  [{ name: "intensity", optional: false, byRef: false, variadic: false }],
  {
    summary: "Shake the whole game screen, from barely noticeable to strongest.",
    behaviour: "Shakes the screen in increasingly strong four-tick bursts. Technically, intensity is clamped to 1..10; pass p moves the screen p logical pixels through the four corners, for 4*i fixed ticks total, and the script waits until the final pass.",
    groups: ["board-tiles-vectors-screen-effects-33"],
    waits: { kind: "ticks", summary: "Waits 4 times the intensity ticks, through all four-corner shake passes." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-earthquake"],
  },
  (args) => {
    const intensity = args[0]?.value;
    if (typeof intensity !== "number" || !Number.isFinite(intensity)) throw new ScriptError("builtin.bad-arg", "earthquake intensity must be finite");
    return Math.max(1, Math.min(10, Math.trunc(intensity))) * 4;
  },
);

const BORDER_COLOR: BuiltinSpec = {
  ...effectCommand("bordercolor", "fx"),
  doc: {
    summary: "Obsolete.",
    behaviour: "Kept so old games that call it still run: it records the three colour values for the fx section and does not wait. The native specification marks the command obsolete.",
    groups: ["graphics-canvases-animation-video-31"],
    tags: ["obsolete"],
    replacedBy: { kind: "syntax", text: "No replacement; the command is kept for old games." },
    reason: "The native specification marks bordercolor obsolete; the engine still records its colour so old games do not fail.",
    waits: { kind: "never", summary: "Does not wait." },
  },
};

function animationCommand(name: "animation" | "sizedanimation" | "pinnedanimation"): BuiltinSpec {
  const sized = name === "sizedanimation";
  const pinned = name === "pinnedanimation";
  const params = sized
    ? [
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "x", optional: false, byRef: false, variadic: false },
        { name: "y", optional: false, byRef: false, variadic: false },
        { name: "height", optional: false, byRef: false, variadic: false },
        { name: "width", optional: false, byRef: false, variadic: false },
        { name: "loop", optional: true, byRef: false, variadic: false },
      ]
    : [
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "x", optional: false, byRef: false, variadic: false },
        { name: "y", optional: false, byRef: false, variadic: false },
        { name: "loop", optional: true, byRef: false, variadic: false },
      ];
  return {
    name,
    aliases: [],
    params,
    doc: {
      summary: pinned
        ? "Play an animation as a fixed picture the engine keeps animating, drawn above the render-now canvas."
        : sized
        ? "Play a resized animation at pixel x,y. If sizedAnimation() is called in a thread, it may be looped using the last parameter and returns an id that can be used to end..."
        : "Play an animation at pixel x,y. If animation() is called in a thread, it may be looped using the last parameter and returns an id that can be used to end the animation.",
      behaviour: pinned
        ? "Starts the named .anm or animated GIF at the given pixel position exactly like animation, with two differences: it is drawn above the render-now canvas (after it, before the debug overlays and the text layer), and a one-shot one keeps showing its last frame until endAnimation instead of disappearing. Technically, the frame shown is a pure function of the start tick, the frame delay and the current tick, so a one-tick delay shows every frame on its own tick regardless of how busy the script is, and the call returns the same deterministic animation id as animation without waiting."
        : sized
        ? "Starts the named .anm or animated GIF at the given pixel position and size. Technically, height precedes width as in the legacy call, the first-page GIF delay is used, a true loop flag keeps the animation running until endAnimation, and the call returns a deterministic animation id without waiting."
        : "Starts the named .anm or animated GIF at the given pixel position. Technically, frames advance every fixed delay tick, a true loop flag keeps the animation running until endAnimation, and the call returns a deterministic animation id without waiting.",
      returns: { summary: "The animation id.", unit: "integer" },
      groups: ["graphics-canvases-animation-video-31"],
      waits: { kind: "never", summary: "Starts playback without waiting." },
      effects: ["fx"],
      see: pinned ? ["docs/spec/engine/rpgcode-functions.md#reawakened-pinnedanimation"] : ["docs/spec/engine/plugins-and-battle.md#e-54"],
    },
    call: (view, args) => {
      const values = args.map((arg) => arg.value as PlainData);
      if (typeof values[0] !== "string" || typeof values[1] !== "number" || !Number.isFinite(values[1]) || typeof values[2] !== "number" || !Number.isFinite(values[2])) {
        throw new ScriptError("builtin.bad-arg", `${name} requires a file and finite pixel coordinates`);
      }
      const sizeArgs = sized ? [values[3], values[4]] : [];
      if (sized && sizeArgs.some((value) => typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0)) {
        throw new ScriptError("builtin.bad-arg", `${name} requires positive integer dimensions`);
      }
      const loopIndex = sized ? 5 : 3;
      const loop = values[loopIndex];
      if (loop !== undefined && loop !== true && loop !== false && loop !== 0 && loop !== 1) {
        throw new ScriptError("builtin.bad-arg", `${name} loop must be 0 or 1`);
      }
      const id = view.state?.fx.nextAnimationId ?? 1;
      return {
        value: id,
        effects: [{ kind: "state-write", section: "fx", args: values }],
      };
    },
  };
}

const ANIMATION = animationCommand("animation");
const SIZED_ANIMATION = animationCommand("sizedanimation");
const PINNED_ANIMATION = animationCommand("pinnedanimation");
const END_ANIMATION: BuiltinSpec = {
  name: "endanimation",
  aliases: [],
  params: [{ name: "id", optional: false, byRef: false, variadic: false }],
  doc: {
    summary: "End a multitasking animation.",
    behaviour: "Stops the animation with the supplied id. Technically, an unknown id is ignored and the call completes immediately.",
    groups: ["graphics-canvases-animation-video-31"],
    waits: { kind: "never", summary: "Does not wait." },
    effects: ["fx"],
    see: ["docs/spec/engine/plugins-and-battle.md#e-54"],
  },
  call: (_view, args) => {
    const id = args[0]?.value;
    if (typeof id !== "number" || !Number.isFinite(id) || !Number.isInteger(id)) throw new ScriptError("builtin.bad-arg", "endAnimation id must be an integer");
    return { value: null, effects: [{ kind: "state-write", section: "fx", args: [id] }] };
  },
};
/** Rendering owner pack: camera, UI, effects and surfaces are separate command layers. */
export const RENDER_PLUGIN = pack("render", "Deterministic rendering, camera, UI and visual-effect commands.", [
  ...UI_COMMANDS,
  FADE,
  WIPE,
  ZOOM,
  EARTHQUAKE,
  BORDER_COLOR,
  ...GRAPHICS_COMMANDS,
  ANIMATION,
  SIZED_ANIMATION,
  PINNED_ANIMATION,
  END_ANIMATION,
]);
