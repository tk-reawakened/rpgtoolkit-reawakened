import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openSpriteDocument, type ApplyResult, type ExternalCheck, type PickOutcome, type SpriteCommand } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { SpriteViewDocument } from "../src/sprite-view.tsx";
import type { CharacterAuthoringViewProps } from "../src/character-authoring-view.tsx";
import { exampleCharacter, exampleItem } from "./fixtures.ts";

let renderView: (el: HTMLElement, props: CharacterAuthoringViewProps) => () => void;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  // Preact binds its event system to the host DOM, so import it only after happy-dom is installed.
  ({ act } = await import("preact/test-utils"));
  const [{ createElement, render }, { CharacterAuthoringView }] = await Promise.all([
    import("preact"), import("../dist/character-authoring-view.js"),
  ]);
  renderView = (el, props) => {
    render(createElement(CharacterAuthoringView, props), el);
    return () => render(null, el);
  };
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly doc: SpriteViewDocument;
  readonly el: HTMLElement;
  readonly unmount: () => void;
  readonly writeExternalAndCheck: (bytes: Uint8Array) => Promise<ExternalCheck>;
}

async function setup(
  bytes: Uint8Array = exampleCharacter(),
  services: Pick<CharacterAuthoringViewProps, "pickAsset" | "visit"> = {},
): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { "Chrs/hero.tem": bytes } });
  const opened = await openSpriteDocument("character", host.fs, createDocumentIdentity("memory-project", "Chrs/hero.tem"));
  if (!opened.ok) throw new Error(`could not open character: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  let unmount = (): void => {};
  await act(() => { unmount = renderView(el, { doc: opened.document, fs: host.fs, capabilities: host.capabilities, onEdited: () => {}, ...services }); });
  const writeExternalAndCheck = async (bytes: Uint8Array): Promise<ExternalCheck> => {
    const written = await host.fs.writeProject("memory-project", "Chrs/hero.tem", bytes);
    if (!written.ok) throw new Error(`could not replace the fixture: ${written.error.message}`);
    return opened.document.checkExternal();
  };
  return { doc: opened.document, el, unmount, writeExternalAndCheck };
}

async function editInput(el: HTMLElement, label: string, value: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`No input named ${label}`);
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => input.dispatchEvent(new Event("blur", { bubbles: true })));
}

async function clickButton(el: HTMLElement, label: string): Promise<void> {
  const button = el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`No button named ${label}`);
  await act(() => button.click());
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let complete: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => { complete = resolve; });
  return {
    promise,
    resolve(value) {
      if (complete === null) throw new Error("deferred promise resolver is not ready");
      complete(value);
    },
  };
}

test("character authoring edits bindings, starting stats, picture, move conditions, equipment and progression", async () => {
  const setupView = await setup();
  try {
    const unavailablePicker = setupView.el.querySelector<HTMLButtonElement>('button[aria-label="Choose profile bitmap…"]');
    ok(unavailablePicker);
    equal(unavailablePicker.disabled, true);
    ok(setupView.el.textContent?.includes("Asset picker unavailable here; enter a project reference above."));
    await editInput(setupView.el, "Character name", "Ariadne");
    await editInput(setupView.el, "Experience variable", "Hero[experience]!");
    await editInput(setupView.el, "Health (HP)", "125");
    await editInput(setupView.el, "Profile picture reference", "hero.bmp");
    await editInput(setupView.el, "Special-move category", "Arts");
    await editInput(setupView.el, "Experience for first level-up", "300");
    await editInput(setupView.el, "Level-up program", "level-up.rnc");
    const specialMoves = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Character has special moves"]');
    ok(specialMoves);
    const specialMovesValue = setupView.doc.getSnapshot().character?.hasSpecialMoves === 0 ? "1" : "0";
    await act(() => {
      specialMoves.value = specialMovesValue;
      specialMoves.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const levelUpType = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Level-up type"]');
    ok(levelUpType);
    const levelUpTypeValue = setupView.doc.getSnapshot().character?.levelUpType === 0 ? "1" : "0";
    await act(() => {
      levelUpType.value = levelUpTypeValue;
      levelUpType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await editInput(setupView.el, "Accessory 1 slot name", "Ring");
    await editInput(setupView.el, "Maximum level (0 disables progression)", "80");
    await editInput(setupView.el, "HP increase per level", "7");

    const moveSlot = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Special-move slot"]');
    ok(moveSlot);
    await act(() => {
      moveSlot.value = "12";
      moveSlot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await editInput(setupView.el, "Special-move file", "meteor.spc");
    await editInput(setupView.el, "Minimum experience", "900");
    await editInput(setupView.el, "Minimum level", "9");
    await editInput(setupView.el, "Condition variable", "Quest[meteor]!");
    await editInput(setupView.el, "Required variable value", "ready");
    const saveMove = [...setupView.el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Apply special-move slot 12");
    ok(saveMove);
    await act(() => saveMove.click());
    await settle();

    const bodySlot = setupView.el.querySelector<HTMLInputElement>('input[aria-label="Head body slot used"]');
    ok(bodySlot);
    await act(() => {
      bodySlot.checked = true;
      bodySlot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const edited = setupView.doc.getSnapshot().character;
    ok(edited);
    equal(edited.specialMoveCategory, "Arts");
    equal(edited.hasSpecialMoves, Number(specialMovesValue));
    equal(edited.firstLevelExp, 300);
    equal(edited.levelUpProgram, "level-up.rnc");
    equal(edited.levelUpType, Number(levelUpTypeValue));
    equal(edited.name, "Ariadne");
    equal(edited.variableNames[0], "Hero[experience]!");
    equal(edited.stats.hp, 125);
    equal(edited.profilePicture, "hero.bmp");
    deepEqual(edited.specialMoves[12], { file: "meteor.spc", minExp: 900, minLevel: 9, condVar: "Quest[meteor]!", condValue: "ready" });
    equal(edited.accessorySlots[1], "Ring");
    equal(edited.bodySlots[1], 1);
    equal(edited.maxLevel, 80);
    equal(edited.levelIncreases[0], 7);
    ok(setupView.doc.getSnapshot().edits.some((edit) => edit.command.type === "set-character-move"));
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});
test("project asset pickers leave cancelled references unchanged and support linked special-move authoring", async () => {
  const requests: Array<Parameters<NonNullable<CharacterAuthoringViewProps["pickAsset"]>>[0]> = [];
  const visited: string[] = [];
  const outcomes: PickOutcome[] = [
    { chosen: false },
    { chosen: true, reference: "hero.bmp" },
    { chosen: true, reference: "portrait.tan" },
    { chosen: true, reference: "levelup.prg" },
    { chosen: true, reference: "meteor.spc" },
  ];
  const setupView = await setup(exampleCharacter(), {
    pickAsset: async (request) => {
      requests.push(request);
      const outcome = outcomes.shift();
      if (outcome === undefined) throw new Error("unexpected asset picker request");
      return outcome;
    },
    visit: async (path) => {
      visited.push(path);
      return { ok: true, path };
    },
  });
  try {
    const initialPicture = setupView.doc.getSnapshot().character?.profilePicture;
    await clickButton(setupView.el, "Choose profile bitmap…");
    await settle();
    equal(setupView.doc.getSnapshot().character?.profilePicture, initialPicture);

    await clickButton(setupView.el, "Choose profile bitmap…");
    await settle();
    equal(setupView.doc.getSnapshot().character?.profilePicture, "hero.bmp");
    await clickButton(setupView.el, "Choose profile tile…");
    await settle();
    equal(setupView.doc.getSnapshot().character?.profilePicture, "portrait.tan");
    await clickButton(setupView.el, "Choose level-up program");
    await settle();
    equal(setupView.doc.getSnapshot().character?.levelUpProgram, "levelup.prg");
    await clickButton(setupView.el, "Open level-up program");
    await settle();
    const slot = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Special-move slot"]');
    ok(slot);
    await act(() => {
      slot.value = "12";
      slot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clickButton(setupView.el, "Choose special-move file…");
    await settle();
    equal(setupView.el.querySelector<HTMLInputElement>('input[aria-label="Special-move file"]')?.value, "meteor.spc");
    await clickButton(setupView.el, "Apply special-move slot 12");
    await settle();
    equal(setupView.doc.getSnapshot().character?.specialMoves[12]?.file, "meteor.spc");
    await clickButton(setupView.el, "Open special-move file");
    await settle();

    deepEqual(requests.map(({ kind, extensions }) => ({ kind, extensions })), [
      { kind: "bitmaps", extensions: [".bmp", ".png", ".jpg", ".gif", ".tbm"] },
      { kind: "bitmaps", extensions: [".bmp", ".png", ".jpg", ".gif", ".tbm"] },
      { kind: "tiles", extensions: [".tan", ".gph"] },
      { kind: "programs", extensions: [".prg"] },
      { kind: "specialMoves", extensions: [".spc"] },
    ]);
    deepEqual(visited, ["Prg/levelup.prg", "SpcMove/meteor.spc"]);
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("an asset picker result cannot replace a reference typed while the picker is open", async () => {
  const gate = deferred<PickOutcome>();
  const setupView = await setup(exampleCharacter(), { pickAsset: () => gate.promise });
  try {
    await clickButton(setupView.el, "Choose profile bitmap…");
    await editInput(setupView.el, "Profile picture reference", "typed-while-open.bmp");
    await act(() => gate.resolve({ chosen: true, reference: "picked.bmp" }));
    await settle();
    equal(setupView.doc.getSnapshot().character?.profilePicture, "typed-while-open.bmp");
    equal(setupView.el.querySelector<HTMLInputElement>('input[aria-label="Profile picture reference"]')?.value, "typed-while-open.bmp");
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});


test("a delayed acknowledgement preserves a newer character draft and distinct field edits", async () => {
  const setupView = await setup();
  try {
    const originalApply = setupView.doc.apply.bind(setupView.doc);
    const acknowledgements: Array<() => void> = [];
    setupView.doc.apply = (command: SpriteCommand): ApplyResult | Promise<ApplyResult> => {
      const gate = deferred<ApplyResult>();
      acknowledgements.push(() => { void Promise.resolve(originalApply(command)).then(gate.resolve); });
      return gate.promise;
    };
    await editInput(setupView.el, "Character name", "First name");
    await settle();
    if (acknowledgements.length === 0) throw new Error("the character edit was not submitted");
    await act(() => {
      const name = setupView.el.querySelector<HTMLInputElement>('input[aria-label="Character name"]');
      ok(name);
      name.value = "Newer draft";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const finish = acknowledgements.shift();
    if (finish === undefined) throw new Error("the character edit was not waiting for acknowledgement");
    await act(() => finish());
    await settle();
    equal(setupView.doc.getSnapshot().character?.name, "First name");
    equal(setupView.el.querySelector<HTMLInputElement>('input[aria-label="Character name"]')?.value, "Newer draft");

    setupView.doc.apply = (command: SpriteCommand): ApplyResult | Promise<ApplyResult> => Promise.resolve(originalApply(command));
    await editInput(setupView.el, "Health (HP)", "123");
    await settle();
    equal(setupView.doc.getSnapshot().character?.name, "First name");
    equal(setupView.doc.getSnapshot().character?.stats.hp, 123);
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("queued special-move edits compose independently edited fields", async () => {
  const setupView = await setup();
  try {
    const initialMove = setupView.doc.getSnapshot().character?.specialMoves[12];
    if (initialMove === undefined) throw new Error("character move slot 12 is missing");
    const applyOriginal = setupView.doc.apply.bind(setupView.doc);
    const acknowledgements: Array<() => void> = [];
    setupView.doc.apply = (command: SpriteCommand): ApplyResult | Promise<ApplyResult> => {
      const gate = deferred<ApplyResult>();
      acknowledgements.push(() => { void Promise.resolve(applyOriginal(command)).then(gate.resolve); });
      return gate.promise;
    };
    const slot = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Special-move slot"]');
    ok(slot);
    await act(() => {
      slot.value = "12";
      slot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await editInput(setupView.el, "Special-move file", "meteor.spc");
    const save = (): void => {
      const button = [...setupView.el.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "Apply special-move slot 12");
      if (button === undefined) throw new Error("special-move save button was not rendered");
      button.click();
    };
    await act(save);
    await settle();
    equal(acknowledgements.length, 1);

    await editInput(setupView.el, "Condition variable", "Quest[meteor]!");
    await act(save);
    const first = acknowledgements.shift();
    if (first === undefined) throw new Error("the first move command is not waiting for acknowledgement");
    await act(() => first());
    await settle();
    equal(setupView.doc.getSnapshot().character?.specialMoves[12]?.file, "meteor.spc");
    equal(acknowledgements.length, 1);

    const second = acknowledgements.shift();
    if (second === undefined) throw new Error("the queued move command was not applied");
    await act(() => second());
    await settle();
    deepEqual(setupView.doc.getSnapshot().character?.specialMoves[12], {
      ...initialMove, file: "meteor.spc", condVar: "Quest[meteor]!",
    });
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("discrete controls retain the latest choice while earlier acknowledgements are held", async () => {
  const setupView = await setup();
  try {
    const initial = setupView.doc.getSnapshot().character;
    if (initial === null) throw new Error("character fields are missing");
    const initialMovesEnabled = initial.hasSpecialMoves;
    const initialBodySlot = initial.bodySlots[1] ?? 0;
    const initialLevelUpType = initial.levelUpType;
    const applyOriginal = setupView.doc.apply.bind(setupView.doc);
    const acknowledgements: Array<() => void> = [];
    setupView.doc.apply = (command: SpriteCommand): ApplyResult | Promise<ApplyResult> => {
      const result = Promise.resolve(applyOriginal(command));
      const gate = deferred<ApplyResult>();
      acknowledgements.push(() => { void result.then(gate.resolve); });
      return gate.promise;
    };

    const changeSelect = async (label: string, value: number): Promise<void> => {
      const select = setupView.el.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      if (select === null) throw new Error(`No select named ${label}`);
      await act(() => {
        select.value = String(value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    const movesFirst = initialMovesEnabled === 0 ? 1 : 0;
    await changeSelect("Character has special moves", movesFirst);
    await changeSelect("Character has special moves", initialMovesEnabled);
    const bodyInput = setupView.el.querySelector<HTMLInputElement>('input[aria-label="Head body slot used"]');
    ok(bodyInput);
    const bodyFirst = initialBodySlot === 0 ? 1 : 0;
    await act(() => {
      bodyInput.checked = bodyFirst !== 0;
      bodyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => {
      bodyInput.checked = initialBodySlot !== 0;
      bodyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const levelTypeFirst = initialLevelUpType === 0 ? 1 : 0;
    await changeSelect("Level-up type", levelTypeFirst);
    await changeSelect("Level-up type", initialLevelUpType);
    await settle();
    equal(acknowledgements.length, 1);

    for (let index = 0; index < 6; index += 1) {
      const acknowledge = acknowledgements.shift();
      if (acknowledge === undefined) throw new Error(`discrete command ${index + 1} was not waiting for acknowledgement`);
      await act(() => acknowledge());
      await settle();
    }
    equal(setupView.doc.getSnapshot().character?.hasSpecialMoves, initialMovesEnabled);
    equal(setupView.doc.getSnapshot().character?.bodySlots[1], initialBodySlot);
    equal(setupView.doc.getSnapshot().character?.levelUpType, initialLevelUpType);
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("conflict reload clears character drafts and invalidates queued character commands", async () => {
  const setupView = await setup();
  try {
    const initialMove = setupView.doc.getSnapshot().character?.specialMoves[12];
    if (initialMove === undefined) throw new Error("character move slot 12 is missing");
    const local = await setupView.doc.apply({ type: "set-character-text", field: "name", value: "Local edit" });
    ok(local.ok);

    const externalHost = createMemoryPlatformServices({ files: { "Chrs/remote.tem": exampleCharacter() } });
    const external = await openSpriteDocument("character", externalHost.fs, createDocumentIdentity("memory-project", "Chrs/remote.tem"));
    if (!external.ok) throw new Error("could not open the external character fixture");
    const externalRename = external.document.apply({ type: "set-character-text", field: "name", value: "Disk version" });
    ok(externalRename.ok);
    const externalBytes = external.document.serialize();

    const applyOriginal = setupView.doc.apply.bind(setupView.doc);
    const acknowledgements: Array<() => void> = [];
    setupView.doc.apply = (command: SpriteCommand): ApplyResult | Promise<ApplyResult> => {
      const result = Promise.resolve(applyOriginal(command));
      const gate = deferred<ApplyResult>();
      acknowledgements.push(() => { void result.then(gate.resolve); });
      return gate.promise;
    };
    const slot = setupView.el.querySelector<HTMLSelectElement>('select[aria-label="Special-move slot"]');
    ok(slot);
    await act(() => {
      slot.value = "12";
      slot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await editInput(setupView.el, "Special-move file", "stale.spc");
    const saveMove = (): void => {
      const button = [...setupView.el.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "Apply special-move slot 12");
      if (button === undefined) throw new Error("special-move save button was not rendered");
      button.click();
    };
    await act(saveMove);
    await settle();
    equal(acknowledgements.length, 1);
    await editInput(setupView.el, "Condition variable", "stale-condition");
    await act(saveMove);

    equal(await setupView.writeExternalAndCheck(externalBytes), "conflict");
    await act(async () => {
      const result = await setupView.doc.resolveConflict("reload");
      ok(result.ok);
    });
    await settle();
    const acknowledge = acknowledgements.shift();
    if (acknowledge === undefined) throw new Error("the in-flight command was not waiting for acknowledgement");
    await act(() => acknowledge());
    await settle();

    equal(acknowledgements.length, 0);
    equal(setupView.doc.getSnapshot().character?.name, "Disk version");
    deepEqual(setupView.doc.getSnapshot().character?.specialMoves[12], initialMove);
    equal(setupView.el.querySelector<HTMLInputElement>('input[aria-label="Special-move file"]')?.value, initialMove.file);
    equal(setupView.el.querySelector<HTMLInputElement>('input[aria-label="Condition variable"]')?.value, initialMove.condVar);
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("numeric fields reject values outside their on-disk integer widths before applying", async () => {
  const standard = await setup();
  try {
    const initialHp = standard.doc.getSnapshot().character?.stats.hp;
    if (initialHp === undefined) throw new Error("character HP stat is missing");
    await editInput(standard.el, "Health (HP)", "2147483648");
    await settle();
    equal(standard.doc.getSnapshot().character?.stats.hp, initialHp);
    equal(standard.doc.getSnapshot().edits.length, 0);
    ok(standard.el.querySelector('[aria-label="Character edit status"]')?.textContent?.includes("whole number"));
  } finally {
    standard.unmount();
    standard.el.remove();
  }

  const minorThree = await setup(exampleCharacter(3));
  try {
    const firstLevelExp = minorThree.doc.getSnapshot().character?.firstLevelExp;
    if (firstLevelExp === undefined) throw new Error("first-level experience is missing");
    await editInput(minorThree.el, "Experience for first level-up", "128");
    await settle();
    equal(minorThree.doc.getSnapshot().character?.firstLevelExp, firstLevelExp);
    equal(minorThree.doc.getSnapshot().edits.length, 0);
    ok(minorThree.el.querySelector('[aria-label="Character edit status"]')?.textContent?.includes("0 to 127"));
  } finally {
    minorThree.unmount();
    minorThree.el.remove();
  }
});

test("runtime progression ranges reject negative stat and growth edits", async () => {
  const setupView = await setup();
  try {
    const labels = [
      "Experience",
      "Level",
      "Experience for first level-up",
      "Experience increase per level",
      "Maximum level (0 disables progression)",
      "HP increase per level",
      "DP increase per level",
      "FP increase per level",
      "SMP increase per level",
    ];
    for (const label of labels) {
      const input = setupView.el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      ok(input);
      equal(input.min, "0");
      await editInput(setupView.el, label, "-1");
      await settle();
      ok(setupView.el.querySelector('[aria-label="Character edit status"]')?.textContent?.includes("0 to"));
      equal(setupView.doc.getSnapshot().edits.length, 0);
    }
  } finally {
    setupView.unmount();
    setupView.el.remove();
  }
});

test("items expose no character-only authoring fields", async () => {
  const host = createMemoryPlatformServices({ files: { "Item/chest.itm": exampleItem() } });
  const opened = await openSpriteDocument("item", host.fs, createDocumentIdentity("memory-project", "Item/chest.itm"));
  if (!opened.ok) throw new Error(`could not open item: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  let unmount = (): void => {};
  try {
    await act(() => { unmount = renderView(el, { doc: opened.document, fs: host.fs, capabilities: host.capabilities, onEdited: () => {} }); });
    equal(el.querySelector("fieldset"), null);
    equal(el.textContent?.includes("no character-only fields"), true);
  } finally {
    unmount();
    el.remove();
  }
});
