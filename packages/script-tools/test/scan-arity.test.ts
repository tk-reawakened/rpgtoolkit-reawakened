import { deepEqual, match } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import { buildIndex, lint } from "../src/index.ts";

// docs/spec/engine/rpgcode-functions.md: scan takes x, y and buffer position.
test("scan lint accepts three arguments and diagnoses too few or too many", () => {
  const text = "scan(1, 2, 0)\nscan(1, 2)\nscan(1, 2, 0, 4)\n";
  const index = buildIndex([{ name: "main.prg", ref: { kind: "inline", text, ir: "1" } }]);
  const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));
  const diagnostics = lint(index, { plugins }).diagnostics.filter((d) => d.rule === "lint/command-arity");
  deepEqual(diagnostics.map((d) => d.range.start.line), [2, 3]);
  for (const diagnostic of diagnostics) match(diagnostic.message, /`scan`/);
});

const fixture = fileURLToPath(new URL("../../../fixtures/legacy/FinalDestiny/Prg/system.prg", import.meta.url));
test("Final Destiny scan calls lint without arity warnings", { skip: existsSync(fixture) ? false : "run pnpm fixtures:fetch" }, () => {
  const text = new TextDecoder("windows-1252").decode(readFileSync(fixture));
  const index = buildIndex([{ name: "system.prg", ref: { kind: "inline", text, ir: "1", dialect: "tk2" } }]);
  deepEqual(index.diagnostics, []);
  const calls = index.programs[0]!.calls.filter((call) => call.name.toLowerCase() === "scan");
  deepEqual(calls.map((call) => [call.pos.line, call.arity]), [[69, 3], [81, 3]]);
  const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));
  deepEqual(lint(index, { plugins }).diagnostics.filter((d) => d.rule === "lint/command-arity" && d.message.includes("`scan`")), []);
});
