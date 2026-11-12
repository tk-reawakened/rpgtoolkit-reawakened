import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { advanceScriptTick, compileTk2, createGameState, normaliseTk2, parseTk2, startProgram, UI_PLUGIN } from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

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

test("TK2 conditions compare quoted equals and dialogue retains embedded hashes", () => {
  const source = '#a$ = "p=q"\n#If (a$ = "p=q") {\nHi #there\n}\n#If (a$ = "p==q") {\nWrong branch\n}';
  const program = compileTk2(source, "text.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Hi #there"]);
});

test("TK2 normalization keeps quoted operators, hash text and comments distinct", () => {
  equal(normaliseTk2('#If (a$ = "p=q" & b != "x=y" & c <= 2 & d >= 1) {'), 'If (a == "p=q" & b != "x=y" & c <= 2 & d >= 1) {');
  equal(normaliseTk2('#While (a$ = "p=q") {\n#Mwin("if(a=b) #there") * #ignored = text\n}'), 'While (a == "p=q") {\nMwin("if(a=b) #there")\n}');
  equal(normaliseTk2('* #ignored = text\nHi #there'), '\nmwin("Hi #there")');
});

test("TK2 backslashes do not escape quotes and inline prefixes remain executable", () => {
  const source = '#a$ = "x\\"\n#If (a$ = "x\\") { #matched$ = "yes" }\n#If (a$ = "y\\") { #wrong = 1 }\n#Mwin(a$)';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "backslash.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.a, "x\\");
  equal(state.vm.globals.matched, "yes");
  equal(state.vm.globals.wrong, undefined);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["x\\"]);
});

test("TK2 loose dialogue can contain equals without changing unprefixed assignments", () => {
  const source = 'value = 7\nHi #there = friend\n#Mwin(value!)';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "dialogue-equals.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.value, 7);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Hi #there = friend", "7"]);
});

test("TK2 assignment targets and literal dialogue keep their distinct meanings", () => {
  const source = '#index = 2\nvalues[index!]$ = 11\nvalues[3]! = 12\n1 + 1 = 2\nA+B = friendship\nHi #there = "friend"\nHi #there = C:\\temp\n#Mwin(values[2])\n#Mwin(values[3])';
  const program = compileTk2(source, "literal-dialogue.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), [
    "1 + 1 = 2", "A+B = friendship", 'Hi #there = "friend"', "Hi #there = C:\\temp", "11", "12",
  ]);
});

test("quoted loose dialogue remains literal inside TK2 blocks and methods", () => {
  const source = '#Method Show() {\nHello "method"\n}\n#If (1 = 1) {\nHello "block"\n}\n#Show()';
  const program = compileTk2(source, "nested-dialogue.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ['Hello "block"', 'Hello "method"']);
});

test("unprefixed calls with equals execute and angle dialogue splices", () => {
  const source = '#Method foo(n) {\n#result = n\n}\n#friend$ = "Ada"\nfoo(x = 1)\nMwin("x=y")\nHi #there = <friend>';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "calls-dialogue.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.x, 1);
  equal(state.vm.globals.result, 1);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["x=y", "Hi #there = Ada"]);
  throws(() => compileTk2("#If (x) then < #Mwin(hello) >"), /Toolkit 1\.x/);
});

test("digit-leading and multiple unprefixed calls run their assignment arguments", () => {
  const source = '#Method 1foo(n) {\n#first = n\n}\n#Method bar(n) {\n#second = n\n}\n1foo(x = 1); bar(y = 2)';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "multi-call.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state));
  equal(state.vm.globals.x, 1);
  equal(state.vm.globals.y, 2);
  equal(state.vm.globals.first, 1);
  equal(state.vm.globals.second, 2);
  const ast = parseTk2("system.foo(x = 1)");
  const stmt = ast.statements[0];
  if (stmt?.kind !== "expr" || stmt.expr.kind !== "call") throw new Error("expected qualified call");
  equal(stmt.expr.file, "system");
});

test("compact TK1 blocks and standalone closing delimiters remain unsupported", () => {
  for (const source of ["<#Mwin(hello)>", ">"]) {
    throws(() => compileTk2(source), /Toolkit 1\.x/);
  }
});

test("TK2 expression statements run nested calls and dialogue then substitution", () => {
  const source = '#Method foo(n) {\n#calls = calls + 1\n#ReturnMethod(n)\n}\n#friend$ = "Ada"\nfoo(x = 1) + 2\nfoo(y = 2)[2]\n!foo(z = 3)\nHi then <friend>';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "expressions-dialogue.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.x, 1);
  equal(state.vm.globals.y, 2);
  equal(state.vm.globals.z, 3);
  equal(state.vm.globals.calls, 3);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Hi then Ada"]);
  throws(() => compileTk2("#If (x) then < #Mwin(hello) >"), /Toolkit 1\.x/);
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
  equal(namespace.expr.name, "start");
  equal(namespace.expr.file, "system");
  deepEqual(ast.includes.map((entry) => entry.path), ["system.prg"]);
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

test("TK2 text commands read sigilled variable arguments, not their names", () => {
  const source = '#name$ = "Ada"\n#score! = 7\n#Mwin(name$)\n#Mwin(score!)\n#Mwin(Hello there)\n#Mwin("name$")';
  equal(normaliseTk2(source), 'name = "Ada"\nscore = 7\nMwin(name)\nMwin(score)\nMwin("Hello there")\nMwin("name$")');
  const program = compileTk2(source, "variables.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Ada", "7", "Hello there", "name$"]);
});

test("TK2 text commands read digit-leading sigilled identifiers", () => {
  const source = '#1name$ = "Ada"\n#1score! = 7\n#Mwin(1name$)\n#Mwin(1score!)';
  equal(normaliseTk2(source), '1name = "Ada"\n1score = 7\nMwin(1name)\nMwin(1score)');
  const program = compileTk2(source, "digit-leading.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Ada", "7"]);
});

test("TK2 text commands evaluate sigilled operator and member expressions", () => {
  const source = '#score! = 3\n#foo = { bar: "Ada" }\n#Mwin(score! ^ 2)\n#Mwin(~score!)\n#Mwin(foo.bar$)';
  equal(normaliseTk2(source), 'score = 3\nfoo = { bar: "Ada" }\nMwin(score! ^ 2)\nMwin(~score)\nMwin(foo.bar)');
  const program = compileTk2(source, "expressions.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["9", "-4", "Ada"]);
});

test("TK2 retains variable and literal identity in mixed and nested arguments", () => {
  equal(
    normaliseTk2('#Text(1, 2, name$)\n#Mwin(concat(name$, "!"))\n#Mwin("name$")'),
    'Text(1, 2, name)\nMwin(concat(name, "!"))\nMwin("name$")',
  );
});

test("TK2 raw text keeps punctuation instead of treating it as a sigil", () => {
  const source = '#Mwin(Hello there!)\n#Mwin(Price $5)\n#Mwin("already quoted!")';
  equal(normaliseTk2(source), 'Mwin("Hello there!")\nMwin("Price $5")\nMwin("already quoted!")');
  const program = compileTk2(source, "punctuation.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Hello there!", "Price $5", "already quoted!"]);
});

test("TK2 #FBranch and #Branch compile to equivalent call expressions", () => {
  const astBranch = parseTk2("#Branch(:dest)");
  const astFBranch = parseTk2("#FBranch(:dest)");
  equal(astBranch.statements[0]?.kind, "expr");
  equal(astFBranch.statements[0]?.kind, "expr");
});

test("TK2 commands accept trailing star comments without treating multiplication or quoted stars as comments", () => {
  const source = '#total! = 2 * 3\r\n#Text(2 * 3, 1, "two * three")  * explain the result\r\n#MWin("done")';
  const program = compileTk2(source, "legacy.prg");
  const multiplies = program.ops.filter((op) => op.op === "binop" && op.operator === "*");
  equal(multiplies.length, 2);
  equal(program.ops.some((op) => op.op === "push" && op.value === "two * three"), true);
  equal(program.ops.find((op) => op.op === "call" && op.name === "mwin")?.pos?.line, 3);
});

test("TK2 compiles and executes assignments with a type sigil after an array subscript", () => {
  const source = "#index = 2\n#values[index]! = 17\n#result = values[index]";
  const program = compileTk2(source, "typed-array.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);

  advanceScriptTick(state, createScriptServices(state));

  equal(state.vm.globals.result, 17);
  equal(state.vm.threads[0]?.status, "finished");
});

test("TK2 strips sigils inside and after an array subscript before ~= comparison", () => {
  const source = '#diagnalrightuppeaposition = 0\n#level[diagnalrightuppeaposition!]$ = "L"\n#if(level[diagnalrightuppeaposition!]$~="X") {\n#different = 1\n}\n#if(level[diagnalrightuppeaposition!]$~="L") {\n#equal = 1\n}';
  const program = compileTk2(source, "subscript-condition.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);

  advanceScriptTick(state, createScriptServices(state));

  equal(state.vm.globals.different, 1);
  equal(state.vm.globals.equal, undefined);
  equal(state.vm.threads[0]?.status, "finished");
});

test("TK2 sigil stripping preserves punctuation in quoted strings", () => {
  const source = '#Mwin("[OK]!, continue")';
  equal(normaliseTk2(source), 'Mwin("[OK]!, continue")');

  const statement = parseTk2(source).statements[0];
  if (statement?.kind !== "expr" || statement.expr.kind !== "call") throw new Error("expected TK2 message call");
  const message = statement.expr.args[0];
  if (message?.kind !== "literal") throw new Error("expected TK2 message literal");
  equal(message.value, "[OK]!, continue");

  const dialogue = parseTk2("[OK]!, continue").statements[0];
  if (dialogue?.kind !== "expr" || dialogue.expr.kind !== "call") throw new Error("expected loose dialogue call");
  const dialogueText = dialogue.expr.args[0];
  if (dialogueText?.kind !== "literal") throw new Error("expected loose dialogue literal");
  equal(dialogueText.value, "[OK]!, continue");
});
