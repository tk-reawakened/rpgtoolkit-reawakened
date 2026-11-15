// The quick reference, command insertion and header template (story 11.7; docs/spec/engine/rpgcode-tooling.md#tool-10).
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  commandInsertion,
  commandReference,
  createProgramFile,
  DEFAULT_HEADER_TEMPLATE,
  expandHeaderTemplate,
  filterCommandReference,
  insertCommandEdit,
  insertHeaderCommand,
  PREFERENCE_CATALOGUE,
  DEFAULT_PROGRAM_PREFERENCES,
  programPathIn,
  programPreferencesFrom,
  suggestProgramPath,
} from "../src/index.ts";

test("the quick reference lists every public command and alias once, with syntax, summary and the canonical name", () => {
  const entries = commandReference();
  ok(entries.length > 100);
  const names = entries.map((entry) => entry.name.toLowerCase());
  equal(new Set(names).size, names.length, "one row per name");
  deepEqual([...names].sort(), names, "ordered by name");
  const mwin = entries.find((entry) => entry.name.toLowerCase() === "mwin");
  ok(mwin !== undefined);
  equal(mwin.aliasOf, null);
  ok(mwin.syntax.startsWith("mwin(") && mwin.syntax.endsWith(")"));
  ok(mwin.summary !== null && mwin.summary.length > 0);
  const alias = entries.find((entry) => entry.aliasOf !== null);
  ok(alias !== undefined && alias.canonicalName !== alias.name);
});

test("syntax marks optional parameters, by-reference parameters and variadic ones", () => {
  const entries = commandReference();
  ok(entries.some((entry) => /\[[^\]]+\]/.test(entry.syntax)), "an optional parameter is bracketed");
  ok(entries.some((entry) => entry.syntax.includes("&")), "a by-reference parameter has &");
  ok(entries.some((entry) => entry.syntax.includes("...")), "a variadic parameter has ...");
});

test("inserting writes name( and the required parameter names, and selects them", () => {
  const entry = { name: "walk", canonicalName: "walk", aliasOf: null, syntax: "walk(x, y, [speed])", summary: null, groups: [], required: ["x", "y"] };
  deepEqual(commandInsertion(entry), { text: "walk(x, y)", select: { from: 5, to: 9 } });
  const none = { ...entry, name: "end", syntax: "end()", required: [] };
  deepEqual(commandInsertion(none), { text: "end()", select: { from: 4, to: 4 } });
  const edit = insertCommandEdit(entry, 10, 12);
  deepEqual(edit.command, { type: "edit-text", label: "Insert walk", edits: [{ from: 10, to: 12, text: "walk(x, y)" }] });
  deepEqual(edit.select, { from: 15, to: 19 });
});

test("filtering matches every word against name, syntax, summary and group", () => {
  const entries = commandReference();
  equal(filterCommandReference(entries, ""), entries);
  const found = filterCommandReference(entries, "MWIN");
  ok(found.length > 0 && found.every((entry) => /mwin/i.test(`${entry.name} ${entry.syntax} ${entry.summary ?? ""} ${entry.groups.join(" ")}`)));
  equal(filterCommandReference(entries, "mwin zzzzqqqq").length, 0);
});

test("header templates expand {file}, {name} and {path}, leave other braces alone and use LF", () => {
  equal(expandHeaderTemplate("// {file} | {name} | {path} | {other}\r\n", "Prg/sub/intro.prg"), "// intro.prg | intro | Prg/sub/intro.prg | {other}\n");
  equal(expandHeaderTemplate(DEFAULT_HEADER_TEMPLATE, "intro.prg"), "// intro.prg\n\n");
  equal(expandHeaderTemplate("{name}", "Prg/.hidden"), ".hidden");
});

test("the header insertion is one labelled edit at the start, and nothing when the template is empty", () => {
  deepEqual(insertHeaderCommand("// {name}\n", "Prg/a.prg"), { type: "edit-text", label: "Insert header", edits: [{ from: 0, to: 0, text: "// a\n" }] });
  equal(insertHeaderCommand("", "Prg/a.prg"), null);
});

test("the header template is a project-layer preference with the default and a length limit", () => {
  const entry = PREFERENCE_CATALOGUE.find((item) => item.id === "program.headerTemplate");
  ok(entry !== undefined && entry.type === "string");
  equal(entry.default, DEFAULT_HEADER_TEMPLATE);
  equal(entry.projectLayer, true);
  equal(entry.maxLength, 500);
});

test("New program writes the expanded template with CRLF and rejects a listed case-insensitive collision", async () => {
  const host = createMemoryPlatformServices({ files: { "Prg/Intro.prg": new Uint8Array([120]) } });
  const made = await createProgramFile(host.fs, "Prg/scene one.prg", "// {name}\n\n");
  deepEqual(made, { ok: true, path: "Prg/scene one.prg" });
  deepEqual(host.bytesOf("Prg/scene one.prg"), Uint8Array.from("// scene one\r\n\r\n", (ch) => ch.charCodeAt(0)));
  const clash = await createProgramFile(host.fs, "Prg/intro.prg", "// x");
  ok(!clash.ok && clash.reason === "exists");
  deepEqual(host.bytesOf("Prg/Intro.prg"), new Uint8Array([120]));
  const differentlyCasedFolder = await createProgramFile(host.fs, "prg/intro.prg", "// must not overwrite");
  ok(!differentlyCasedFolder.ok && differentlyCasedFolder.reason === "exists");
  deepEqual(host.bytesOf("Prg/Intro.prg"), new Uint8Array([120]));
  const unusable = await createProgramFile(host.fs, "Prg/notes.txt", "");
  ok(!unusable.ok && unusable.reason === "invalid");
  const bare = await createProgramFile(host.fs, "Prg/.prg", "");
  ok(!bare.ok && bare.reason === "invalid");
  const unicode = await createProgramFile(host.fs, "Prg/snow.prg", "\u2603");
  ok(!unicode.ok && unicode.reason === "invalid");
  equal(host.bytesOf("Prg/snow.prg"), undefined);
  const root = await createProgramFile(host.fs, "top.prg", "// {path}");
  deepEqual(root, { ok: true, path: "top.prg" });
  deepEqual(host.bytesOf("top.prg"), Uint8Array.from("// top.prg", (ch) => ch.charCodeAt(0)));
});

test("New program rejects an existing file through differently-cased folder components on case-sensitive storage", async () => {
  const files = new Map<string, Uint8Array>([["Prg/Intro.prg", new Uint8Array([120])]]);
  const original = files.get("Prg/Intro.prg")!;
  let writes = 0;
  const fs = {
    list: async (path: string) => ({
      ok: true as const,
      value: path === ""
        ? [{ name: "Prg", kind: "directory" as const }]
        : path === "Prg" ? [{ name: "Intro.prg", kind: "file" as const }] : [],
    }),
    write: async (path: string, bytes: Uint8Array) => {
      writes += 1;
      files.set(path, bytes);
      return { ok: true as const, value: undefined };
    },
  };
  const result = await createProgramFile(fs, "prg/intro.prg", "// must not overwrite");
  ok(!result.ok && result.reason === "exists");
  equal(writes, 0);
  deepEqual(files.get("Prg/Intro.prg"), original);
  equal(files.has("prg/intro.prg"), false);
});

test("New program keeps the stored directory casing on case-sensitive storage", async () => {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const fs = {
    list: async (path: string) => ({
      ok: true as const,
      value: path === "" ? [{ name: "Prg", kind: "directory" as const }] : [],
    }),
    write: async (path: string, bytes: Uint8Array) => {
      writes.push(path);
      files.set(path, bytes);
      return { ok: true as const, value: undefined };
    },
  };
  const result = await createProgramFile(fs, "prg/new.prg", "// {path}");
  deepEqual(result, { ok: true, path: "Prg/new.prg" });
  deepEqual(writes, ["Prg/new.prg"]);
  deepEqual(files.get("Prg/new.prg"), Uint8Array.from("// Prg/new.prg", (ch) => ch.charCodeAt(0)));
  equal(files.has("prg/new.prg"), false);
});

test("the suggested name is the first free untitled program in the programs folder", async () => {
  const host = createMemoryPlatformServices({ files: { "Prg/Untitled.prg": new Uint8Array([1]), "Prg/untitled 2.prg": new Uint8Array([1]) } });
  equal(await suggestProgramPath(host.fs, { projectFolder: "" }), "Prg/untitled 3.prg");
  equal(await suggestProgramPath(host.fs, { projectFolder: "Game/demo" }), "Game/demo/Prg/untitled.prg");
  equal(programPathIn({ projectFolder: "" }, "go"), "Prg/go.prg");
});

test("the program preferences are the catalogue's until a layer sets them", () => {
  const defaults = programPreferencesFrom({ rows: [], problems: [], projectLayerAvailable: false });
  deepEqual(defaults, DEFAULT_PROGRAM_PREFERENCES);
  equal(defaults.headerTemplate, DEFAULT_HEADER_TEMPLATE);
  equal(defaults.keywordColor, "#0000ff");
  equal(defaults.commentItalic, true);
});
