import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Ast } from "../src/script/ast.ts";
import { parse } from "../src/script/parse.ts";
import { scan } from "../src/script/lex.ts";
import { ScriptError } from "../src/script/errors.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "parser-oop");
const names = ["collection", "widgets", "inheritance", "references"] as const;

function semanticAst(value: unknown): unknown {
  // Successful-node source locations are intentionally omitted (`line`, `col`
  // and `endCol` alike: the spans are additive and pinned by
  // script-spans-ast.test.ts). Structure, operators, grouping, declarations and
  // reference distinctions are semantic.
  if (Array.isArray(value)) return value.map(semanticAst);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "line" && key !== "col" && key !== "endCol") result[key] = semanticAst(child);
  }
  return result;
}


function parseSource(source: string): Ast {
  const { tokens } = scan(source, true);
  return parse(tokens);
}


function parseFixture(name: (typeof names)[number]): unknown {
  const source = readFileSync(join(fixtureRoot, `${name}.prg`), "utf8");
  return semanticAst(parseSource(source));
}

for (const name of names) {
  test(`authored OOP parser golden: ${name}`, () => {
    const actual = parseFixture(name);
    const goldenText = readFileSync(join(fixtureRoot, `${name}.ast.json`), "utf8");
    deepEqual(actual, JSON.parse(goldenText));
  });
}

test("OOP parser goldens retain reference targets, nested arguments and base order", () => {
  const references = parseFixture("references") as Ast;
  const select = references.functions.find((fn) => fn.name === "selectcell");
  if (!select) throw new Error("expected selectCell function");
  const referenceReturn = select.body.find((stmt) => stmt.kind === "return");
  if (!referenceReturn || referenceReturn.kind !== "return") throw new Error("expected reference return");
  equal(referenceReturn.byRef, true);
  const update = references.functions.find((fn) => fn.name === "update");
  if (!update) throw new Error("expected update function");
  const combined = update.body.find((stmt) =>
    stmt.kind === "expr" &&
    stmt.expr.kind === "assign" &&
    stmt.expr.target.kind === "decl" &&
    stmt.expr.target.name === "combined",
  );
  if (!combined || combined.kind !== "expr" || combined.expr.kind !== "assign" || combined.expr.value.kind !== "call") {
    throw new Error("expected nested selectCell argument assignment");
  }
  const [argument] = combined.expr.value.args;
  if (!argument || argument.kind !== "binary") throw new Error("expected grouped binary call argument");
  deepEqual(semanticAst(argument), {
    kind: "binary",
    operator: "+",
    left: { kind: "call", name: "globalcell", args: [] },
    right: { kind: "variable", name: "index", scope: null },
  });
  const inheritance = parseFixture("inheritance") as Ast;
  const hybrid = inheritance.classes.find((classDef) => classDef.name === "hybrid");
  if (!hybrid) throw new Error("expected Hybrid declaration");
  deepEqual(hybrid.bases, ["leftbranch", "rightbranch"]);
});

test("malformed OOP source reports stable syntax code and source location", () => {
  for (const [source, line] of [
    ["function open() {\n  return 1\n", 3],
    ["class Broken {\n  method broken( { }\n}", 2],
  ] as const) {
    let caught: unknown;
    try {
      parseSource(source);
    } catch (error) {
      caught = error;
    }
    equal(caught instanceof ScriptError, true);
    const error = caught as ScriptError;
    equal(error.code, "syntax.error");
    equal(error.pos?.line, line);
  }
});
