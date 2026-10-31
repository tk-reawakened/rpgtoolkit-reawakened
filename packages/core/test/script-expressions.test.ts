// Expression evaluation, precedence, type conversions and truthiness (EXP-2, SEM-3, SEM-5).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  createGameState,
  pow,
  startProgram,
  type BuiltinSpec,
  type GameState,
  type PluginDefinition,
  type ScriptError,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

function runScript(source: string, plugins: readonly PluginDefinition[] = []): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  advanceOrFail(state, createScriptServices(state, plugins));
  return state;
}

test("the EXP-2 table evaluates in the ruled order", () => {
  // R-30: ^ binds looser than unary minus and is left-associative
  const s1 = runScript("r1 = -2^2\nr2 = 2^3^2\n");
  equal(s1.vm.globals.r1, 4); // (-2)^2 = 4
  equal(s1.vm.globals.r2, 64); // (2^3)^2 = 8^2 = 64

  // Bitwise below comparisons (C-inversion): x & y == z is x & (y == z)
  const s2 = runScript("x = 7\ny = 3\nz = 3\nr = x & y == z\n");
  // y == z is 1; 7 & 1 is 1
  equal(s2.vm.globals.r, 1);

  // != is not-equal (R-31 / LEX-3)
  const s3 = runScript("r1 = 5 != 5\nr2 = 5 != 3\nr3 = 5 ~= 3\n");
  equal(s3.vm.globals.r1, 0);
  equal(s3.vm.globals.r2, 1);
  equal(s3.vm.globals.r3, 1);

  // and / or keywords behave as && / ||
  const s4 = runScript("r1 = 1 and 1\nr2 = 1 and 0\nr3 = 0 or 1\nr4 = 0 or 0\n");
  equal(s4.vm.globals.r1, 1);
  equal(s4.vm.globals.r2, 0);
  equal(s4.vm.globals.r3, 1);
  equal(s4.vm.globals.r4, 0);
});

test("^ equals fmath.pow bit for bit", () => {
  const state = runScript("r1 = 2 ^ 0.5\nr2 = 2 ^ 10\nr3 = 3 ^ 3\n");
  equal(state.vm.globals.r1, pow(2, 0.5));
  equal(state.vm.globals.r2, pow(2, 10));
  equal(state.vm.globals.r3, pow(3, 3));
});

test("the SEM-3 worked values match", () => {
  const script = `
r1 = "abc" == "ABC"
r2 = 5 == "5"
r3 = "5.0" == 5
r4 = "abc" < "abd"
r5 = "10" < "9"
r6 = "Hello " + 32
r7 = 1 + "2"
r8 = 7 / 2
`;
  const state = runScript(script);
  equal(state.vm.globals.r1, 0);
  equal(state.vm.globals.r2, 1);
  equal(state.vm.globals.r3, 0);
  equal(state.vm.globals.r4, 0);
  equal(state.vm.globals.r5, 0);
  equal(state.vm.globals.r6, "Hello 32");
  equal(state.vm.globals.r7, "12");
  equal(state.vm.globals.r8, 3.5);
});

test("the SEM-5 index key unifies 1, '1' and 1.0", () => {
  const script = `
a[1] = "first"
a["1"] = "second"
a[1.0] = "third"
m["Key"] = 10
m["key"] = 20
read_a = a[1]
read_key1 = m["Key"]
read_key2 = m["key"]
`;
  const state = runScript(script);
  equal(state.vm.globals.read_a, "third");
  equal(state.vm.globals.read_key1, 10);
  equal(state.vm.globals.read_key2, 20);
});

test("truthiness is off-based and 0 is false", () => {
  const script = `
if ("off") { t_off1 = 1 } else { t_off1 = 0 }
if ("OFF") { t_off2 = 1 } else { t_off2 = 0 }
if ("") { t_empty = 1 } else { t_empty = 0 }
if ("FALSE") { t_false = 1 } else { t_false = 0 }
if (0) { t_zero = 1 } else { t_zero = 0 }
if (3) { t_three = 1 } else { t_three = 0 }
`;
  const state = runScript(script);
  equal(state.vm.globals.t_off1, 0);
  equal(state.vm.globals.t_off2, 0);
  equal(state.vm.globals.t_empty, 1);
  equal(state.vm.globals.t_false, 1);
  equal(state.vm.globals.t_zero, 0);
  equal(state.vm.globals.t_three, 1);
});

test("&&, || and ?: evaluate every operand", () => {
  const called: string[] = [];
  const track = (name: string): BuiltinSpec => ({
    name,
    aliases: [],
    params: [{ name: "v", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => {
      called.push(name);
      return { value: args[0]?.value ?? null };
    },
  });

  const plugins: readonly PluginDefinition[] = [
    {
      id: "test.track",
      version: "1.0.0",
      commands: [track("fa"), track("fb"), track("fc"), track("fd")],
    },
  ];

  // R-40: no short-circuit
  runScript("r = fa(0) && fb(1)\n", plugins);
  deepEqual(called, ["fa", "fb"]);

  called.length = 0;
  runScript("r = fc(1) || fd(0)\n", plugins);
  deepEqual(called, ["fc", "fd"]);

  called.length = 0;
  runScript("r = 0 ? fa(1) : fb(2)\n", plugins);
  deepEqual(called, ["fa", "fb"]);
});

test("% by zero throws the ERR-2 class error and converts operands first", () => {
  equal(errorOf(() => runScript("x = 7 % 0\n")).code, "vm.modulo-by-zero");
  // Remainder converts both operands first so divisor in (-1, 1) counts as zero
  equal(errorOf(() => runScript("x = 7 % 0.5\n")).code, "vm.modulo-by-zero");
  equal(errorOf(() => runScript("x = 7 % -0.5\n")).code, "vm.modulo-by-zero");
  // -2147483648 % -1 cannot yield -0 in our VM (normalised to 0)
  const normalZero = runScript("x = -2147483648 % -1\n");
  equal(normalZero.vm.globals.x, 0);
  equal(Object.is(normalZero.vm.globals.x, 0), true);
  equal(Object.is(normalZero.vm.globals.x, -0), false);
});

test("a null operand behaves as the unset value", () => {
  // sleep returns null (no value), which evaluates as 0 in arithmetic
  const state = runScript("x = 5 + sleep(1)\n");
  equal(state.vm.threads[0]!.status, "waiting");
  advanceScriptTick(state, createScriptServices(state));
  equal(state.vm.globals.x, 5);
});
