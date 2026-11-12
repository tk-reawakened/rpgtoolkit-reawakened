import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  FILEREADWRITE_PLUGIN,
  getDeclinedPluginDiagnostic,
  GSMISC_PLUGIN,
  KAIMU_PLUGIN,
  LEGACY_PLUGIN_TABLE,
  lookupLegacyPlugin,
  NATIVE_PACK_TABLE,
  NATIVE_PACKS,
  PROPLUG_PLUGIN,
  TRIUKEN_PLUGIN,
  TWBUTTON_PLUGIN,
  XFMWIN_PLUGIN,
  type Arg,
  type CommandView,
  type RefId,
} from "../src/index.ts";
const ok = (value: unknown, message?: string): void => equal(Boolean(value), true, message);
const asRef = (id: string): RefId => id as RefId;

const dummyView: CommandView = {
  rng: { nextUint32: () => 0 },
  clock: { tick: () => 42 },
  gameId: "test-game",
  state: {
    schema: 1,
    world: { board: "village.brd", layer: 0, title: "Village" } as never,
  } as never,
};

test("legacy plugin table contains all corpus identities and occurrences", () => {
  equal(LEGACY_PLUGIN_TABLE.length >= 25, true);

  const triuken = lookupLegacyPlugin("Triuken's Plugin Pack");
  ok(triuken !== undefined);
  equal(triuken?.status, "native");
  equal(triuken?.packId, "triuken");
  equal(triuken?.occurrences, 71);
  equal(triuken?.sourceFiles, 10);
  equal(triuken?.packages, 6);

  const gsmisc = lookupLegacyPlugin("GsMiscPlugins.dll");
  ok(gsmisc !== undefined);
  equal(gsmisc?.status, "native");
  equal(gsmisc?.packId, "gsmisc");
  equal(gsmisc?.occurrences, 57);
  equal(gsmisc?.sourceFiles, 14);
  equal(gsmisc?.packages, 7);

  const filereadwrite = lookupLegacyPlugin("filereadwrite.dll");
  ok(filereadwrite !== undefined);
  equal(filereadwrite?.status, "native");
  equal(filereadwrite?.packId, "filereadwrite");
  equal(filereadwrite?.occurrences, 47);

  const ftp = lookupLegacyPlugin("FTP.dll");
  ok(ftp !== undefined);
  equal(ftp?.status, "declined");
  equal(ftp?.occurrences, 41);
  equal(ftp?.sourceFiles, 15);

  const xfmwin = lookupLegacyPlugin("XFMWin.dll");
  ok(xfmwin !== undefined);
  equal(xfmwin?.status, "native");
  equal(xfmwin?.packId, "xfmwin");
  equal(xfmwin?.occurrences, 16);

  const proplug = lookupLegacyPlugin("proplug.dll");
  ok(proplug !== undefined);
  equal(proplug?.status, "native");
  equal(proplug?.packId, "proplug");
  equal(proplug?.occurrences, 13);

  const email = lookupLegacyPlugin("E-Mail.dll");
  ok(email !== undefined);
  equal(email?.status, "declined");
  equal(email?.occurrences, 10);

  const twbutton = lookupLegacyPlugin("TWButton.dll");
  ok(twbutton !== undefined);
  equal(twbutton?.status, "native");
  equal(twbutton?.packId, "twbutton");
  equal(twbutton?.occurrences, 6);

  const multip = lookupLegacyPlugin("multip.dll");
  ok(multip !== undefined);
  equal(multip?.status, "declined");
  equal(multip?.occurrences, 4);

  const kaimu = lookupLegacyPlugin("MidiTools.dll");
  ok(kaimu !== undefined);
  equal(kaimu?.status, "native");
  equal(kaimu?.packId, "kaimu");
  equal(kaimu?.occurrences, 3);
});

test("legacy plugin lookup normalizes paths, DLL extensions, and slot names", () => {
  equal(lookupLegacyPlugin("Plugin/GsMiscPlugins.dll")?.packId, "gsmisc");
  equal(lookupLegacyPlugin("Plugin\\filereadwrite.dll")?.packId, "filereadwrite");
  equal(lookupLegacyPlugin("TRIUKEN")?.packId, "triuken");
  equal(lookupLegacyPlugin("xfmwinplugin")?.packId, "xfmwin");
  equal(lookupLegacyPlugin("TransTools.dll")?.packId, "kaimu");

  // Multi-Plug plugins.ini ActiveX CLSIDs
  equal(lookupLegacyPlugin("CLSID=multiplayer_cy.ws_con")?.status, "declined");
  equal(lookupLegacyPlugin("CLSID=DanPlugPack.main")?.status, "declined");
  equal(lookupLegacyPlugin("CLSID=DarkAge.Revamped")?.status, "declined");
  equal(lookupLegacyPlugin("CLSID=EMail.Class")?.status, "declined");

  // TK2 slots
  equal(lookupLegacyPlugin("tkplug0")?.status, "declined");
  equal(lookupLegacyPlugin("tkplug1")?.status, "loader");
  equal(lookupLegacyPlugin("tkplug2")?.packId, "filereadwrite");

  // Stock TK3 subsystems
  equal(lookupLegacyPlugin("tk3menu.dll")?.subsystem, "menu");
  equal(lookupLegacyPlugin("tk3fight.dll")?.subsystem, "battle");
});

test("declined plugin diagnostics provide located codes, counts and reasons", () => {
  const ftpDiag = getDeclinedPluginDiagnostic("FTP.dll", "games/littleman/main.gam", 3);
  ok(ftpDiag !== undefined);
  equal(ftpDiag?.code, "plugin.declined-network");
  equal(ftpDiag?.path, "games/littleman/main.gam");
  equal(ftpDiag?.index, 3);
  equal(ftpDiag?.message.includes("41 corpus programs"), true);
  equal(ftpDiag?.message.includes("FTP"), true);

  const multipDiag = getDeclinedPluginDiagnostic("multip.dll");
  ok(multipDiag !== undefined);
  equal(multipDiag?.code, "plugin.declined-network");
  equal(multipDiag?.message.includes("WinSock"), true);

  const flashDiag = getDeclinedPluginDiagnostic("flashplug.dll");
  ok(flashDiag !== undefined);
  equal(flashDiag?.code, "plugin.declined-unportable");
  equal(flashDiag?.message.includes("Flash/SWF"), true);

  const bpsDiag = getDeclinedPluginDiagnostic("bps_adv.dll");
  ok(bpsDiag !== undefined);
  equal(bpsDiag?.code, "plugin.declined-win32");
  equal(bpsDiag?.message.includes("HWND"), true);

  // Native plugin is not declined
  equal(getDeclinedPluginDiagnostic("GsMiscPlugins.dll"), undefined);
});

test("native packs table registers all 9 native packs with matching ids", () => {
  equal(NATIVE_PACKS.length, 9);
  deepEqual(Object.keys(NATIVE_PACK_TABLE).sort(), [
    "filereadwrite",
    "gsmisc",
    "kaimu",
    "proplug",
    "render",
    "triuken",
    "twbutton",
    "world",
    "xfmwin",
  ]);
  for (const pack of NATIVE_PACKS) {
    equal(NATIVE_PACK_TABLE[pack.id], pack);
  }
});

test("proplug pack provides pure algorithmic string and math operations", () => {
  const findCmd = (name: string) => {
    const cmd = PROPLUG_PLUGIN.commands.find((c) => c.name === name);
    if (!cmd) throw new Error(`command ${name} not found`);
    return cmd;
  };

  const andCmd = findCmd("and");
  equal(andCmd.call(dummyView, [{ value: 12, ref: null }, { value: 10, ref: null }], () => ({ value: null })).value, 8);

  const orCmd = findCmd("or");
  equal(orCmd.call(dummyView, [{ value: 12, ref: null }, { value: 10, ref: null }], () => ({ value: null })).value, 14);

  const lprintfCmd = findCmd("lprintf");
  const formatted = lprintfCmd.call(
    dummyView,
    [
      { value: "Score: %d for %s (rate: %f%%)", ref: null },
      { value: 100, ref: null },
      { value: "Hero", ref: null },
      { value: 99.5, ref: null },
    ],
    () => ({ value: null }),
  );
  equal(formatted.value, "Score: 100 for Hero (rate: 99.5%)");

  const litncpyCmd = findCmd("litncpy");
  equal(
    litncpyCmd.call(
      dummyView,
      [{ value: "", ref: null }, { value: "hello world", ref: null }, { value: 5, ref: null }],
      () => ({ value: null }),
    ).value,
    "hello",
  );

  const litcmpCmd = findCmd("litcmp");
  equal(litcmpCmd.call(dummyView, [{ value: "alpha", ref: null }, { value: "beta", ref: null }], () => ({ value: null })).value, -1);
  equal(litcmpCmd.call(dummyView, [{ value: "beta", ref: null }, { value: "alpha", ref: null }], () => ({ value: null })).value, 1);
  equal(litcmpCmd.call(dummyView, [{ value: "same", ref: null }, { value: "same", ref: null }], () => ({ value: null })).value, 0);

  const litncmpCmd = findCmd("litncmp");
  equal(
    litncmpCmd.call(
      dummyView,
      [{ value: "prefix1", ref: null }, { value: "prefix2", ref: null }, { value: 6, ref: null }],
      () => ({ value: null }),
    ).value,
    0,
  );

  const lowerCmd = findCmd("littolower");
  equal(lowerCmd.call(dummyView, [{ value: "AbCdEf", ref: null }], () => ({ value: null })).value, "abcdef");

  const upperCmd = findCmd("littoupper");
  equal(upperCmd.call(dummyView, [{ value: "AbCdEf", ref: null }], () => ({ value: null })).value, "ABCDEF");

  const titleCmd = findCmd("littotitle");
  equal(titleCmd.call(dummyView, [{ value: "the dark knight", ref: null }], () => ({ value: null })).value, "The Dark Knight");

  const isAlphaCmd = findCmd("litisalpha");
  equal(isAlphaCmd.call(dummyView, [{ value: "validWord", ref: null }], () => ({ value: null })).value, 1);
  equal(isAlphaCmd.call(dummyView, [{ value: "not alpha 123", ref: null }], () => ({ value: null })).value, 0);

  const isDigitCmd = findCmd("litisdigit");
  equal(isDigitCmd.call(dummyView, [{ value: "12345", ref: null }], () => ({ value: null })).value, 1);
  equal(isDigitCmd.call(dummyView, [{ value: "123a", ref: null }], () => ({ value: null })).value, 0);

  const isAlphaDigitCmd = findCmd("litisalphadigit");
  equal(isAlphaDigitCmd.call(dummyView, [{ value: "Alpha123", ref: null }], () => ({ value: null })).value, 1);
  equal(isAlphaDigitCmd.call(dummyView, [{ value: "Alpha 123!", ref: null }], () => ({ value: null })).value, 0);

  const litlenCmd = findCmd("litlen");
  equal(litlenCmd.call(dummyView, [{ value: "characters", ref: null }], () => ({ value: null })).value, 10);
});

test("filereadwrite pack enforces sandbox and emits host requests in saves area", () => {
  const writeCmd = FILEREADWRITE_PLUGIN.commands.find((c) => c.name === "filewrite")!;
  const readCmd = FILEREADWRITE_PLUGIN.commands.find((c) => c.name === "fileread")!;

  throws(
    () => writeCmd.call(dummyView, [{ value: "../escaped", ref: null }, { value: "file.txt", ref: null }], () => ({ value: null })),
    /escapes game sandbox/,
  );

  const writeResult = writeCmd.call(
    dummyView,
    [
      { value: "logs", ref: null },
      { value: "save.txt", ref: null },
      { value: "first line", ref: null },
      { value: "second line", ref: null },
    ],
    () => ({ value: null }),
  );
  equal(writeResult.request?.kind, "saveBlob");
  deepEqual(writeResult.request?.blob, { area: "saves", path: "test-game/logs/save.txt" });
  equal(writeResult.effects?.[0]?.section, "vm");
  const readResult = readCmd.call(
    dummyView,
    [
      { value: "logs", ref: null },
      { value: "save.txt", ref: null },
      { value: "handle", ref: asRef("local:lineVar") },
      { value: 1, ref: null },
      { value: 0, ref: asRef("local:countVar") },
    ],
    () => ({ value: null }),
  );
  equal(readResult.request?.kind, "loadBlob");
  deepEqual(readResult.request?.blob, { area: "saves", path: "test-game/logs/save.txt" });
  deepEqual(readResult.out, [[2, ""], [4, 0]]);
});

test("gsmisc pack records domain effects and writes back by-ref arguments", () => {
  const coordsCmd = GSMISC_PLUGIN.commands.find((c) => c.name === "getplayercoords")!;
  const coords = coordsCmd.call(
    dummyView,
    [{ value: 0, ref: asRef("local:xPos") }, { value: 0, ref: asRef("local:yPos") }],
    () => ({ value: null }),
  );
  deepEqual(coords.out, [[0, 0], [1, 0]]);
  equal(coords.effects?.[0]?.section, "sprites");

  const dirCmd = GSMISC_PLUGIN.commands.find((c) => c.name === "getdirection")!;
  const dir = dirCmd.call(dummyView, [{ value: 0, ref: null }, { value: 0, ref: asRef("local:outDir") }], () => ({ value: null }));
  equal(dir.value, 0);
  deepEqual(dir.out, [[1, 0]]);

  const dpCmd = GSMISC_PLUGIN.commands.find((c) => c.name === "givedp")!;
  const dp = dpCmd.call(dummyView, [{ value: "Hero", ref: null }, { value: 15, ref: null }], () => ({ value: null }));
  equal(dp.effects?.[0]?.section, "party");
  deepEqual(dp.effects?.[0]?.args, ["Hero", 15]);

  const boardCmd = GSMISC_PLUGIN.commands.find((c) => c.name === "getboardname")!;
  const board = boardCmd.call(dummyView, [{ value: "", ref: asRef("local:boardVar") }], () => ({ value: null }));
  equal(board.value, "village.brd");
  deepEqual(board.out, [[0, "village.brd"]]);
});

test("triuken pack calculates dimensions and emits ui/surfaces effects", () => {
  const drawTextCmd = TRIUKEN_PLUGIN.commands.find((c) => c.name === "drawtext")!;
  const draw = drawTextCmd.call(
    dummyView,
    [{ value: "Hello", ref: null }, { value: 10, ref: null }, { value: 20, ref: null }, { value: "#ffffff", ref: null }],
    () => ({ value: null }),
  );
  equal(draw.effects?.[0]?.section, "surfaces");
  deepEqual(draw.effects?.[0]?.args, ["Hello", 10, 20, "#ffffff"]);
  const widthCmd = TRIUKEN_PLUGIN.commands.find((c) => c.name === "gettextwidth")!;
  const width = widthCmd.call(
    dummyView,
    [{ value: "12345", ref: null }, { value: "Arial", ref: null }, { value: 12, ref: null }, { value: 0, ref: asRef("local:dest") }],
    () => ({ value: null }),
  );
  equal(width.value, 40);
  deepEqual(width.out, [[3, 40]]);
});

test("triuken text metrics delegate only the core forms and keep the extended font forms", () => {
  for (const name of ["gettextwidth", "gettextheight"]) {
    const command = TRIUKEN_PLUGIN.commands.find((c) => c.name === name)!;
    const delegated = { value: 7, out: [[1, 7]] as const };
    const call = (args: Arg[]): { readonly result: ReturnType<typeof command.call>; readonly delegated: boolean } => {
      let reached = false;
      const result = command.call(dummyView, args, () => { reached = true; return delegated; });
      return { result, delegated: reached };
    };
    equal(command.params[1]?.byRef, true, `${name}'s second parameter may carry the core output reference`);
    equal(call([{ value: "ab", ref: null }]).delegated, true, "one argument is the core form");
    equal(call([{ value: "ab", ref: null }, { value: 5, ref: asRef("local:out") }]).delegated, true, "a numeric variable is the core output reference");
    equal(call([{ value: "ab", ref: null }, { value: "", ref: asRef("local:out") }]).delegated, true, "an empty-string variable is not a font name");
    equal(call([{ value: "ab", ref: null }, { value: "Arial", ref: null }]).delegated, false, "a literal font name is the Triuken form");
    equal(call([{ value: "ab", ref: null }, { value: 5, ref: null }]).delegated, false, "a literal second argument is never an output reference");
    equal(call([{ value: "ab", ref: null }, { value: "Arial", ref: asRef("local:font") }]).delegated, false, "a variable holding a font name is the Triuken form");
    equal(call([{ value: "ab", ref: null }, { value: "Arial", ref: null }, { value: 12, ref: null }]).delegated, false);
    const extended = call([{ value: "ab", ref: null }, { value: "Arial", ref: null }, { value: 12, ref: null }, { value: 0, ref: asRef("local:dest") }]);
    equal(extended.delegated, false);
    deepEqual(extended.result.out, [[3, 16]]);
  }
});

test("xfmwin pack aliases dialogue and prompts with msgbox waits", () => {
  const xfmwinCmd = XFMWIN_PLUGIN.commands.find((c) => c.name === "xfmwin")!;
  const mwinResult = xfmwinCmd.call(dummyView, [{ value: "Quest accepted!", ref: null }], () => ({ value: null }));
  equal(mwinResult.effects?.[0]?.section, "ui");
  deepEqual(mwinResult.effects?.[0]?.args, ["Quest accepted!"]);
  const promptCmd = XFMWIN_PLUGIN.commands.find((c) => c.name === "xfmwinprompt")!;
  const promptResult = promptCmd.call(
    dummyView,
    [{ value: "Your name?", ref: null }, { value: "", ref: asRef("local:nameVar") }],
    () => ({ value: null }),
  );
  equal(promptResult.wait?.kind, "render.msgbox");
  if (promptResult.wait && "resumeRefs" in promptResult.wait) {
    deepEqual(promptResult.wait.resumeRefs, ["local:nameVar"]);
  }
});

test("kaimu and twbutton packs emit audio, fx and button effects", () => {
  const midiCmd = KAIMU_PLUGIN.commands.find((c) => c.name === "fademidiin")!;
  const midi = midiCmd.call(dummyView, [{ value: "town.mid", ref: null }, { value: 5, ref: null }], () => ({ value: null }));
  equal(midi.effects?.[0]?.section, "audio");

  const fadeCmd = KAIMU_PLUGIN.commands.find((c) => c.name === "fadetoblack")!;
  const fade = fadeCmd.call(dummyView, [{ value: 3, ref: null }], () => ({ value: null }));
  equal(fade.effects?.[0]?.section, "fx");

  const setBtn = TWBUTTON_PLUGIN.commands.find((c) => c.name === "twsetbutton")!;
  const btn = setBtn.call(
    dummyView,
    [{ value: 1, ref: null }, { value: "btn.png", ref: null }, { value: 50, ref: null }, { value: 50, ref: null }],
    () => ({ value: null }),
  );
  equal(btn.effects?.[0]?.section, "ui");
  const checkBtn = TWBUTTON_PLUGIN.commands.find((c) => c.name === "twcheckbutton")!;
  const check = checkBtn.call(dummyView, [{ value: 1, ref: null }, { value: 0, ref: asRef("local:clicked") }], () => ({ value: null }));
  equal(check.value, 0);
  deepEqual(check.out, [[1, 0]]);
});
