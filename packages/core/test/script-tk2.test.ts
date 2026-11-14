import { ScriptError } from "../src/script/errors.ts";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { advanceScriptTick, compileTk2, createGameState, IR_VERSION, normaliseTk2, parseTk2, startProgram, UI_PLUGIN } from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

test("TK2 continued unprefixed assignments execute as one statement", () => {
  const program = compileTk2("total = 1 + _\n#2\n", "continued.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.total, 3);
});

test("TK2 quoted dialogue reaches a redirected message command", () => {
  const source = '#Method capture(value) { captured = value }\n#Redirect(mwin, capture)\nHello "friend"';
  const program = compileTk2(source, "redirect-dialogue.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.captured, 'Hello "friend"');
});

test("TK2 ReturnMethod returns inside inline and multiline method bodies (#2514)", () => {
  const source = [
    '#Method inline(x) { #x = x + 1; #ReturnMethod(x) }',
    '#Method lines(x) {',
    '#ReturnMethod(x)',
    '}',
    '#result = inline(lines(41))',
  ].join("\n");
  const converted = normaliseTk2(source);
  const program = compileTk2(source, "inline-return.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.result, 42);
  const convertedState = createGameState({ seed: 0 });
  startProgram(convertedState.vm, { kind: "inline", text: converted, ir: IR_VERSION });
  advanceScriptTick(convertedState, createScriptServices(convertedState, [UI_PLUGIN]));
  equal(convertedState.vm.globals.result, 42);
});

test("TK2 inline return lowering preserves string and comment text", () => {
  const source = '#Method show() { #obj = { returnmethod: 3 }; #text("returnMethod(9)"); /* returnMethod(8) */ #ReturnMethod(7) }';
  const converted = normaliseTk2(source);
  equal(converted.includes('"returnMethod(9)"'), true);
  equal(converted.includes("/* returnMethod(8) */"), true);
  equal(converted.includes("returnmethod: 3"), true);
  equal(converted.includes("return(7)"), true);
});

test("TK2 quoted dialogue inside a lambda retains its text", () => {
  const source = '#show = () => {\nHello "friend"\n}\n#show()';
  const program = compileTk2(source, "lambda-dialogue.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ['Hello "friend"']);
});

test("TK2 class methods retain the this receiver", () => {
  const source = '#class Box { public: method value() { return 42 } method read() { return this.value() } }\n#result = Box()->read()';
  const program = compileTk2(source, "method-receiver.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.result, 42);
});

test("TK2 dialogue and comments ending in underscore do not consume the next statement", () => {
  const source = 'Hello _\n#x = 1\n* comment _\n#y = 2\n#Mwin(hi) * _\nAfter star\n#z = 3 // note _\nAfter slash\n#z = 4 ** note _\nAfter double star\nHello /*\n#v = 5\n#*/\nHello (\n#w = 6\n)';
  const program = compileTk2(source, "dialogue-underscore.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.x, 1);
  equal(state.vm.globals.y, 2);
  equal(state.vm.globals.v, 5);
  equal(state.vm.globals.w, 6);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Hello _", "hi", "After star", "After slash", "After double star", "Hello /*", "Hello (", ")"]);
});

test("TK2 continued code keeps later token lines and accepts a trailing comment", () => {
  const ast = parseTk2('total = 1 + _ // note\n#missing()');
  const statement = ast.statements[0];
  if (statement?.kind !== "expr" || statement.expr.kind !== "assign" || statement.expr.value.kind !== "binary" || statement.expr.value.right.kind !== "call") throw new Error("expected continued assignment");
  equal(statement.expr.value.right.line, 2);
  const program = compileTk2('total = 1 /*\n# // */ + _ // note\n#2\nother = ( // parentheses also continue\n#1 + 2)', "continued-comment.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.total, 3);
  equal(state.vm.globals.other, 3);
});

test("TK2 object calls inside lambdas retain their receiver", () => {
  const source = '#class Box { public: method value() { return 42 } }\n#box = Box()\n#read = () => box->value()\n#result = read()';
  const program = compileTk2(source, "lambda-object.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.result, 42);
});

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

test("incomplete assignment-like text is dialogue, but sigilled assignments execute", () => {
  const source = '#index = 2\nvalues[index!]$ = 7\nScore = 5 points\nHi = my friend\nHello = "friend" is here\n#Mwin(values[2])';
  const state = createGameState({ seed: 0 });
  const program = compileTk2(source, "assignment-dialogue.prg");
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["Score = 5 points", "Hi = my friend", 'Hello = "friend" is here', "7"]);
});

test("inline prefixes after unprefixed assignments execute without changing quoted hashes", () => {
  const program = compileTk2('x = 1; #Mwin(hi); #Mwin("a #there")', "inline-prefix.prg");
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [UI_PLUGIN]));
  equal(state.vm.globals.x, 1);
  deepEqual(state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]), ["hi", "a #there"]);
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
      args: [{ kind: "literal", value: "Hello there", line: 1, col: 7, endCol: 17 }],
      line: 1,
      col: 2,
      endCol: 5,
    },
    line: 1,
    col: 2,
    endCol: 5,
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
test("TK2 source maps identifiers, sigils and inserted raw quotes to original spans", () => {
  const source = '  #value! = 1\r\n\t#other$ = value!\r\n  #MWin(\u{1F600} hello)';
  const ast = parseTk2(source);
  const first = ast.statements[0];
  const second = ast.statements[1];
  const third = ast.statements[2];
  if (first?.kind !== "expr" || first.expr.kind !== "assign" || first.expr.target.kind !== "variable") throw new Error("expected first assignment");
  if (second?.kind !== "expr" || second.expr.kind !== "assign" || second.expr.target.kind !== "variable") throw new Error("expected second assignment");
  const program = compileTk2("  #value! = 1");
  const compiledName = program.ops.find((op) => op.op === "load" && op.name === "value");
  if (compiledName?.op !== "load") throw new Error("expected compiled assignment target");
  deepEqual([compiledName.pos?.line, compiledName.pos?.col, compiledName.pos?.endCol], [1, 4, 9]);
  const firstTarget = first.expr.target;
  if (firstTarget.col === undefined || firstTarget.endCol === undefined) throw new Error("expected first original identifier span");
  deepEqual([firstTarget.line, firstTarget.col, firstTarget.endCol], [1, 4, 9]);
  equal(source.split("\r\n")[0]!.slice(firstTarget.col - 1, firstTarget.endCol), "value!");
  const secondTarget = second.expr.target;
  if (secondTarget.col === undefined || secondTarget.endCol === undefined) throw new Error("expected second original identifier span");
  deepEqual([secondTarget.line, secondTarget.col, secondTarget.endCol], [2, 3, 8]);
  equal(source.split("\r\n")[1]!.slice(secondTarget.col - 1, secondTarget.endCol), "other$");
  const value = second.expr.value;
  if (value.kind !== "variable") throw new Error("expected variable assignment value");
  deepEqual([value.line, value.col, value.endCol], [2, 12, 17]);
  if (third?.kind !== "expr" || third.expr.kind !== "call" || third.expr.args[0]?.kind !== "literal") throw new Error("expected raw dialogue argument");
  const rawText = third.expr.args[0];
  if (rawText.col === undefined || rawText.endCol === undefined) throw new Error("expected original raw-text span");
  equal(source.split("\r\n")[2]!.slice(rawText.col - 1, rawText.endCol), "\u{1F600} hello");
  deepEqual([rawText.line, rawText.col, rawText.endCol], [3, 9, 16]);
});

test("TK2 inserted call whitespace preserves original token positions", () => {
  const source = "#f(0,1 + 1)";
  const call = parseTk2(source).statements[0];
  if (call?.kind !== "expr" || call.expr.kind !== "call") throw new Error("expected source call");
  const expression = call.expr.args[1];
  if (expression?.kind !== "binary") throw new Error("expected binary argument");
  deepEqual([call.expr.line, call.expr.col, call.expr.endCol], [1, 2, 2]);
  deepEqual([expression.line, expression.col, expression.endCol], [1, 8, 8]);
  equal(source.slice(expression.col! - 1, expression.endCol), "+");
  deepEqual([expression.left.line, expression.left.col, expression.left.endCol], [1, 6, 6]);
  deepEqual([expression.right.line, expression.right.col, expression.right.endCol], [1, 10, 10]);
});
test("TK2 method declarations retain the original keyword anchor", () => {
  const ast = parseTk2("#METHOD Show() {\n#return 1\n}");
  const fn = ast.functions[0];
  if (fn === undefined) throw new Error("expected method declaration");
  deepEqual([fn.name, fn.line, fn.col, fn.endCol], ["show", 1, 2, 7]);
});

test("TK2 class and method declarations retain keyword anchors", () => {
  const source = "#CLASS Box { public: METHOD value() { return 42 } METHOD operator+ (other) { return 1 } METHOD ~Box() { return 0 } }\n#CLASS Other { public: METHOD value() { return 0 } }";
  const classes = parseTk2(source).classes;
  const first = classes[0];
  const second = classes[1];
  if (first === undefined || second === undefined) throw new Error("expected class declarations");
  const span = (node: { readonly line: number; readonly col?: number; readonly endCol?: number }): string => {
    if (node.col === undefined || node.endCol === undefined) throw new Error("expected original declaration span");
    return source.split("\n")[node.line - 1]!.slice(node.col - 1, node.endCol);
  };
  equal(span(first), "CLASS");
  const methods = first.methods;
  equal(methods.length, 3);
  for (const method of methods) equal(span(method), "METHOD");
  equal(span(second.methods[0]!), "METHOD");
  deepEqual([second.methods[0]!.line, second.methods[0]!.col, second.methods[0]!.endCol], [2, 24, 29]);
});


test("TK2 parser and lexical errors retain original token positions", () => {
  throws(
    () => parseTk2("  #value = )"),
    (error: unknown) => error instanceof ScriptError
      && error.code === "syntax.error"
      && error.pos?.line === 1
      && error.pos.col === 12
      && error.pos.endCol === 12,
  );
  throws(
    () => parseTk2("  #value = §"),
    (error: unknown) => error instanceof ScriptError
      && error.code === "syntax.error"
      && error.pos?.line === 1
      && error.pos.col === 12
      && error.pos.endCol === 12,
  );
  throws(
    () => parseTk2("  <"),
    (error: unknown) => error instanceof ScriptError
      && error.code === "syntax.unsupported"
      && error.pos?.line === 1
      && error.pos.col === 3
      && error.pos.endCol === 3,
  );
});

test("TK2 UTF-16 source mapping stays aligned after astral text and CRLF", () => {
  const source = "#MWin(\u{1F600} hello)\r\n  #after! = 1";
  const after = parseTk2(source).statements[1];
  if (after?.kind !== "expr" || after.expr.kind !== "assign" || after.expr.target.kind !== "variable") throw new Error("expected assignment after CRLF");
  const target = after.expr.target;
  if (target.col === undefined || target.endCol === undefined) throw new Error("expected original identifier span");
  deepEqual([target.line, target.col, target.endCol], [2, 4, 9]);
  equal(source.split("\r\n")[1]!.slice(target.col - 1, target.endCol), "after!");
});
