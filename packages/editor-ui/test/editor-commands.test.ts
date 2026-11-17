import { after, afterEach, before, test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createCommandRegistry } from "@tk-reawakened/editor-model";
import { connectEditorCommands } from "../dist/editor-commands.js";

before(() => GlobalRegistrator.register());
after(() => GlobalRegistrator.unregister());
let dispose = (): void => {};
afterEach(() => { dispose(); document.body.replaceChildren(); });
const settle = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };
function setup() {
  const scope = document.createElement("div");
  scope.innerHTML = '<div class="tkr-editor-slot"></div><button id="palette">Palette</button>';
  document.body.append(scope);
  const registry = createCommandRegistry();
  return { scope, slot: scope.firstElementChild as HTMLElement, registry };
}
function surface(title: string) {
  const el = document.createElement("div");
  el.setAttribute("data-tkr-editor", title);
  el.innerHTML = '<button aria-label="Draw" aria-keyshortcuts="D">icon</button><button data-editor-save>Save</button><button disabled>Undo</button>';
  return el;
}

test("editor commands execute the focused view and disappear on tab switch/close", async () => {
  const { scope, slot, registry } = setup();
  const board = surface("Board"); slot.append(board);
  dispose = connectEditorCommands(scope, registry);
  let draws = 0; board.querySelector('button')!.onclick = () => { draws++; };
  const draw = registry.filter('Board: Draw')[0]!;
  equal(draw.shortcut, "D"); equal(registry.execute(draw.id), true); equal(draws, 1);
  scope.querySelector<HTMLElement>('#palette')!.focus();
  equal(registry.filter('Board: Draw').length, 1, "palette focus retains editor context");
  slot.replaceChildren(surface("Program")); await settle();
  equal(registry.filter('Board:').length, 0); equal(registry.filter('Program: Draw').length, 1);
  draw.run(); equal(draws, 1, "a captured command cannot edit a detached view");
  slot.replaceChildren(); await settle();
  equal(registry.filter('Program:').length, 0);
  equal(registry.getCommands().find((entry) => entry.id === 'file.save')!.disabled, true);
  dispose(); equal(registry.getCommands().length, 0);
});

test("split views follow focus and reject commands captured from the background view", async () => {
  const { scope, slot, registry } = setup();
  const board = surface("Board"), art = surface("Tileset");
  slot.append(board, art); dispose = connectEditorCommands(scope, registry);
  const stale = registry.filter('Board: Draw')[0]!;
  let draws = 0; board.querySelector('button')!.onclick = () => { draws++; };
  art.querySelector('button')!.focus();
  equal(registry.filter('Board:').length, 0); equal(registry.filter('Tileset: Draw').length, 1);
  stale.run(); equal(draws, 0);
  art.hidden = true; await settle(); equal(registry.filter('Tileset:').length, 0);
  equal(registry.filter('Board: Draw').length, 1);
});

test("disabled actions and Save reflect current state and cannot bypass it", async () => {
  const { scope, slot, registry } = setup(); const board = surface("Board"); slot.append(board);
  dispose = connectEditorCommands(scope, registry);
  let saves = 0; const save = board.querySelector<HTMLButtonElement>('[data-editor-save]')!;
  save.onclick = () => { saves++; };
  equal(registry.execute('file.save'), true); equal(saves, 1);
  const captured = registry.getCommands().find((entry) => entry.id === 'file.save')!;
  save.setAttribute("aria-disabled", "true"); captured.run(); equal(saves, 1, "live disabled check before observer delivery");
  await settle(); equal(registry.execute('file.save'), false);
  const undo = registry.filter('Board: Undo')[0]!; equal(undo.disabled, true); equal(registry.execute(undo.id), false);
  save.removeAttribute("aria-disabled"); await settle(); equal(registry.execute('file.save'), true); equal(saves, 2);
});

test("collapsed actions reveal themselves; fields focus; data choices stay out of the palette", () => {
  const { scope, slot, registry } = setup(); const board = surface("Board");
  board.innerHTML += '<details><summary>Layers</summary><button>Show all</button><label>Background<input type="checkbox"></label></details><label for="layer">Layer</label><select id="layer"><option>1</option><option>2</option></select><div role="grid"><button>Tile 1</button></div><div role="listbox"><button>Asset</button></div><button hidden>Hidden action</button>';
  slot.append(board); dispose = connectEditorCommands(scope, registry);
  equal(registry.filter('Tile 1').length, 0); equal(registry.filter('Asset').length, 0); equal(registry.filter('Hidden action').length, 0);
  const all = registry.filter('Board: Show all')[0]!; ok(all); registry.execute(all.id);
  equal(board.querySelector('details')!.open, true);
  registry.execute(registry.filter('Board: Background')[0]!.id); equal(board.querySelector('input')!.checked, true);
  registry.execute(registry.filter('Board: Change Layer')[0]!.id); equal(document.activeElement, board.querySelector('select'));
});
