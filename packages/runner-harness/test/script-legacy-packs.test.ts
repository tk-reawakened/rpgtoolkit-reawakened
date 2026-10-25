import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

const ok = (value: unknown, message?: string): void => equal(Boolean(value), true, message);
import {
  ENGINE_DEFAULT_MANIFEST,
  getDeclinedPluginDiagnostic,
  type PluginDefinition,
} from "@tk-reawakened/core";
import { createScriptHost } from "../src/index.ts";

test("headless runner executes native pack commands from default manifest and records effects", () => {
  const host = createScriptHost({
    program: [
      'giveDp("Hero", 25)',
      // Battle stat aliases are actor-owner operations rather than legacy GsMisc effects.
      "getDirection(0, dir)",
      "getPlayerCoords(px, py)",
      'drawText("Greetings", 10, 20, "#ffffff")',
      'fontProperties("main.fnt", 14, 1, 0, 0)',
      'w = getTextWidth("Greetings", "main.fnt", 14)',
      'msg = lprintf("Hero score: %d", 500)',
      'length = litlen("characters")',
      'sub = litncpy("", "long string", 4)',
      'xfmwin("Quest started")',
      'fadeMidiIn("town.mid", 3)',
      'twsetbutton(1, "btn.png", 50, 50)',
      "end()",
    ].join("\n"),
    seed: 1234,
  });

  const report = host.advance(1, []);
  equal(report.diagnostics.length, 0);

  const globals = host.state().vm.globals;
  equal(globals.length, 10);
  equal(globals.sub, "long");
  equal(globals.w, 72);
  equal(globals.msg, "Hero score: 500");

  const effects = host.state().vm.effects;
  equal(effects.length >= 9, true);

  // Check GsMisc effects
  const dpEffect = effects.find((e) => e.name === "givedp");
  ok(dpEffect !== undefined);
  equal(dpEffect?.patch?.section, "party");
  deepEqual(dpEffect?.args, ["Hero", 25]);

  // Check Triuken effect
  const drawEffect = effects.find((e) => e.name === "drawtext");
  ok(drawEffect !== undefined);
  equal(drawEffect?.patch?.section, "surfaces");

  // Check XFMWin effect
  const xfmEffect = effects.find((e) => e.name === "xfmwin");
  ok(xfmEffect !== undefined);
  equal(xfmEffect?.patch?.section, "ui");

  // Check Kaimu effect
  const kaimuEffect = effects.find((e) => e.name === "fademidiin");
  ok(kaimuEffect !== undefined);
  equal(kaimuEffect?.patch?.section, "audio");

  // Check TWButton effect
  const btnEffect = effects.find((e) => e.name === "twsetbutton");
  ok(btnEffect !== undefined);
  equal(btnEffect?.patch?.section, "ui");
});

test("filereadwrite commands emit sandboxed saveBlob host requests", () => {
  const host = createScriptHost({
    program: [
      'fileWrite("logs", "state.txt", "entry1", "entry2")',
      "end()",
    ].join("\n"),
    seed: 1,
    gameId: "demo-game",
  });

  const report = host.advance(1, []);
  equal(report.diagnostics.length, 0);

  const writeEffect = host.state().vm.effects.find((e) => e.name === "filewrite");
  ok(writeEffect !== undefined);
  equal(writeEffect?.patch?.section, "vm");
  deepEqual(writeEffect?.args, ["demo-game/logs/state.txt"]);
});

test("native packs in default manifest can be removed or disabled by user manifest patch", () => {
  // 1. Remove gsmisc pack
  const withoutGsmisc = createScriptHost({
    program: 'giveDp("Hero", 10)\nend()',
    seed: 1,
    patch: [{ op: "remove", id: "gsmisc" }],
  });
  const reportNoGsmisc = withoutGsmisc.advance(1, []);
  // Without gsmisc, giveDp is unknown or catalogue fallback stub
  const dpEffect = withoutGsmisc.state().vm.effects.find((e) => e.name === "givedp");
  equal(dpEffect, undefined);

  // 2. Disable triuken pack
  const withoutTriuken = createScriptHost({
    program: 'drawText("test", 0, 0)\nend()',
    seed: 1,
    patch: [{ op: "disable", id: "triuken" }],
  });
  withoutTriuken.advance(1, []);
  const drawEffect = withoutTriuken.state().vm.effects.find((e) => e.name === "drawtext");
  equal(drawEffect, undefined);
});

test("native pack commands can be wrapped by user plugin using next", () => {
  const customPlugin: PluginDefinition = {
    id: "custom-wrapper",
    version: "1.0.0",
    commands: [
      {
        name: "litlen",
        aliases: [],
        params: [{ name: "str", optional: false, byRef: false, variadic: false }],
        call: (view, args, next) => {
          const lower = next(view, args, next);
          return { value: Number(lower.value) + 1000 };
        },
      },
    ],
  };

  const host = createScriptHost({
    program: 'result = litlen("test")\nend()',
    seed: 1,
    plugins: [customPlugin],
    patch: [{ op: "append", entry: { id: "custom-wrapper" } }],
  });

  host.advance(1, []);
  equal(host.state().vm.globals.result, 1004);
});

test("TK2 programs run native pack commands headlessly with TK2 frontend", () => {
  const host = createScriptHost({
    program: [
      '#GiveDP("Hero", 30)',
      '#DrawText("Legacy TK2", 5, 10, "red")',
      '#XFMWin("Hello from TK2")',
      "x = 0",
    ].join("\n"),
    seed: 2,
    dialect: "tk2",
  });

  const report = host.advance(1, []);
  equal(report.diagnostics.length, 0);

  const effects = host.state().vm.effects;
  const dp = effects.find((e) => e.name === "givedp");
  ok(dp !== undefined);
  deepEqual(dp?.args, ["Hero", 30]);

  const draw = effects.find((e) => e.name === "drawtext");
  ok(draw !== undefined);
});

test("declined legacy plugins report located not-supported diagnostics without crashing", () => {
  const diag = getDeclinedPluginDiagnostic("FTP.dll", "main.gam", 1);
  ok(diag !== undefined);
  equal(diag?.code, "plugin.declined-network");
  equal(diag?.path, "main.gam");
  equal(diag?.index, 1);
  equal(diag?.message.includes("41 corpus programs"), true);
});
