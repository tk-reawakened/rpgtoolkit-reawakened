// The registered battle built-ins and the battle rows of docs/spec/engine/rpgcode-functions.md
// (battle built-ins) name the same commands with the same purpose text; `__`-prefixed host
// continuations are internal and are not catalogued.
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BATTLE_COMMANDS } from "../src/index.ts";

const functionsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "engine", "rpgcode-functions.md");

function catalogueRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of readFileSync(functionsPath, "utf8").split("\n")) {
    const cells = line.split(" | ");
    const name = /^\| `([a-z0-9_]+)`$/.exec(cells[0] ?? "")?.[1];
    if (name !== undefined && cells.length >= 3) rows.set(name, cells[2]!.trim());
  }
  return rows;
}

test("every registered public battle built-in has a catalogue row with the registered purpose", () => {
  const rows = catalogueRows();
  const publicCommands = BATTLE_COMMANDS.filter((command) => !command.name.startsWith("__"));
  ok(publicCommands.length > 30);
  for (const command of publicCommands) {
    for (const name of [command.name, ...command.aliases]) {
      ok(rows.has(name), `${name} has a row in rpgcode-functions.md`);
    }
    equal(rows.get(command.name), command.doc?.summary, `${command.name} purpose matches its registered summary`);
  }
  for (const name of ["fp", "givefp", "dp"]) ok(publicCommands.some((command) => command.name === name), `${name} is registered`);
});
