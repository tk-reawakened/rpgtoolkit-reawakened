import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  createSurfacesSection,
  getPixel,
  GRAPHICS_PLUGIN,
  type Arg,
  type CommandView,
} from "../src/index.ts";

function arg(value: unknown, ref: string | null = null): Arg {
  return { value: value as never, ref: ref as never };
}

function command(name: string) {
  const found = GRAPHICS_PLUGIN.commands.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing graphics command ${name}`);
  return found;
}

function view() {
  const state = createGameState({ seed: 1 });
  state.surfaces = createSurfacesSection(8, 8);
  const commandView: CommandView = { state, rng: { nextUint32: () => 0 }, clock: { tick: () => 0 }, gameId: "test-game" };
  return { state, commandView };
}

test("graphics pack registers all canvas and drawing names with the restore alias", () => {
  const names = GRAPHICS_PLUGIN.commands.flatMap((entry) => [entry.name, ...entry.aliases]);
  for (const name of ["createcanvas", "killcanvas", "drawcanvas", "drawcanvastransparent", "canvasdrawpart", "canvasgetscreen", "clear", "bitmap", "setimage", "setimagetransparent", "setimagetranslucent", "setimageadditive", "drawline", "drawrect", "fillrect", "drawcircle", "fillcircle", "setpixel", "getpixel", "savescreen", "restorescreen", "restorescreenarray", "restorearrayscreen", "rendernow", "viewbrd", "getres", "drawenemy"]) {
    equal(names.includes(name), true, name);
  }
});

test("drawing primitives mutate persistent canvases and getPixel writes all outputs", () => {
  const { state, commandView } = view();
  const create = command("createcanvas").call(commandView, [arg(4), arg(4), arg(0, "global:canvas")], () => ({ value: null }));
  const canvas = create.value as number;
  equal(typeof canvas, "number");
  command("setpixel").call(commandView, [arg(1), arg(1), arg(canvas)], () => ({ value: null }));
  command("drawline").call(commandView, [arg(0), arg(0), arg(3), arg(0), arg(canvas)], () => ({ value: null }));
  command("fillrect").call(commandView, [arg(2), arg(2), arg(3), arg(3), arg(canvas)], () => ({ value: null }));
  deepEqual(getPixel(state.surfaces, canvas as never, 1, 1), { r: 255, g: 255, b: 255 });
  deepEqual(getPixel(state.surfaces, canvas as never, 3, 3), { r: 255, g: 255, b: 255 });
  const output = command("getpixel").call(commandView, [arg(1), arg(1), arg(0, "global:r"), arg(0, "global:g"), arg(0, "global:b"), arg(canvas)], () => ({ value: null }));
  deepEqual(output.out, [[2, 255], [3, 255], [4, 255]]);
});

test("canvas blits, screen capture and numbered screen restore use surface revisions", () => {
  const { state, commandView } = view();
  const create = command("createcanvas").call(commandView, [arg(2), arg(2)], () => ({ value: null }));
  const canvas = create.value as number;
  command("setpixel").call(commandView, [arg(0), arg(0), arg(canvas)], () => ({ value: null }));
  command("drawcanvas").call(commandView, [arg(canvas), arg(2), arg(2)], () => ({ value: null }));
  equal(getPixel(state.surfaces, 0 as never, 2, 2)?.r, 255);
  command("savescreen").call(commandView, [arg(2)], () => ({ value: null }));
  command("clear").call(commandView, [], () => ({ value: null }));
  command("restorescreen").call(commandView, [arg(2)], () => ({ value: null }));
  equal(getPixel(state.surfaces, 0 as never, 2, 2)?.r, 255);
});
