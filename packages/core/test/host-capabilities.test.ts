import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, createGameState, PACKAGE_ROOT, queueNativeEvent, readEvent, writeBoard, type GameState } from "../src/index.ts";
import { configureMainFileMovement } from "../src/input/input.ts";
import { mainFileMovementSettings } from "../src/input/movement-settings.ts";
import { restoreGameState, snapshot } from "../src/save/index.ts";

const updatedGeometry = {
  content: { width: 1280, height: 720 },
  game: { x: 160, y: 0, width: 960, height: 720 },
  safeArea: { top: 8, right: 0, bottom: 12, left: 0 },
} as const;

function makeEngine() {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  const live: { state: GameState | null } = { state: null };
  const engine = createEngine({
    seed: 9,
    assetIndex: createAssetIndex(["Boards/host.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "host.brd",
    width: 320,
    height: 240,
    maxTicks: 20,
    features: { touch: true, pointer: "coarse", keyboard: true, gamepad: false, haptics: false, orientation: "portrait" },
    displayGeometry: {
      content: { width: 640, height: 480 },
      game: { x: 0, y: 0, width: 640, height: 480 },
      safeArea: { top: 4, right: 0, bottom: 8, left: 0 },
    },
    program: `
seenTouch = hasFeature("TOUCH")
seenPointer = pointerType()
seenWidth = viewWidth()
seenHeight = viewHeight()
seenMarginTop = marginWidth("TOP")
seenKeyboard = hasFeature("keyboard")
seenGamepad = hasFeature("gamepad")
seenPointerFeature = hasFeature("pointer")
seenHaptics = hasFeature("haptics")
seenOrientation = hasFeature("orientation")
seenSafeBottom = safeAreaInset("bottom")
seenAspect = displayAspect()
seenUnknown = hasFeature("unknown")
viewportCount = 0
gamepadConnected = 0
gamepadDisconnected = 0
on(game, "viewportResized", (event) => {
  viewportCount = viewportCount + 1
  resizedRightQuery = marginWidth("right")
  resizedSafeBottomQuery = safeAreaInset("bottom")
  resizedRight = event.detail.marginRight
  resizedSafeBottom = event.detail.safeAreaBottom
})
on(game, "device.connected", (event) => {
  if (event.detail.type == "gamepad") {
    gamepadConnected = gamepadConnected + 1
    connectedDevice = event.detail.device
  }
})
on(game, "device.disconnected", (event) => {
  if (event.detail.type == "gamepad") {
    gamepadDisconnected = gamepadDisconnected + 1
    disconnectedDevice = event.detail.device
  }
})
`,
    phaseRegistrations: [{ phase: "movement", run: (state) => { live.state = state; } }],
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected host fixture board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  return { engine, live };
}

function globalsOf(live: { state: GameState | null }): GameState["vm"]["globals"] {
  if (live.state === null) throw new Error("expected a live engine state");
  return live.state.vm.globals;
}

test("host query built-ins read normalized capabilities and geometry through RPGCode", () => {
  const { engine, live } = makeEngine();
  engine.advance(1, []);
  const globals = globalsOf(live);
  equal(globals.seentouch, 1);
  equal(globals.seenpointer, "coarse");
  equal(globals.seenwidth, 320);
  equal(globals.seenheight, 240);
  equal(globals.seenmargintop, 0);
  equal(globals.seensafebottom, 4);
  equal(globals.seenaspect, 4 / 3);
  equal(globals.seenunknown, 0);
  equal(globals.seenkeyboard, 1);
  equal(globals.seengamepad, 0);
  equal(globals.seenpointerfeature, 1);
  equal(globals.seenhaptics, 0);
  equal(globals.seenorientation, 1);
});

test("Engine hostDisplayGeometry returns the last consumed geometry as fresh plain data", () => {
  const { engine } = makeEngine();
  const initial = engine.hostDisplayGeometry();
  deepEqual(initial, {
    content: { width: 640, height: 480 },
    game: { x: 0, y: 0, width: 640, height: 480 },
    safeArea: { top: 4, right: 0, bottom: 8, left: 0 },
  });
  const report = engine.advance(1, [{ tick: 0, event: { kind: "host.display", geometry: updatedGeometry } }]);
  equal(report.consumed[0]?.event.kind, "host.display");
  const current = engine.hostDisplayGeometry();
  deepEqual(current, updatedGeometry);
  equal(current === engine.hostDisplayGeometry(), false);
  equal(current.game === engine.hostDisplayGeometry().game, false);
});

test("viewport changes and gamepad connection edges queue script-visible game events", () => {
  const { engine, live } = makeEngine();
  engine.advance(1, []);
  const startTick = engine.advance(0, []).tickAfter;
  const result = engine.advance(1, [
    { tick: startTick, event: { kind: "host.display", geometry: updatedGeometry } },
    { tick: startTick, event: { kind: "host.display", geometry: updatedGeometry } },
    { tick: startTick, event: { kind: "gamepad", device: 2, connected: true, axes: { x: 0, y: 0 }, buttons: 0 } },
    { tick: startTick, event: { kind: "gamepad", device: 2, connected: true, axes: { x: 0, y: 0 }, buttons: 0 } },
    { tick: startTick, event: { kind: "gamepad", device: 3, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } },
  ]);
  deepEqual(result.consumed.map((record) => record.event.kind), ["host.display", "host.display", "gamepad", "gamepad", "gamepad"]);
  let globals = globalsOf(live);
  equal(globals.viewportcount, 1);
  equal(globals.resizedright, 53);
  equal(globals.resizedsafebottom, 4);
  equal(globals.resizedrightquery, 53);
  equal(globals.resizedsafebottomquery, 4);
  equal(globals.gamepadconnected, 1);
  equal(globals.connecteddevice, 2);

  const disconnected = engine.advance(1, [{ tick: result.tickAfter, event: { kind: "gamepad", device: 2, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } }]);
  globals = globalsOf(live);
  equal(globals.gamepaddisconnected, 1);
  equal(globals.disconnecteddevice, 2);
  equal(globals.viewportcount, 1, "an unchanged geometry update must not create a resize event");
  equal(disconnected.consumed.length, 1);
});
test("disabled pad records remain logged without mutating restored pads or dispatching transitions", () => {
  const { engine, live } = makeEngine();
  engine.advance(1, []);
  const initialTick = engine.advance(0, []).tickAfter;
  engine.advance(1, [
    { tick: initialTick, event: { kind: "gamepad", device: 2, connected: true, axes: { x: 1000, y: 0 }, buttons: 1 } },
  ]);
  const state = live.state;
  if (state === null) throw new Error("expected live engine state");
  const saved = snapshot(state);
  const savedInput = restoreGameState(saved).input;
  equal(savedInput.gamepads["2"]?.connected, true, "the enabled-session save contains a real connected pad");
  // Restore first, then apply the disabled main-file policy, matching the engine's restore/configure order.
  Object.assign(state.input, savedInput);
  const disabledPolicy = mainFileMovementSettings({
    ...createEmptyMainFile(), minor: 9, movementControls: 0, useJoystick: 0,
  }, "main.gam").settings;
  equal(disabledPolicy.controllerEnabled, false);
  configureMainFileMovement(state.input, disabledPolicy);
  equal(state.input.gamepads["2"], undefined, "applying disabled policy clears the restored pad");
  equal(state.input.actions.right, false, "applying disabled policy clears its held action");
  const baseline = createGameState({ seed: 1 });
  baseline.input = state.input;
  const before = restoreGameState(snapshot(baseline)).input;
  const disabledTick = engine.advance(0, []).tickAfter;
  const tick = engine.advance(1, [
    { tick: disabledTick, event: { kind: "gamepad", device: 3, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 1 } },
    { tick: disabledTick, event: { kind: "gamepad", device: 3, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } },
  ]);
  deepEqual(tick.consumed.map((record) => record.event), [
    { kind: "gamepad", device: 3, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 1 },
    { kind: "gamepad", device: 3, connected: false, axes: { x: 0, y: 0 }, buttons: 0 },
  ], "disabled raw gamepad records remain in the engine's consumed log");
  deepEqual(state.input.gamepads, before.gamepads);
  deepEqual(state.input.actions, before.actions);
  deepEqual(state.input.actionPadMasks, before.actionPadMasks);
  deepEqual(state.input.semanticActionSources, before.semanticActionSources);
  deepEqual(state.input.pendingActions, before.pendingActions);
  const globals = globalsOf(live);
  equal(globals.gamepadconnected, 1, "disabled connect does not dispatch a connection callback");
  equal(globals.gamepaddisconnected, 0, "disabled disconnect does not dispatch a disconnection callback");
});


test("native viewport listeners receive the documented detail field names", () => {
  const state = createGameState({ seed: 9 });
  const handle = queueNativeEvent(state.vm, state.events, "game", "viewportResized", {
    marginleft: 1, marginright: 2, margintop: 3, marginbottom: 4,
    safearealeft: 5, safearearight: 6, safeareatop: 7, safeareabottom: 8,
  });
  const event = readEvent(state, { kind: "object", handle, className: "" });
  deepEqual(event?.detail, {
    marginLeft: 1, marginRight: 2, marginTop: 3, marginBottom: 4,
    safeAreaLeft: 5, safeAreaRight: 6, safeAreaTop: 7, safeAreaBottom: 8,
  });
});
