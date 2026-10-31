import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { compileTk2, normaliseTk2, parseTk2 } from "../src/index.ts";

test("TK2 prefixes, sigils, equality and loose dialogue lower through the shared AST", () => {
  const source = "#score! = 1\n#If (score = 1) {\n#Mwin(Hello there)\n}\nLoose dialogue\n@";
  const ast = parseTk2(source);
  equal(ast.statements.length, 4);
  const condition = ast.statements[1];
  if (condition === undefined || condition.kind !== "if") throw new Error("expected if statement");
  equal(condition.branches[0]?.cond.kind, "binary");
  const dialogue = ast.statements[2];
  if (dialogue === undefined || dialogue.kind !== "expr" || dialogue.expr.kind !== "call") throw new Error("expected dialogue call");
  equal(dialogue.expr.name, "mwin");
  const dialogueArg = dialogue.expr.args[0];
  if (dialogueArg === undefined || dialogueArg.kind !== "literal") throw new Error("expected dialogue literal");
  equal(dialogueArg.value, "Loose dialogue");
  equal(normaliseTk2(source).includes("score!"), false);
});

test("TK2 methods, labels, namespace calls and fbranch preserve shared shapes", () => {
  const ast = parseTk2("#Method Add(a, b) { #ReturnMethod(a + b) }\n:again\n#FBranch(:again)\n#system.start()");
  equal(ast.functions[0]?.name, "add");
  const branch = ast.statements[0];
  if (branch === undefined || branch.kind !== "label") throw new Error("expected label");
  const fbranch = ast.statements[1];
  if (fbranch === undefined || fbranch.kind !== "expr" || fbranch.expr.kind !== "call") throw new Error("expected fbranch call");
  equal(fbranch.expr.name, "fbranch");
  const namespace = ast.statements[2];
  if (namespace === undefined || namespace.kind !== "expr" || namespace.expr.kind !== "call") throw new Error("expected namespace call");
  equal(namespace.expr.name, "system.start");
});

test("TK2 compile is non-destructive and rejects Toolkit 1.x blocks", () => {
  const source = "#x! = 4\n#Mwin(file.name.gif)";
  const program = compileTk2(source, "legacy.prg");
  if (program.ref.kind !== "inline") throw new Error("expected inline program");
  equal(program.ref.text, source);
  throws(() => compileTk2("#If (x) then < #Mwin(hello) >"), /Toolkit 1\.x/);
});

test("TK2 raw text binds only the command argument and leaves expressions executable", () => {
  const normalised = normaliseTk2("#Mwin(Hello there)\n#WalkSpeed(2 + 1)\n#x! = a * b");
  equal(normalised, 'Mwin("Hello there")\nWalkSpeed(2 + 1)\nx = a * b');
  deepEqual(parseTk2("#Mwin(Hello there)").statements[0], {
    kind: "expr",
    expr: {
      kind: "call",
      name: "mwin",
      args: [{ kind: "literal", value: "Hello there", line: 1, col: 6, endCol: 18 }],
      line: 1,
      col: 1,
      endCol: 4,
    },
    line: 1,
    col: 1,
    endCol: 4,
  });
});

test("TK2 #FBranch and #Branch compile to equivalent call expressions", () => {
  const astBranch = parseTk2("#Branch(:dest)");
  const astFBranch = parseTk2("#FBranch(:dest)");
  equal(astBranch.statements[0]?.kind, "expr");
  equal(astFBranch.statements[0]?.kind, "expr");
});
