/**
 * Sandboxed RPGCode file commands (E-97, AD-17; R-38b and U5).
 *
 * The command pack never touches a host file. It records `asset`, `loadBlob`
 * and `saveBlob` requests; the runner answers them and resumes the blocking
 * `blob` wait. Handle contents are hex text in VmState so snapshots remain
 * plain JSON data (G1).
 */

import { decodeCp1252, encodeCp1252 } from "../../formats/binary/cp1252.ts";
import type { BuiltinSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import { requireGameId } from "../game-id.ts";
import type { CommandRequest, CommandResult, CommandView } from "../plugin.ts";
import type { FileHandle } from "../state.ts";
import { toStringValue, truthy } from "../values.ts";

const HEX = /^[0-9a-f]*$/;
const INTERNAL = "__file_";

type FileMode = FileHandle["mode"];

type FileInfo = { readonly file: string; readonly path: string; readonly area: "saves" | "files" };

function fold(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return out.split("\\").join("/");
}

function fileInfo(view: CommandView, args: readonly { value: unknown }[]): FileInfo {
  const file = fold(toStringValue(args[0]?.value as never));
  const folder = fold(toStringValue(args[1]?.value as never));
  if (
    file === "" || folder === "" ||
    file.startsWith("/") || folder.startsWith("/") ||
    file.includes("..") || folder.includes("..") ||
    file.includes(":") || folder.includes(":")
  ) {
    throw new ScriptError("builtin.bad-arg", "file paths must stay inside the game sandbox");
  }
  const area = folder === "saved" ? "saves" : "files";
  const path = `${requireGameId(view)}/${folder}/${file}`;
  return { file, path, area };
}

function state(view: CommandView) {
  if (view.state === undefined) throw new ScriptError("builtin.bad-arg", "file commands need VM state");
  return view.state.vm;
}

function handle(view: CommandView, id: string): FileHandle {
  const file = state(view).files.find((item) => item.id === id);
  if (file === undefined) throw new ScriptError("builtin.bad-arg", `unknown file handle "${id}"`);
  return file;
}
function openRequest(info: FileInfo, mode: FileMode, request: "loadBlob" | "saveBlob", then: string): CommandResult {
  const payload: CommandRequest = {
    kind: request,
    blob: { area: info.area, path: info.path },
    ...(request === "saveBlob" ? { hex: "" } : {}),
  };
  return {
    value: null,
    request: payload,
    then: { command: then, args: [info.file, info.path, mode, info.area] },
  };
}

function openInput(view: CommandView, args: readonly { value: unknown }[], mode: FileMode): CommandResult {
  const info = fileInfo(view, args);
  return openRequest(info, mode, "loadBlob", `${INTERNAL}open_save`);
}

function byRef(args: readonly { ref: unknown }[], index: number): boolean {
  return args[index]?.ref !== null && args[index]?.ref !== undefined;
}

function decodeHex(value: unknown): Uint8Array {
  const text = typeof value === "string" ? value : "";
  if (!HEX.test(text) || text.length % 2 !== 0) return new Uint8Array(0);
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function encodeHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function handleEffect(action: string, ...args: (string | number)[]) {
  return { kind: "vm.control" as const, args: ["file", action, ...args] };
}

const OPEN_PARAMS = [
  { name: "file", optional: false, byRef: false, variadic: false },
  { name: "folder", optional: false, byRef: false, variadic: false },
] as const;

const SAVE_NAME_PARAMS = [{ name: "file", optional: false, byRef: false, variadic: false }] as const;
const FILE_COMMANDS: BuiltinSpec[] = [
  {
    name: "save", aliases: [], params: SAVE_NAME_PARAMS,
    doc: { summary: "Save the current game state to a file.", behaviour: "Writes Saved/<name>.sav through the game's sandboxed save area and blocks until the host confirms the write. Does nothing on boards that disable saving.", groups: ["files-saves-os-15"] },
    call: (view, args) => {
      const board = view.state?.world.board;
      if ((board?.disableSaving ?? 0) !== 0) return { value: null };
      const info = fileInfo(view, [{ value: `${toStringValue(args[0]?.value as never)}.sav` }, { value: "saved" }]);
      return { value: null, request: { kind: "saveBlob", gameSave: true, blob: { area: info.area, path: info.path }, hex: "" } };
    },
  },
  {
    name: "load", aliases: [], params: SAVE_NAME_PARAMS,
    doc: { summary: "Load the game state from a file.", behaviour: "Loads Saved/<name>.sav through the game's sandboxed save area; a valid save replaces the live game state and resumes its saved VM threads.", groups: ["files-saves-os-15"] },
    call: (view, args) => {
      const info = fileInfo(view, [{ value: `${toStringValue(args[0]?.value as never)}.sav` }, { value: "saved" }]);
      return { value: null, request: { kind: "loadBlob", gameLoad: true, blob: { area: info.area, path: info.path } } };
    },
  },
  { name: "openfileinput", aliases: [], params: OPEN_PARAMS, call: (view, args) => openInput(view, args, "input") },
  { name: "openfilebinary", aliases: [], params: OPEN_PARAMS, call: (view, args) => openInput(view, args, "binary") },
  {
    name: "openfileoutput", aliases: [], params: OPEN_PARAMS,
    call: (view, args) => { const info = fileInfo(view, args); return openRequest(info, "output", "saveBlob", `${INTERNAL}open_write`); },
  },
  {
    name: "openfileappend", aliases: [], params: OPEN_PARAMS,
    call: (view, args) => openInput(view, args, "append"),
  },
  {
    name: "closefile", aliases: [],
    params: [{ name: "handle", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [handleEffect("close", toStringValue(args[0]?.value ?? ""))] }),
  },
  {
    name: "fileinput", aliases: [],
    params: [
      { name: "handle", optional: false, byRef: false, variadic: false },
      { name: "line", optional: true, byRef: true, variadic: false },
    ],
    call: (view, args) => {
      const file = handle(view, toStringValue(args[0]?.value ?? ""));
      const bytes = decodeHex(file.data);
      if (file.position >= bytes.length) return { value: "", ...(byRef(args, 1) ? { out: [[1, ""] as [number, string]] } : {}) };
      let end = file.position;
      while (end < bytes.length && bytes[end] !== 10) end += 1;
      const contentEnd = end > file.position && bytes[end - 1] === 13 ? end - 1 : end;
      const line = decodeCp1252(bytes, file.position, contentEnd);
      const next = end < bytes.length ? end + 1 : end;
      return {
        value: line,
        ...(byRef(args, 1) ? { out: [[1, line] as [number, string]] } : {}),
        effects: [handleEffect("position", file.id, next)],
      };
    },
  },
  {
    name: "fileget", aliases: [],
    params: [
      { name: "handle", optional: false, byRef: false, variadic: false },
      { name: "byte", optional: true, byRef: true, variadic: false },
    ],
    call: (view, args) => {
      const file = handle(view, toStringValue(args[0]?.value ?? ""));
      const bytes = decodeHex(file.data);
      const value = file.position >= bytes.length ? 0 : bytes[file.position]!;
      const position = file.position >= bytes.length ? file.position : file.position + 1;
      return { value, ...(byRef(args, 1) ? { out: [[1, value] as [number, number]] } : {}), effects: [handleEffect("position", file.id, position)] };
    },
  },
  {
    name: "fileprint", aliases: [],
    params: [
      { name: "handle", optional: false, byRef: false, variadic: false },
      { name: "text", optional: false, byRef: false, variadic: false },
    ],
    call: (view, args) => {
      const file = handle(view, toStringValue(args[0]?.value ?? ""));
      if (file.mode !== "output" && file.mode !== "append") throw new ScriptError("builtin.bad-arg", "filePrint needs an output handle");
      const encoded = encodeCp1252(`${toStringValue(args[1]?.value ?? "")}\r\n`);
      if (!encoded.ok) throw new ScriptError("builtin.bad-arg", encoded.error.message);
      const bytes = decodeHex(file.data);
      const next = new Uint8Array(bytes.length + encoded.value.length);
      next.set(bytes); next.set(encoded.value, bytes.length);
      return { value: null, request: { kind: "saveBlob", blob: { area: file.area, path: file.path }, hex: encodeHex(next) }, then: { command: `${INTERNAL}save_done`, args: [file.id, encodeHex(next), next.length] } };
    },
  },
  {
    name: "fileput", aliases: [],
    params: [
      { name: "handle", optional: false, byRef: false, variadic: false },
      { name: "byte", optional: false, byRef: false, variadic: false },
    ],
    call: (view, args) => {
      const file = handle(view, toStringValue(args[0]?.value ?? ""));
      if (file.mode !== "output" && file.mode !== "append" && file.mode !== "binary") throw new ScriptError("builtin.bad-arg", "filePut needs an output handle");
      const value = args[1]?.value;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) throw new ScriptError("builtin.bad-arg", "filePut byte must be an integer from 0 to 255");
      const bytes = decodeHex(file.data);
      const position = file.position;
      const next = position === bytes.length ? new Uint8Array([...bytes, value]) : bytes.slice();
      if (position < next.length) next[position] = value;
      return { value: null, request: { kind: "saveBlob", blob: { area: file.area, path: file.path }, hex: encodeHex(next) }, then: { command: `${INTERNAL}save_done`, args: [file.id, encodeHex(next), position + 1] } };
    },
  },
  {
    name: "fileeof", aliases: [],
    params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "flag", optional: true, byRef: true, variadic: false }],
    call: (view, args) => { const file = handle(view, toStringValue(args[0]?.value ?? "")); const eof = decodeHex(file.data).length <= file.position ? 1 : 0; return { value: eof, ...(byRef(args, 1) ? { out: [[1, eof] as [number, number]] } : {}) }; },
  },
  {
    name: "apppath", aliases: [], params: [{ name: "path", optional: true, byRef: true, variadic: false }],
    call: (view, args) => { const path = requireGameId(view); return { value: path, ...(byRef(args, 0) ? { out: [[0, path] as [number, string]] } : {}) }; },
  },
  {
    name: `${INTERNAL}open_save`, aliases: [],
    params: [
      { name: "ok", optional: false, byRef: false, variadic: false }, { name: "value", optional: false, byRef: false, variadic: false },
      { name: "file", optional: false, byRef: false, variadic: false }, { name: "path", optional: false, byRef: false, variadic: false }, { name: "mode", optional: false, byRef: false, variadic: false }, { name: "area", optional: false, byRef: false, variadic: false },
    ],
    doc: {
      summary: "Internal continuation for opening a file through the host service.",
      behaviour: "Resolve the host reply in command order, emit the file-open effect on success, or request the asset and continue with the internal asset continuation; never callable by game-authored RPGCode.",
      groups: ["internal"],
      access: "internal",
      waits: { kind: "host-request", summary: "Resumes only after the host asset request replies." },
    },
    call: (_view, args) => {
      const ok = truthy(args[0]?.value ?? 0); const file = toStringValue(args[2]?.value ?? ""); const path = toStringValue(args[3]?.value ?? ""); const mode = toStringValue(args[4]?.value ?? "input") as FileMode; const area = toStringValue(args[5]?.value ?? "saves") as "saves" | "files";
      if (ok) return { value: null, effects: [handleEffect("open", file, mode, path, area, typeof args[1]?.value === "string" ? args[1].value : "")] };
      if (mode === "append") return { value: null, effects: [handleEffect("open", file, mode, path, area, "")] };
      return { value: null, request: { kind: "asset", key: path.slice(path.indexOf("/") + 1) }, then: { command: `${INTERNAL}open_asset`, args: [file, path, mode] } };
    },
  },
  {
    name: `${INTERNAL}open_asset`, aliases: [],
    params: [{ name: "ok", optional: false, byRef: false, variadic: false }, { name: "value", optional: false, byRef: false, variadic: false }, { name: "file", optional: false, byRef: false, variadic: false }, { name: "path", optional: false, byRef: false, variadic: false }, { name: "mode", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [handleEffect("open", toStringValue(args[2]?.value ?? ""), toStringValue(args[4]?.value ?? "input"), toStringValue(args[3]?.value ?? ""), "files", truthy(args[0]?.value ?? 0) && typeof args[1]?.value === "string" ? args[1].value : "")] }),
  },
  {
    name: `${INTERNAL}open_write`, aliases: [],
    params: [{ name: "ok", optional: false, byRef: false, variadic: false }, { name: "value", optional: false, byRef: false, variadic: false }, { name: "file", optional: false, byRef: false, variadic: false }, { name: "path", optional: false, byRef: false, variadic: false }, { name: "mode", optional: false, byRef: false, variadic: false }, { name: "area", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [handleEffect("open", toStringValue(args[2]?.value ?? ""), toStringValue(args[4]?.value ?? "output"), toStringValue(args[3]?.value ?? ""), toStringValue(args[5]?.value ?? "files"), "")] }),
  },
  {
    name: `${INTERNAL}save_done`, aliases: [],
    params: [{ name: "ok", optional: false, byRef: false, variadic: false }, { name: "value", optional: false, byRef: false, variadic: false }, { name: "file", optional: false, byRef: false, variadic: false }, { name: "data", optional: false, byRef: false, variadic: false }, { name: "position", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [handleEffect("data", toStringValue(args[2]?.value ?? ""), toStringValue(args[3]?.value ?? ""), Number(args[4]?.value ?? 0))] }),
  },
];

export const FILE_SPECS: readonly BuiltinSpec[] = FILE_COMMANDS;
