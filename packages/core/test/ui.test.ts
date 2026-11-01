import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import {
  applyUiEffect,
  colourSurface,
  composeUi,
  createGameState,
  createScriptServices,
  createSurfacesSection,
  pollInputKey,
  pollRenderMsgBox,
  UI_COMMANDS,
  UI_PLUGIN,
  type Arg,
  type Wait,
} from "../src/index.ts";
import { pollMenuScreen } from "../src/script/waits.ts";
import type { DrawCommand } from "../src/ports/draw.ts";

function textAdvance(cmd: DrawCommand, index: number): number | undefined {
  return cmd.kind === "text" ? cmd.advances[index]?.advance : undefined;
}

function arg(value: Arg["value"], ref: string | null = null): Arg {
  return { value, ref: ref as never };
}

function command(name: string, state: ReturnType<typeof createGameState>, args: readonly Arg[]) {
  const services = createScriptServices(state, [{ definition: UI_PLUGIN }]);
  const spec = services.commands.get(name)?.spec;
  if (spec === undefined) throw new Error(`missing ${name}`);
  return spec.call(services.view, args, () => ({ value: null }));
}

function firstEffect(result: ReturnType<typeof command>): NonNullable<NonNullable<ReturnType<typeof command>["effects"]>[number]> {
  const effect = result.effects?.[0];
  if (effect === undefined) throw new Error("command emitted no effect");
  return effect;
}

test("UI pack exposes message, cursor-map and cursor commands", () => {
  equal(UI_COMMANDS.length, 34);
  equal(new Set(UI_COMMANDS.map((entry) => entry.name)).size, 34);
  equal(UI_COMMANDS.every((entry) => (entry.doc?.summary.length ?? 0) > 0 && (entry.doc?.behaviour.length ?? 0) > 0), true);
});
test("dialogue UI effect uses the message window and appends text", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "dialogue", ["Hello Ada"]);
  equal(state.ui.message.visible, true);
  equal(state.ui.message.text, "Hello Ada");
  applyUiEffect(state, "dialogue", ["How are you?"]);
  equal(state.ui.message.text, "Hello Ada\nHow are you?");
});

test("dialogue without a live source actor raises its catchable error", () => {
  const state = createGameState({ seed: 0 });
  let code = "";
  try {
    command("dialogue", state, [arg("Hello")]);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") code = error.code;
  }
  equal(code, "dialogue.no-source");
});

test("message-window effects splice globals and use deterministic defaults", () => {
  const state = createGameState({ seed: 0 });
  state.vm.globals.name = "Ada";
  const effect = firstEffect(command("mwin", state, [arg("Hello <name>")]));
  applyUiEffect(state, "mwin", effect.args ?? []);
  equal(state.ui.message.visible, true);
  equal(state.ui.message.text, "Hello Ada");
  deepEqual(state.ui.message.background, { r: 0, g: 0, b: 0 });
  equal(state.ui.message.translucency, 50);
  equal(composeUi(state.ui, 800, 600).some((entry) => entry.kind === "rect"), true);
});

test("engine-backed message windows use the default translucent colour surface", () => {
  const state = createGameState({ seed: 0 });
  state.surfaces = createSurfacesSection();
  const expected = colourSurface(state.surfaces, { r: 0, g: 0, b: 0 });
  const effect = firstEffect(command("mwin", state, [arg("Hello")]));
  applyUiEffect(state, "mwin", effect.args ?? []);
  equal(state.ui.message.translucency, 50);
  equal(state.ui.backgroundSurface, expected);
  equal(composeUi(state.ui, 800, 600)[0]?.kind, "blit");
});

test("text and pixelText record draws and text metrics", () => {
  const state = createGameState({ seed: 0 });
  for (const [name, args] of [["text", [arg(2), arg(3), arg("A\\nB")]], ["pixeltext", [arg(10), arg(20), arg("C")]]] as const) {
    const effect = firstEffect(command(name, state, args));
    applyUiEffect(state, name, effect.args ?? []);
  }
  equal(state.ui.draws.length, 2);
  equal(state.ui.draws[0]?.x, 8);
  equal(state.ui.draws[0]?.y, 16);
  equal(state.ui.draws[0]?.cell, true);
  equal(state.ui.draws[1]?.x, 10);
  equal(state.ui.draws[1]?.cell, false);
  equal(command("gettextwidth", state, [arg("AB")]).value, 16);
});

test("text truncates fractional cell coordinates toward zero", () => {
  const state = createGameState({ seed: 0 });
  const effect = firstEffect(command("text", state, [arg(5.9), arg(2.4), arg("X")]));
  applyUiEffect(state, "text", effect.args ?? []);
  // Cell (5, 2) -> (5 - 1) * 8, (2 - 1) * 8
  equal(state.ui.draws[0]?.x, 32);
  equal(state.ui.draws[0]?.y, 8);
  equal(state.ui.cursorX, 32);
  equal(state.ui.cursorY, 8);

  const pixel = firstEffect(command("pixeltext", state, [arg(10.7), arg(20.3), arg("Y")]));
  applyUiEffect(state, "pixeltext", pixel.args ?? []);
  equal(state.ui.draws[1]?.x, 10);
  equal(state.ui.draws[1]?.y, 20);
});

test("cell text lays out multi-line strings with one cell row per line", () => {
  const state = createGameState({ seed: 0 });
  const effect = firstEffect(command("text", state, [arg(1), arg(1), arg("A\nB\nC")]));
  applyUiEffect(state, "text", effect.args ?? []);
  const commands = composeUi(state.ui, 800, 600).filter((entry) => entry.kind === "text");
  equal(commands.length, 3);
  equal(commands[0]?.x, 0);
  equal(commands[0]?.y, 0);
  equal(commands[1]?.x, 0);
  equal(commands[1]?.y, 8);
  equal(commands[2]?.x, 0);
  equal(commands[2]?.y, 16);
  // First glyph of the first line is the 8px-wide default bitmap cell.
  equal(textAdvance(commands[0]!, 0), 8);
});

test("prompt and msgBox waits resolve from modal state or unclaimed keys", () => {
  const state = createGameState({ seed: 0 });
  const prompt = command("prompt", state, [arg("Name?"), arg("", "answer")]);
  const promptEffect = firstEffect(prompt);
  applyUiEffect(state, "prompt", promptEffect.args ?? []);
  const promptWait = prompt.wait as Wait;
  equal(pollRenderMsgBox({ tick: 0, ui: state.ui as never, input: { keys: [], focused: true }, claims: [] }, promptWait), null);
  const typed = pollRenderMsgBox({ tick: 0, input: { keys: [{ seq: 3, name: "Enter", code: "Enter", char: "Ada" }], focused: true }, claims: [] }, promptWait);
  deepEqual(typed, { value: "Ada", ok: true, claim: 3 });

  const msg = command("msgbox", state, [arg("Continue?"), arg("Notice"), arg(1)]);
  const msgEffect = firstEffect(msg);
  applyUiEffect(state, "msgbox", msgEffect.args ?? []);
  const msgWait = msg.wait as Wait;
  equal(pollRenderMsgBox({ tick: 0, input: { keys: [{ seq: 4, name: "No", code: "KeyN", char: null }], focused: true }, claims: [] }, msgWait)?.value, 7);
});
test("menu.screen CallShop waits resolve only after active stock closes", () => {
  const wait: Wait = { kind: "menu.screen", global: true, id: "callshop", payload: [], resumeRefs: [] };
  equal(pollMenuScreen({ tick: 0, shopStock: ["item/potion.itm"] }, wait), null);
  deepEqual(pollMenuScreen({ tick: 1, shopStock: [] }, wait), { value: null, ok: true });
});

test("cursor maps allocate points, claim keys and draw the hand last", () => {
  const state = createGameState({ seed: 0 });
  const created = command("createcursormap", state, [arg(0, "map")]);
  equal(created.value, 1);
  applyUiEffect(state, "createcursormap", firstEffect(created).args ?? []);
  applyUiEffect(state, "cursormapadd", [10, 20, 1]);
  applyUiEffect(state, "cursormapadd", [50, 60, 1]);
  const run = command("cursormaprun", state, [arg(1)]);
  applyUiEffect(state, "cursormaprun", firstEffect(run).args ?? []);
  const wait = run.wait as Wait;
  equal(pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 1, name: "Right", code: "ArrowRight", char: null }], focused: true },
    claims: [],
  }, wait), null);
  const navigatedSelection = wait.kind === "input.key" ? wait.cursorSelection : undefined;
  const navigated = composeUi(state.ui, 100, 100, undefined, true, navigatedSelection);
  const navigatedHand = navigated.at(-1);
  equal(navigatedHand?.kind, "blit");
  if (navigatedHand?.kind === "blit") {
    equal(navigatedHand.dst.x, 10);
    equal(navigatedHand.dst.y, 50);
  }
  const result = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 2, name: "0", code: "Digit0", char: "0" }], focused: true },
    claims: [],
  }, wait);
  deepEqual(result, { value: 0, ok: true, claim: 2 });
  const commands = composeUi(state.ui, 100, 100);
  const hand = commands.at(-1);
  equal(hand?.kind, "blit");
  if (hand?.kind === "blit") {
    equal(hand.dst.x, -30);
    equal(hand.dst.y, 10);
  }
});

test("mouseCursor restores the bundled arrow and button slots stay in the overlay", () => {
  const state = createGameState({ seed: 0 });
  const cursor = command("mousecursor", state, [arg("TK DEFAULT"), arg(0), arg(0), arg(255), arg(0), arg(255)]);
  applyUiEffect(state, "mousecursor", firstEffect(cursor).args ?? []);
  state.input.pointer = { x: 12, y: 14, buttons: 0 };
  state.input.buttons = [{ slot: 1, asset: "button.png", x: 2, y: 3, width: 10, height: 11 }];
  const commands = composeUi(state.ui, 100, 100, state.input);
  const arrow = commands.at(-1);
  equal(arrow?.kind, "blit");
  if (arrow?.kind === "blit" && "asset" in arrow.source) equal(arrow.source.asset, "media/cursors/tkr-arrow.png");
  equal(commands.filter((entry) => entry.kind === "blit").length, 2);
});
