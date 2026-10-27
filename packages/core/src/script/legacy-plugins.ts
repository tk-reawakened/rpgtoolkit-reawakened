/**
 * Native packs for the most-used legacy plugins and the legacy-name table
 * (CAP-5, E-99; ADR 0004 decisions 3, 6, 7; docs/spec/engine/plugins-and-battle.md).
 *
 * Sourced from the 2,783 archived unit corpus discovery (spike-23/spike-legacy.md,
 * zip-survey-plugins.csv, and plugin-definition-spike.md). Legacy identities
 * (slots tkplug0..tkplug4, .gam plugin list file names, and Multi-Plug plugins.ini
 * entries) map to native packs or to located not-supported diagnostics.
 */

import { encodeCp1252 } from "../formats/binary/cp1252.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Value } from "../ports/value.ts";
import type { Arg, BuiltinDoc } from "./builtins.ts";
import { ScriptError } from "./errors.ts";
import { requireGameId } from "./game-id.ts";
import type { PluginManifestDiagnostic } from "./manifest.ts";
import type { CommandEffect, CommandRequest, CommandResult, CommandView, PluginDefinition } from "./plugin.ts";
import { toStringValue } from "./values.ts";
import { RENDER_PLUGIN } from "./packs/render.ts";
import { WORLD_PLUGIN } from "./packs/world.ts";

/** Status classification for legacy plugins. */
export type LegacyPluginStatus = "native" | "declined" | "subsystem" | "loader";

/** One row in the static legacy plugin table. */
export type LegacyPluginEntry = {
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly status: LegacyPluginStatus;
  readonly packId?: string;
  readonly subsystem?: "menu" | "battle";
  readonly reason?: string;
  readonly diagnosticCode?: string;
  readonly occurrences: number;
  readonly sourceFiles: number;
  readonly packages: number;
  readonly note?: string;
};

/**
 * Static table of all legacy plugins and loader identities documented in the
 * archived corpus (spike-23/spike-legacy.md Section 4 and zip-survey-plugins.csv).
 */
export const LEGACY_PLUGIN_TABLE: readonly LegacyPluginEntry[] = [
  {
    canonicalName: "Triuken's Plugin Pack",
    aliases: [
      "triukens_plugin",
      "triukens_plugin.dll",
      "triuken",
      "triuken.dll",
      "triukens plugin",
      "triukens plugin pack",
    ],
    status: "native",
    packId: "triuken",
    occurrences: 71,
    sourceFiles: 10,
    packages: 6,
    note: "Font, step count and item stat helpers (catalogue id 129).",
  },
  {
    canonicalName: "GsMiscPlugins",
    aliases: [
      "gsmiscplugins.dll",
      "gsmiscplugins",
      "gsmisc.dll",
      "gsmisc",
      "gsmisc pack",
      "mrgs misc plugin pack one",
      "misc plugin pack",
    ],
    status: "native",
    packId: "gsmisc",
    occurrences: 57,
    sourceFiles: 14,
    packages: 7,
    note: "MrG's party, enemy, inventory and direction helpers (catalogue id 120).",
  },
  {
    canonicalName: "filereadwrite",
    aliases: [
      "filereadwrite.dll",
      "filereadwrite",
      "fileread.dll",
      "fileread",
      "read/write plugin",
      "read write plugin",
    ],
    status: "native",
    packId: "filereadwrite",
    occurrences: 47,
    sourceFiles: 7,
    packages: 5,
    note: "Leuf's sandboxed file read/write plugin (catalogue id 127).",
  },
  {
    canonicalName: "FTP.dll",
    aliases: [
      "ftp.dll",
      "ftp",
      "ftp plugin",
      "tkplugin.dll",
    ],
    status: "declined",
    reason: "raw network / FTP / HTTP operations are unportable and outside the game sandbox",
    diagnosticCode: "plugin.declined-network",
    occurrences: 41,
    sourceFiles: 15,
    packages: 5,
    note: "kaptan's FTP and HTTP plugin (catalogue id 117); uses WININET imports.",
  },
  {
    canonicalName: "XFMWin",
    aliases: [
      "xfmwin.dll",
      "xfmwin",
      "xfmwinplugin.dll",
      "xfmwinplugin",
      "xfmwin plugin",
    ],
    status: "native",
    packId: "xfmwin",
    occurrences: 16,
    sourceFiles: 4,
    packages: 2,
    note: "Leuf's dialog window plugin (catalogue id 132); aliased to native dialogue/prompt.",
  },
  {
    canonicalName: "proplug",
    aliases: [
      "proplug.dll",
      "proplug",
      "programmers plugin",
      "programmer's plugin",
    ],
    status: "native",
    packId: "proplug",
    occurrences: 13,
    sourceFiles: 6,
    packages: 4,
    note: "Leuf's Programmer's Plugin (catalogue id 126); algorithmic string and bitwise math helpers.",
  },
  {
    canonicalName: "E-Mail Plugin",
    aliases: [
      "e-mail.dll",
      "e-mail",
      "email.dll",
      "email",
      "clsid=email.class",
      "email.class",
      "ksniloc email plugin",
    ],
    status: "declined",
    reason: "network mail transport and COM ActiveX DLL hosting are unportable",
    diagnosticCode: "plugin.declined-network",
    occurrences: 10,
    sourceFiles: 2,
    packages: 2,
    note: "KSNiloc's email ActiveX DLL (catalogue id 215).",
  },
  {
    canonicalName: "TWButton",
    aliases: [
      "twbutton.dll",
      "twbutton",
      "wintermoon button",
      "twbutton plugin",
    ],
    status: "native",
    packId: "twbutton",
    occurrences: 6,
    sourceFiles: 2,
    packages: 2,
    note: "Wintermoon's UI on-screen button plugin (catalogue id 130).",
  },
  {
    canonicalName: "multip.dll",
    aliases: [
      "multip.dll",
      "multip",
      "clsid=multiplayer_cy.ws_con",
      "multiplayer_cy.ws_con",
      "multiplayer plugin",
    ],
    status: "declined",
    reason: "WinSock raw socket networking is unportable",
    diagnosticCode: "plugin.declined-network",
    occurrences: 4,
    sourceFiles: 4,
    packages: 2,
    note: "Cyranoid Multiplayer Plugin (catalogue id 122).",
  },
  {
    canonicalName: "Kaimu's Plugins",
    aliases: [
      "miditools.dll",
      "miditools",
      "transtools.dll",
      "transtools",
      "kaimuplugs.dll",
      "kaimuplugs",
      "kaimu",
    ],
    status: "native",
    packId: "kaimu",
    occurrences: 3,
    sourceFiles: 1,
    packages: 1,
    note: "Kaimu's MIDI fade and screen transition tools (catalogue id 119).",
  },
  {
    canonicalName: "Adv RPGCode Plugin",
    aliases: [
      "bps_adv.dll",
      "bps_adv",
      "bps_adv_rpgcode_plugin",
      "adv rpgcode plugin",
    ],
    status: "declined",
    reason: "Win32 window handles (HWND) and GDI device contexts (DC) are not portable to pure engine core",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 2,
    sourceFiles: 2,
    packages: 1,
    note: "BP Adv RPGCode Plugin (catalogue id 110).",
  },
  {
    canonicalName: "VIP Plugin Pak 2",
    aliases: [
      "vippluginpak2.dll",
      "vippluginpak2",
      "vippluginpak",
      "vip plugin pak 2",
      "vip plugin pak",
    ],
    status: "declined",
    reason: "MFC runtime dependency and arbitrary host filesystem access outside sandbox",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 2,
    sourceFiles: 2,
    packages: 1,
    note: "Chris Reeves' VIP Plugin Pak 2 (catalogue id 20).",
  },
  {
    canonicalName: "FaeroSock",
    aliases: [
      "faerosock.dll",
      "faerosock",
    ],
    status: "declined",
    reason: "WinSock raw socket networking is unportable",
    diagnosticCode: "plugin.declined-network",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "WinSock socket plugin (catalogue id 115).",
  },
  {
    canonicalName: "Flash Plugin",
    aliases: [
      "flashplug.dll",
      "flashplug",
      "flash.dll",
      "flash",
      "flash plugin",
    ],
    status: "declined",
    reason: "Flash/SWF hosting is unsupported in modern engine core",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Triuken's Flash SWF plugin (catalogue id 116).",
  },
  {
    canonicalName: "Dan's Misc",
    aliases: [
      "danplugpack.dll",
      "danplugpack",
      "clsid=danplugpack.main",
      "danplugpack.main",
      "dans misc",
    ],
    status: "declined",
    reason: "ActiveX COM DLL and arbitrary host execution (apppath) are unsupported",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Dan's Plug Pack (catalogue id 111).",
  },
  {
    canonicalName: "Never Fail R/W",
    aliases: [
      "neverfailrw.dll",
      "neverfailrw",
      "never fail r/w",
      "never fail rw",
    ],
    status: "declined",
    reason: "ShellOpen and ShellPrint commands access host OS outside sandbox",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Aljo Never Fail R/W v2.2 (catalogue id 170).",
  },
  {
    canonicalName: "BinaryReadWrite",
    aliases: [
      "binaryreadwrite.dll",
      "binaryreadwrite",
    ],
    status: "declined",
    reason: "ActiveX binary file access outside sandbox is unsupported",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "KSNiloc BinaryReadWrite ActiveX plugin.",
  },
  {
    canonicalName: "DragSound",
    aliases: [
      "dragsound.dll",
      "dragsound",
    ],
    status: "declined",
    reason: "DirectX audio pipeline is unportable; MIDI/WAV/OGG/MP3 are handled by native audio",
    diagnosticCode: "plugin.declined-directx",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "DirectX audio mixer ActiveX DLL (catalogue id 175).",
  },
  {
    canonicalName: "npcplugin",
    aliases: [
      "npcplugin.dll",
      "npcplugin",
    ],
    status: "declined",
    reason: "Plugin wrapper for NLib.prg schedule scripts; native script includes provide scheduling",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Wintermoon NPC plugin.",
  },
  {
    canonicalName: "DarkAge.dll",
    aliases: [
      "darkage.dll",
      "darkage",
      "clsid=darkage.revamped",
      "darkage.revamped",
      "sendback system",
    ],
    status: "declined",
    reason: "ActiveX COM DLL hosting is unsupported",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Sendback system v4 plugin.",
  },
  {
    canonicalName: "shoot.dll",
    aliases: [
      "shoot.dll",
      "shoot",
      "clsid=project1.mainmod",
      "project1.mainmod",
      "vb minigame",
    ],
    status: "declined",
    reason: "ActiveX minigame binary is unsupported",
    diagnosticCode: "plugin.declined-unportable",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "VB Minigame 1-4 by KSNiloc.",
  },
  {
    canonicalName: "Multi-Plug",
    aliases: [
      "multiplug.dll",
      "multiplug",
      "tkplugx.dll",
      "tkplugx",
      "multi plug",
    ],
    status: "loader",
    reason: "Plugin loader manager replaced by engine manifest and native pack resolution",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "TK2 plugin manager DLL (catalogue id 121).",
  },
  {
    canonicalName: "tkplug0",
    aliases: ["tkplug0.dll", "tkplug0"],
    status: "declined",
    reason: "TK2 slot 0 (in TransChat2b: FTP plugin; unportable network)",
    diagnosticCode: "plugin.declined-network",
    occurrences: 1,
    sourceFiles: 1,
    packages: 1,
    note: "TK2 slot 0.",
  },
  {
    canonicalName: "tkplug1",
    aliases: ["tkplug1.dll", "tkplug1"],
    status: "loader",
    reason: "TK2 slot 1 (in LittleMan: MultiPlug loader; replaced by manifest)",
    occurrences: 1,
    sourceFiles: 1,
    packages: 1,
    note: "TK2 slot 1.",
  },
  {
    canonicalName: "tkplug2",
    aliases: ["tkplug2.dll", "tkplug2"],
    status: "native",
    packId: "filereadwrite",
    occurrences: 1,
    sourceFiles: 1,
    packages: 1,
    note: "TK2 slot 2 (in TransChat2b: filereadwrite plugin).",
  },
  {
    canonicalName: "tkplug3",
    aliases: ["tkplug3.dll", "tkplug3"],
    status: "loader",
    reason: "TK2 slot 3 generic slot",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "TK2 slot 3.",
  },
  {
    canonicalName: "tkplug4",
    aliases: ["tkplug4.dll", "tkplug4"],
    status: "loader",
    reason: "TK2 slot 4 generic slot",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "TK2 slot 4.",
  },
  {
    canonicalName: "tk3menu.dll",
    aliases: ["tk3menu.dll", "tk3menu"],
    status: "subsystem",
    subsystem: "menu",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Stock TK3 menu subsystem (format-spec §2 row 21).",
  },
  {
    canonicalName: "tk3fight.dll",
    aliases: ["tk3fight.dll", "tk3fight"],
    status: "subsystem",
    subsystem: "battle",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
    note: "Stock TK3 battle subsystem (format-spec §2 row 21).",
  },
  {
    canonicalName: "Edit Box Plugin",
    aliases: ["edit box plugin", "171", "editbox.dll"],
    status: "declined",
    reason: "Win32 UI edit box is not portable to pure core",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
  },
  {
    canonicalName: "Resolution Changer",
    aliases: ["resolution changer", "211", "reschange.dll"],
    status: "declined",
    reason: "Win32 display resolution modification is unportable",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
  },
  {
    canonicalName: "Launch Any File",
    aliases: ["launch any file", "147", "launch.dll"],
    status: "declined",
    reason: "Win32 ShellExecute arbitrary file launching is outside the sandbox",
    diagnosticCode: "plugin.declined-win32",
    occurrences: 0,
    sourceFiles: 0,
    packages: 0,
  },
];

function normalizeIdentity(identity: string): string {
  let text = identity.trim().toLowerCase().split("\\").join("/");
  if (text.startsWith("plugin/")) text = text.slice("plugin/".length);
  if (text.endsWith(".dll")) text = text.slice(0, -".dll".length);
  return text;
}

const TABLE_BY_IDENTITY: Record<string, LegacyPluginEntry> = Object.create(null);
for (const entry of LEGACY_PLUGIN_TABLE) {
  TABLE_BY_IDENTITY[normalizeIdentity(entry.canonicalName)] = entry;
  for (const alias of entry.aliases) {
    TABLE_BY_IDENTITY[normalizeIdentity(alias)] = entry;
  }
}

/** Look up a legacy plugin entry by slot, file name or Multi-Plug identifier. */
export function lookupLegacyPlugin(identity: string): LegacyPluginEntry | undefined {
  const norm = normalizeIdentity(identity);
  return TABLE_BY_IDENTITY[norm];
}

/** Generate a located diagnostic for a declined legacy plugin. */
export function getDeclinedPluginDiagnostic(
  identity: string,
  path = "manifest",
  index = 0,
): PluginManifestDiagnostic | undefined {
  const entry = lookupLegacyPlugin(identity);
  if (entry && entry.status === "declined") {
    return {
      code: entry.diagnosticCode ?? "plugin.declined",
      path,
      index,
      message: `legacy plugin "${entry.canonicalName}" is not supported (${entry.reason}; observed in ${entry.occurrences} corpus programs)`,
    };
  }
  return undefined;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

// ---------------------------------------------------------------------------
// Native Packs: pure PluginDefinitions recording their effects
// ---------------------------------------------------------------------------

function effect(args: readonly Arg[], section?: CommandEffect["section"], value: Value = null): CommandResult {
  const argsData = args.map((a) => a.value as PlainData);
  const effects: CommandEffect[] =
    section !== undefined
      ? [{ kind: "mixed", section, args: argsData }]
      : [{ kind: "mixed", args: argsData }];
  return { value, effects };
}

function byRefOut(args: readonly Arg[], index: number, value: Value): readonly (readonly [number, Value])[] {
  return args[index]?.ref !== null && args[index]?.ref !== undefined ? [[index, value]] : [];
}

/**
 * 1. GsMiscPlugins pack (pack id "gsmisc", catalogue id 120, MrG)
 * 57 occurrences across 14 source files and 7 packages in the corpus.
 */
export const GSMISC_PLUGIN: PluginDefinition = {
  id: "gsmisc",
  version: "1.0.0",
  commands: [
    {
      name: "getdirection",
      aliases: [],
      params: [
        { name: "handle", optional: true, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 1, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "sprites" }] };
      },
    },
    {
      name: "getplayercoords",
      aliases: [],
      params: [
        { name: "x", optional: false, byRef: true, variadic: false },
        { name: "y", optional: false, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out: (readonly [number, Value])[] = [];
        if (args[0]?.ref) out.push([0, 0]);
        if (args[1]?.ref) out.push([1, 0]);
        return { value: null, out, effects: [{ kind: "mixed", section: "sprites" }] };
      },
    },
    {
      name: "getbrightness",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 100);
        return { value: 100, out, effects: [{ kind: "mixed", section: "surfaces" }] };
      },
    },
    {
      name: "useitem",
      aliases: [],
      params: [
        { name: "item", optional: false, byRef: false, variadic: false },
        { name: "target", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "inventory"),
    },
    {
      name: "getitems",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "inventory" }] };
      },
    },
    {
      name: "getequip",
      aliases: [],
      params: [
        { name: "player", optional: false, byRef: false, variadic: false },
        { name: "slot", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 2, "");
        return { value: "", out, effects: [{ kind: "mixed", section: "inventory" }] };
      },
    },
    {
      name: "getplayernum",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 1);
        return { value: 1, out, effects: [{ kind: "mixed", section: "party" }] };
      },
    },
    {
      name: "givedp",
      aliases: [],
      params: [
        { name: "target", optional: false, byRef: false, variadic: false },
        { name: "amount", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "party"),
    },
    {
      name: "gettime",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (view, args) => {
        const time = view.clock.tick();
        const out = byRefOut(args, 0, time);
        return { value: time, out, effects: [{ kind: "mixed", section: "time" }] };
      },
    },
    {
      name: "getboardname",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (view, args) => {
        const boardValue: unknown = view.state?.world.board;
        const name = typeof boardValue === "string" ? boardValue : boardValue !== null && typeof boardValue === "object" && "key" in boardValue && typeof boardValue.key === "string" ? boardValue.key : "";
        const out = byRefOut(args, 0, name);
        return { value: name, out, effects: [{ kind: "mixed", section: "world" }] };
      },
    },
    {
      name: "getbkgsounds",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, "");
        return { value: "", out, effects: [{ kind: "mixed", section: "audio" }] };
      },
    },
    {
      name: "putenemy",
      aliases: [],
      params: [
        { name: "slot", optional: false, byRef: false, variadic: false },
        { name: "enemy", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "battle"),
    },
    {
      name: "emptyenemy",
      aliases: [],
      params: [{ name: "slot", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => effect(args, "battle"),
    },
    {
      name: "getenemystats",
      aliases: [],
      params: [
        { name: "slot", optional: false, byRef: false, variadic: false },
        { name: "stat", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 2, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "battle" }] };
      },
    },
    {
      name: "usespecialmove",
      aliases: [],
      params: [
        { name: "move", optional: false, byRef: false, variadic: false },
        { name: "target", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "party"),
    },
    {
      name: "getspecialmoves",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "party" }] };
      },
    },
    {
      name: "getspecialmoveinfo",
      aliases: [],
      params: [
        { name: "move", optional: false, byRef: false, variadic: false },
        { name: "info", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 2, "");
        return { value: "", out, effects: [{ kind: "mixed", section: "party" }] };
      },
    },
  ],
};

/**
 * 2. Triuken's Plugin Pack (pack id "triuken", catalogue id 129)
 * 71 occurrences across 10 source files and 6 packages in the corpus.
 */
export const TRIUKEN_PLUGIN: PluginDefinition = {
  id: "triuken",
  version: "1.0.0",
  commands: [
    {
      name: "fontproperties",
      aliases: [],
      params: [
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "size", optional: false, byRef: false, variadic: false },
        { name: "bold", optional: true, byRef: false, variadic: false },
        { name: "italic", optional: true, byRef: false, variadic: false },
        { name: "underline", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "ui"),
    },
    {
      name: "fontpropertiesextended",
      aliases: [],
      params: [
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "size", optional: false, byRef: false, variadic: false },
        { name: "bold", optional: true, byRef: false, variadic: false },
        { name: "italic", optional: true, byRef: false, variadic: false },
        { name: "underline", optional: true, byRef: false, variadic: false },
        { name: "color", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "ui"),
    },
    {
      name: "drawtext",
      aliases: [],
      params: [
        { name: "text", optional: false, byRef: false, variadic: false },
        { name: "x", optional: false, byRef: false, variadic: false },
        { name: "y", optional: false, byRef: false, variadic: false },
        { name: "color", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "surfaces"),
    },
    {
      name: "gettextwidth",
      aliases: [],
      params: [
        { name: "text", optional: false, byRef: false, variadic: false },
        { name: "font", optional: true, byRef: false, variadic: false },
        { name: "size", optional: true, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const text = toStringValue(args[0]?.value as never);
        const width = text.length * 8;
        const out = byRefOut(args, 3, width);
        return { value: width, out, effects: [{ kind: "mixed", section: "ui" }] };
      },
    },
    {
      name: "gettextheight",
      aliases: [],
      params: [
        { name: "text", optional: true, byRef: false, variadic: false },
        { name: "font", optional: true, byRef: false, variadic: false },
        { name: "size", optional: true, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 3, 16);
        return { value: 16, out, effects: [{ kind: "mixed", section: "ui" }] };
      },
    },
    {
      name: "getsteps",
      aliases: [],
      params: [{ name: "dest", optional: true, byRef: true, variadic: false }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "party" }] };
      },
    },
    {
      name: "getitemstats",
      aliases: [],
      params: [
        { name: "item", optional: false, byRef: false, variadic: false },
        { name: "stat", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 2, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "inventory" }] };
      },
    },
  ],
};

/**
 * 3. filereadwrite pack (pack id "filereadwrite", catalogue id 127, Leuf)
 * 47 occurrences across 7 source files and 5 packages in the corpus.
 * Emits sandboxed host requests (AD-17 loadBlob/saveBlob) targeting the "saves" area.
 */
function fileSaveRequest(view: CommandView, args: readonly Arg[], isAppend: boolean): CommandResult {
  const subdir = toStringValue(args[0]?.value as never);
  const filename = toStringValue(args[1]?.value as never);
  const cleanSubdir = subdir.split("\\").join("/").replace(/^\/+|\/+$/g, "");
  const cleanFilename = filename.split("\\").join("/").replace(/^\/+/, "");
  if (cleanSubdir.includes("..") || cleanFilename.includes("..")) {
    throw new ScriptError("builtin.bad-arg", "file path escapes game sandbox");
  }
  const path = `${requireGameId(view)}/${cleanSubdir ? `${cleanSubdir}/` : ""}${cleanFilename}`;
  const lines: string[] = [];
  for (let i = 2; i < args.length; i += 1) {
    lines.push(toStringValue(args[i]?.value as never));
  }
  const content = `${lines.join("\r\n")}\r\n`;
  const encoded = encodeCp1252(content);
  const bytes = encoded.ok ? encoded.value : new Uint8Array(0);
  const request: CommandRequest = {
    kind: "saveBlob",
    blob: { area: "saves", path },
    hex: hex(bytes),
    append: isAppend,
  };
  return {
    value: null,
    request,
    effects: [{ kind: "mixed", section: "vm", args: [path] }],
  };
}

export const FILEREADWRITE_PLUGIN: PluginDefinition = {
  id: "filereadwrite",
  version: "1.0.0",
  commands: [
    {
      name: "filewrite",
      aliases: [],
      params: [
        { name: "subdir", optional: false, byRef: false, variadic: false },
        { name: "filename", optional: false, byRef: false, variadic: false },
        { name: "lines", optional: true, byRef: false, variadic: true },
      ],
      call: (view, args) => fileSaveRequest(view, args, false),
    },
    {
      name: "fileappend",
      aliases: [],
      params: [
        { name: "subdir", optional: false, byRef: false, variadic: false },
        { name: "filename", optional: false, byRef: false, variadic: false },
        { name: "lines", optional: true, byRef: false, variadic: true },
      ],
      call: (view, args) => fileSaveRequest(view, args, true),
    },
    {
      name: "filewriteparse",
      aliases: [],
      params: [
        { name: "subdir", optional: false, byRef: false, variadic: false },
        { name: "filename", optional: false, byRef: false, variadic: false },
        { name: "lines", optional: true, byRef: false, variadic: true },
      ],
      call: (view, args) => fileSaveRequest(view, args, false),
    },
    {
      name: "fileappendparse",
      aliases: [],
      params: [
        { name: "subdir", optional: false, byRef: false, variadic: false },
        { name: "filename", optional: false, byRef: false, variadic: false },
        { name: "lines", optional: true, byRef: false, variadic: true },
      ],
      call: (view, args) => fileSaveRequest(view, args, true),
    },
    {
      name: "fileread",
      aliases: [],
      params: [
        { name: "subdir", optional: false, byRef: false, variadic: false },
        { name: "filename", optional: false, byRef: false, variadic: false },
        { name: "handle", optional: true, byRef: true, variadic: false },
        { name: "line", optional: true, byRef: false, variadic: false },
        { name: "result", optional: true, byRef: true, variadic: false },
      ],
      call: (view, args) => {
        const subdir = toStringValue(args[0]?.value as never);
        const filename = toStringValue(args[1]?.value as never);
        const cleanSubdir = subdir.split("\\").join("/").replace(/^\/+|\/+$/g, "");
        const cleanFilename = filename.split("\\").join("/").replace(/^\/+/, "");
        if (cleanSubdir.includes("..") || cleanFilename.includes("..")) {
          throw new ScriptError("builtin.bad-arg", "file path escapes game sandbox");
        }
        const path = `${requireGameId(view)}/${cleanSubdir ? `${cleanSubdir}/` : ""}${cleanFilename}`;
        const request: CommandRequest = {
          kind: "loadBlob",
          blob: { area: "saves", path },
        };
        const out: (readonly [number, Value])[] = [];
        if (args[2]?.ref) out.push([2, ""]);
        if (args[4]?.ref) out.push([4, 0]);
        return {
          value: "",
          out,
          request,
          effects: [{ kind: "mixed", section: "vm", args: [path] }],
        };
      },
    },
  ],
};

/**
 * 4. Programmer's Plugin (pack id "proplug", catalogue id 126, Leuf)
 * 13 occurrences across 6 source files and 4 packages in the corpus.
 * Algorithmic string and bitwise math helpers (pure logic, no I/O).
 */
export const PROPLUG_PLUGIN: PluginDefinition = {
  id: "proplug",
  version: "1.0.0",
  commands: [
    {
      name: "and",
      aliases: [],
      params: [
        { name: "a", optional: false, byRef: false, variadic: false },
        { name: "b", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => {
        const a = Math.trunc(Number(args[0]?.value) || 0);
        const b = Math.trunc(Number(args[1]?.value) || 0);
        return { value: (a & b) };
      },
    },
    {
      name: "or",
      aliases: [],
      params: [
        { name: "a", optional: false, byRef: false, variadic: false },
        { name: "b", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => {
        const a = Math.trunc(Number(args[0]?.value) || 0);
        const b = Math.trunc(Number(args[1]?.value) || 0);
        return { value: (a | b) };
      },
    },
    {
      name: "lprintf",
      aliases: [],
      params: [
        { name: "format", optional: false, byRef: false, variadic: false },
        { name: "args", optional: true, byRef: false, variadic: true },
      ],
      call: (_view, args) => {
        const format = toStringValue(args[0]?.value as never);
        let argIndex = 1;
        let result = "";
        let i = 0;
        while (i < format.length) {
          if (format[i] === "%" && i + 1 < format.length) {
            const spec = format[i + 1];
            if (spec === "%") {
              result += "%";
              i += 2;
              continue;
            }
            const val = args[argIndex]?.value ?? "";
            argIndex += 1;
            if (spec === "d" || spec === "i") {
              result += String(Math.trunc(Number(val) || 0));
            } else if (spec === "f") {
              result += String(Number(val) || 0);
            } else {
              result += toStringValue(val as never);
            }
            i += 2;
          } else {
            result += format[i];
            i += 1;
          }
        }
        return { value: result };
      },
    },
    {
      name: "litncpy",
      aliases: [],
      params: [
        { name: "dest", optional: false, byRef: false, variadic: false },
        { name: "src", optional: false, byRef: false, variadic: false },
        { name: "n", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => {
        const src = toStringValue(args[1]?.value as never);
        const n = Math.max(0, Math.trunc(Number(args[2]?.value) || 0));
        return { value: src.slice(0, n) };
      },
    },
    {
      name: "litcmp",
      aliases: [],
      params: [
        { name: "s1", optional: false, byRef: false, variadic: false },
        { name: "s2", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => {
        const s1 = toStringValue(args[0]?.value as never);
        const s2 = toStringValue(args[1]?.value as never);
        if (s1 < s2) return { value: -1 };
        if (s1 > s2) return { value: 1 };
        return { value: 0 };
      },
    },
    {
      name: "litncmp",
      aliases: [],
      params: [
        { name: "s1", optional: false, byRef: false, variadic: false },
        { name: "s2", optional: false, byRef: false, variadic: false },
        { name: "n", optional: false, byRef: false, variadic: false },
      ],
      call: (_view, args) => {
        const n = Math.max(0, Math.trunc(Number(args[2]?.value) || 0));
        const s1 = toStringValue(args[0]?.value as never).slice(0, n);
        const s2 = toStringValue(args[1]?.value as never).slice(0, n);
        if (s1 < s2) return { value: -1 };
        if (s1 > s2) return { value: 1 };
        return { value: 0 };
      },
    },
    {
      name: "littolower",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => ({ value: toStringValue(args[0]?.value as never).toLowerCase() }),
    },
    {
      name: "littoupper",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => ({ value: toStringValue(args[0]?.value as never).toUpperCase() }),
    },
    {
      name: "littotitle",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => {
        const text = toStringValue(args[0]?.value as never);
        const title = text.replace(/\b\w/g, (char) => char.toUpperCase());
        return { value: title };
      },
    },
    {
      name: "litisalpha",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => {
        const text = toStringValue(args[0]?.value as never);
        return { value: text.length > 0 && /^[A-Za-z]+$/.test(text) ? 1 : 0 };
      },
    },
    {
      name: "litisdigit",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => {
        const text = toStringValue(args[0]?.value as never);
        return { value: text.length > 0 && /^[0-9]+$/.test(text) ? 1 : 0 };
      },
    },
    {
      name: "litisalphadigit",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => {
        const text = toStringValue(args[0]?.value as never);
        return { value: text.length > 0 && /^[A-Za-z0-9]+$/.test(text) ? 1 : 0 };
      },
    },
    {
      name: "litlen",
      aliases: [],
      params: [{ name: "str", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => ({ value: toStringValue(args[0]?.value as never).length }),
    },
  ],
};

/**
 * 5. XFMWin pack (pack id "xfmwin", catalogue id 132, Leuf)
 * 16 occurrences across 4 source files and 2 packages in the corpus.
 * Aliases to native dialogue/prompt systems.
 */
export const XFMWIN_PLUGIN: PluginDefinition = {
  id: "xfmwin",
  version: "1.0.0",
  commands: [
    {
      name: "xfmwin",
      aliases: [],
      params: [{ name: "text", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => ({
        value: null,
        effects: [{ kind: "mixed", section: "ui", args: [toStringValue(args[0]?.value as never)] }],
      }),
    },
    {
      name: "xfmwinprompt",
      aliases: [],
      params: [
        { name: "question", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const refs = args[1]?.ref ? [args[1].ref] : [];
        const out = byRefOut(args, 1, "");
        return {
          value: null,
          out,
          wait: {
            kind: "render.msgbox",
            global: true,
            id: "xfmwinprompt",
            payload: [toStringValue(args[0]?.value as never)],
            resumeRefs: refs,
          },
        };
      },
    },
    {
      name: "xfmwinpromptnum",
      aliases: [],
      params: [
        { name: "question", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const refs = args[1]?.ref ? [args[1].ref] : [];
        const out = byRefOut(args, 1, 0);
        return {
          value: null,
          out,
          wait: {
            kind: "render.msgbox",
            global: true,
            id: "xfmwinpromptnum",
            payload: [toStringValue(args[0]?.value as never)],
            resumeRefs: refs,
          },
        };
      },
    },
  ],
};

/**
 * 6. Kaimu pack (pack id "kaimu", catalogue id 119)
 * 3 occurrences across 1 source file and 1 package in the corpus.
 * MidiTools and TransTools transitions and fades.
 */
export const KAIMU_PLUGIN: PluginDefinition = {
  id: "kaimu",
  version: "1.0.0",
  commands: [
    {
      name: "fademidiin",
      aliases: [],
      params: [
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "speed", optional: true, byRef: false, variadic: false },
      ],
      doc: {
        summary: "Fade MIDI music in.",
        behaviour: "Retains the legacy command as a deprecated audio cue without inventing a replacement mapping; it never raises a runtime error or waits.",
        groups: ["audio-23"],
        see: ["docs/spec/engine/audio-media.md#legacy-audio-command-mapping"],
        tags: ["deprecated"],
        replacedBy: { kind: "syntax", text: "No verified standard replacement; retain this command for compatibility." },
        reason: "Toolkit 3.1 exposes the command, but its fade timing semantics are not specified by the compatibility contract.",
      } satisfies BuiltinDoc,
      call: (_view, args) => effect(args, "audio"),
    },
    {
      name: "fademidiout",
      aliases: [],
      params: [{ name: "speed", optional: true, byRef: false, variadic: false }],
      doc: {
        summary: "Fade MIDI music out.",
        behaviour: "Retains the legacy command as a deprecated audio cue without inventing a replacement mapping; it never raises a runtime error or waits.",
        groups: ["audio-23"],
        see: ["docs/spec/engine/audio-media.md#legacy-audio-command-mapping"],
        tags: ["deprecated"],
        replacedBy: { kind: "syntax", text: "No verified standard replacement; retain this command for compatibility." },
        reason: "Toolkit 3.1 exposes the command, but its fade timing semantics are not specified by the compatibility contract.",
      } satisfies BuiltinDoc,
      call: (_view, args) => effect(args, "audio"),
    },
    {
      name: "setmidivolume",
      aliases: [],
      params: [{ name: "volume", optional: false, byRef: false, variadic: false }],
      doc: {
        summary: "Set the legacy MIDI music volume.",
        behaviour: "Retains the legacy command as a deprecated audio cue without inventing a replacement mapping; it never raises a runtime error or waits.",
        groups: ["audio-23"],
        see: ["docs/spec/engine/audio-media.md#legacy-audio-command-mapping"],
        tags: ["deprecated"],
        replacedBy: { kind: "syntax", text: "No verified standard replacement; retain this command for compatibility." },
        reason: "Toolkit 3.1 exposes the command, but its independent MIDI-volume semantics are not specified by the compatibility contract.",
      } satisfies BuiltinDoc,
      call: (_view, args) => effect(args, "audio"),
    },
    {
      name: "fadetoblack",
      aliases: [],
      params: [{ name: "speed", optional: true, byRef: false, variadic: false }],
      call: (_view, args) => effect(args, "fx"),
    },
    {
      name: "fadetowhite",
      aliases: [],
      params: [{ name: "speed", optional: true, byRef: false, variadic: false }],
      call: (_view, args) => effect(args, "fx"),
    },
  ],
};

/**
 * 7. TWButton pack (pack id "twbutton", catalogue id 130, Wintermoon)
 * 6 occurrences across 2 source files and 2 packages in the corpus.
 * On-screen button input widgets.
 */
export const TWBUTTON_PLUGIN: PluginDefinition = {
  id: "twbutton",
  version: "1.0.0",
  commands: [
    {
      name: "twsetbutton",
      aliases: [],
      params: [
        { name: "id", optional: false, byRef: false, variadic: false },
        { name: "file", optional: false, byRef: false, variadic: false },
        { name: "x", optional: false, byRef: false, variadic: false },
        { name: "y", optional: false, byRef: false, variadic: false },
        { name: "w", optional: true, byRef: false, variadic: false },
        { name: "h", optional: true, byRef: false, variadic: false },
      ],
      call: (_view, args) => effect(args, "ui"),
    },
    {
      name: "twcheckbutton",
      aliases: [],
      params: [
        { name: "id", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (_view, args) => {
        const out = byRefOut(args, 1, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "ui" }] };
      },
    },
    {
      name: "twdelbutton",
      aliases: [],
      params: [{ name: "id", optional: false, byRef: false, variadic: false }],
      call: (_view, args) => effect(args, "ui"),
    },
    {
      name: "twsetbuttonfilter",
      aliases: [],
      params: [{ name: "args", optional: true, byRef: false, variadic: true }],
      call: (_view, args) => effect(args, "ui"),
    },
    {
      name: "twcheckbuttonfilter",
      aliases: [],
      params: [{ name: "args", optional: true, byRef: false, variadic: true }],
      call: (_view, args) => {
        const out = byRefOut(args, 0, 0);
        return { value: 0, out, effects: [{ kind: "mixed", section: "ui" }] };
      },
    },
  ],
};

/** All first-party native legacy plugin definitions. */
export const NATIVE_PACKS: readonly PluginDefinition[] = [
  WORLD_PLUGIN,
  RENDER_PLUGIN,
  GSMISC_PLUGIN,
  TRIUKEN_PLUGIN,
  FILEREADWRITE_PLUGIN,
  PROPLUG_PLUGIN,
  XFMWIN_PLUGIN,
  KAIMU_PLUGIN,
  TWBUTTON_PLUGIN,
];

/** Map of pack ID to PluginDefinition for host resolvers. */
export const NATIVE_PACK_TABLE: Readonly<Record<string, PluginDefinition>> = {
  world: WORLD_PLUGIN,
  render: RENDER_PLUGIN,
  gsmisc: GSMISC_PLUGIN,
  triuken: TRIUKEN_PLUGIN,
  filereadwrite: FILEREADWRITE_PLUGIN,
  proplug: PROPLUG_PLUGIN,
  xfmwin: XFMWIN_PLUGIN,
  kaimu: KAIMU_PLUGIN,
  twbutton: TWBUTTON_PLUGIN,
};
