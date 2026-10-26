// Behaviour, special values and accuracy of `core/fmath` (ADR 0002 Decision 2,
// AD-13), plus the guard that the module uses nothing the G3 allowlist bans.
//
// The oracle is the native `Math`, which the standard permits to be
// implementation-approximated; the accuracy bounds below are the largest
// difference the tests allow, and the committed bit patterns in
// `fmath-vectors.test.ts` are what actually pins cross-engine behaviour.
import { test } from "node:test";
import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_NAN,
  HALF_PI,
  PI,
  QUARTER_PI,
  TRIG_ARG_MAX,
  acos,
  asin,
  atan,
  atan2,
  cbrt,
  cos,
  exp,
  hypot,
  log,
  log10,
  log2,
  pow,
  sin,
  sqrt,
  tan,
  toDegrees,
  toRadians,
} from "../src/fmath/index.ts";
import { pow as rootPow, sin as rootSin } from "../src/index.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

// `node:assert/strict`'s `ok` is not declared in the shared minimal test types,
// and reads the same on a boolean condition.
const ok = (condition: boolean, message?: string): void => equal(condition, true, message);

const view = new DataView(new ArrayBuffer(8));

function rawBits(value: number): bigint {
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false);
}

/** The number of representable doubles between `a` and `b`, ignoring sign. */
function ulpDistance(a: number, b: number): number {
  if (a === b) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  if (a < 0 !== b < 0) return Infinity;
  const magnitude = 0x7fffffffffffffffn;
  const ma = rawBits(a) & magnitude;
  const mb = rawBits(b) & magnitude;
  return Number(ma > mb ? ma - mb : mb - ma);
}

function worstUlp(
  fn: (...args: number[]) => number,
  oracle: (...args: number[]) => number,
  cases: readonly (readonly number[])[],
): { ulp: number; at: readonly number[] } {
  let ulp = 0;
  let at: readonly number[] = [];
  for (const args of cases) {
    const difference = ulpDistance(fn(...args), oracle(...args));
    if (difference > ulp) {
      ulp = difference;
      at = args;
    }
  }
  return { ulp: ulp, at: at };
}

function range(count: number, from: number, to: number): number[] {
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

const single = (values: readonly number[]): number[][] => values.map((value) => [value]);
const pair = (left: readonly number[], right: readonly number[]): number[][] =>
  left.map((value, i) => [value, right[i % right.length]!]);

// ── special values and edge cases (ADR 0002 Decision 2's I/O matrix) ─────────

test("trig special values and the documented reduction limit", () => {
  equal(sin(NaN), NaN);
  equal(cos(NaN), NaN);
  equal(tan(NaN), NaN);
  equal(tan(Infinity), NaN);
  equal(sin(Infinity), NaN);
  equal(cos(-Infinity), NaN);
  // The reduction is exact for |x| <= 2^37; beyond it the answer is NaN, not noise.
  ok(Number.isFinite(sin(TRIG_ARG_MAX)));
  ok(Number.isFinite(cos(-TRIG_ARG_MAX)));
  equal(sin(TRIG_ARG_MAX * 2), NaN);
  equal(cos(1e12), NaN);
  equal(tan(1e12), NaN);
});

test("trig and atan preserve signed zero", () => {
  ok(Object.is(sin(-0), -0));
  ok(Object.is(sin(0), 0));
  ok(Object.is(tan(-0), -0));
  ok(Object.is(atan(-0), -0));
  ok(Object.is(atan(0), 0));
  ok(Object.is(atan2(-0, 1), -0));
  equal(cos(-0), 1);
  equal(cos(0), 1);
});

test("exp range ends", () => {
  equal(exp(710), Infinity);
  equal(exp(-746), 0);
  equal(exp(Infinity), Infinity);
  equal(exp(-Infinity), 0);
  equal(exp(NaN), NaN);
  equal(exp(0), 1);
  equal(exp(-0), 1);
});

test("log domain", () => {
  equal(log(0), -Infinity);
  equal(log(-0), -Infinity);
  equal(log(-1), NaN);
  equal(log(Infinity), Infinity);
  equal(log(NaN), NaN);
  equal(log(1), 0);
  equal(log2(0), -Infinity);
  equal(log2(-1), NaN);
  equal(log10(0), -Infinity);
  equal(log10(-1), NaN);
});

test("asin/acos domain", () => {
  equal(asin(1.0000001), NaN);
  equal(asin(-1.0000001), NaN);
  equal(acos(-2), NaN);
  equal(acos(2), NaN);
  equal(asin(1), HALF_PI);
  equal(asin(-1), -HALF_PI);
  equal(acos(1), 0);
  equal(acos(-1), PI);
});

test("pow special-case rules", () => {
  equal(pow(2, 10), 1024);
  equal(pow(3, 5), 243);
  equal(pow(3, -1), 1 / 3);
  equal(pow(-8, 1 / 3), NaN);
  equal(pow(0, -1), Infinity);
  equal(pow(-0, -1), -Infinity);
  equal(pow(-0, -2), Infinity);
  equal(pow(1, Infinity), NaN);
  equal(pow(-1, Infinity), NaN);
  equal(pow(0, 0), 1);
  equal(pow(NaN, 0), 1);
  equal(pow(2, NaN), NaN);
  equal(pow(2, Infinity), Infinity);
  equal(pow(0.5, Infinity), 0);
  equal(pow(2, -Infinity), 0);
  equal(pow(0.5, -Infinity), Infinity);
  equal(pow(-2, 3), -8);
  equal(pow(Infinity, -1), 0);
  equal(pow(-Infinity, 3), -Infinity);
});

test("atan2 quadrants and infinities", () => {
  equal(atan2(0, -1), PI);
  ok(Object.is(atan2(-0, -1), -PI));
  equal(atan2(0, 0), 0);
  ok(Object.is(atan2(-0, -0), -PI));
  equal(atan2(-Infinity, -Infinity), -3 * QUARTER_PI);
  equal(atan2(Infinity, Infinity), QUARTER_PI);
  equal(atan2(1, -1), 3 * QUARTER_PI);
  equal(atan2(1, 0), HALF_PI);
  equal(atan2(NaN, 1), NaN);
});

test("cbrt and hypot edges", () => {
  ok(Object.is(cbrt(-0), -0));
  equal(cbrt(0), 0);
  equal(cbrt(-8), -2);
  equal(cbrt(27), 3);
  equal(cbrt(Infinity), Infinity);
  equal(cbrt(-Infinity), -Infinity);
  equal(cbrt(NaN), NaN);
  equal(hypot(3, 4), 5);
  equal(hypot(0, 0), 0);
  equal(hypot(Infinity, 1), Infinity);
  equal(hypot(NaN, 1), NaN);
});

test("degree and radian conversion", () => {
  equal(toRadians(180), PI);
  equal(toDegrees(PI), 180);
  equal(toRadians(0), 0);
  equal(toDegrees(0), 0);
});

test("core's root surface re-exports fmath", () => {
  equal(rootSin, sin);
  equal(rootPow, pow);
});

// ── accuracy against the native `Math` oracle ────────────────────────────────

test("sin/cos stay within 4 ULP and tan within 4 ULP", () => {
  const wide = [...range(300, -6.3, 6.3), ...range(200, 1e9, TRIG_ARG_MAX * 0.95), 0, -0, 1e-300, 1e-8];
  const sinWorst = worstUlp(sin, Math.sin, single(wide));
  const cosWorst = worstUlp(cos, Math.cos, single(wide));
  const tanWorst = worstUlp(tan, Math.tan, single(range(300, -1.4, 1.4)));
  ok(sinWorst.ulp <= 4, `sin worst ${sinWorst.ulp} at ${sinWorst.at}`);
  ok(cosWorst.ulp <= 4, `cos worst ${cosWorst.ulp} at ${cosWorst.at}`);
  ok(tanWorst.ulp <= 4, `tan worst ${tanWorst.ulp} at ${tanWorst.at}`);
});

test("atan stays within 2 ULP and atan2 within 8 ULP", () => {
  const atanCases = single([...range(400, -50, 50), ...range(300, -1, 1), 1e300, -1e300, 0, -0]);
  const atanWorst = worstUlp(atan, Math.atan, atanCases);
  const atan2Cases = [
    ...pair(range(200, -30, 30), [1]),
    ...pair(range(150, 0.1, 30), [-1]),
    ...pair(range(200, -20, 20), range(200, -17, 3)),
    [0, -1],
    [-0, -0],
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  const atan2Worst = worstUlp(atan2, Math.atan2, atan2Cases);
  ok(atanWorst.ulp <= 2, `atan worst ${atanWorst.ulp} at ${atanWorst.at}`);
  ok(atan2Worst.ulp <= 8, `atan2 worst ${atan2Worst.ulp} at ${atan2Worst.at}`);
});

test("asin and acos stay within 8 ULP", () => {
  const nearOne: number[] = [];
  for (let k = 1; k <= 52; k++) {
    nearOne.push(1 - 2 ** -k, -1 + 2 ** -k);
  }
  const cases = single([...range(300, -1, 1), ...nearOne, 0, -0]);
  const asinWorst = worstUlp(asin, Math.asin, cases);
  const acosWorst = worstUlp(acos, Math.acos, cases);
  ok(asinWorst.ulp <= 8, `asin worst ${asinWorst.ulp} at ${asinWorst.at}`);
  ok(acosWorst.ulp <= 8, `acos worst ${acosWorst.ulp} at ${acosWorst.at}`);
});

test("exp stays within 2 ULP", () => {
  const cases = single([...range(400, -745, 709), 0, -0, 0.5, -0.5, 1, -1]);
  const worst = worstUlp(exp, Math.exp, cases);
  ok(worst.ulp <= 2, `exp worst ${worst.ulp} at ${worst.at}`);
});

test("log/log2 stay within 4 ULP and log10 within 8 ULP", () => {
  const cases: number[][] = [];
  for (const exponent of [-300, -50, -1, 0, 1, 5, 50, 300]) {
    for (let i = 0; i < 60; i++) cases.push([(1 + i / 60) * 2 ** exponent]);
  }
  cases.push([1], [10], [100], [2]);
  const logWorst = worstUlp(log, Math.log, cases);
  const log2Worst = worstUlp(log2, Math.log2, cases);
  const log10Worst = worstUlp(log10, Math.log10, cases);
  ok(logWorst.ulp <= 4, `log worst ${logWorst.ulp} at ${logWorst.at}`);
  ok(log2Worst.ulp <= 4, `log2 worst ${log2Worst.ulp} at ${log2Worst.at}`);
  ok(log10Worst.ulp <= 8, `log10 worst ${log10Worst.ulp} at ${log10Worst.at}`);
});

test("cbrt stays within 16 ULP and hypot within 4 ULP", () => {
  const cbrtCases = single([...range(200, 0, 1000), ...range(200, -1000, 0), ...range(100, 1e-300, 1e300)]);
  const cbrtWorst = worstUlp(cbrt, Math.cbrt, cbrtCases);
  const hypotCases = pair(range(150, 0, 1e150), range(150, 1, 1.7e150));
  const hypotWorst = worstUlp(hypot, Math.hypot, hypotCases);
  ok(cbrtWorst.ulp <= 16, `cbrt worst ${cbrtWorst.ulp} at ${cbrtWorst.at}`);
  ok(hypotWorst.ulp <= 4, `hypot worst ${hypotWorst.ulp} at ${hypotWorst.at}`);
});

test("sqrt returns CANONICAL_NAN for negative domain errors", () => {
  ok(Number.isNaN(CANONICAL_NAN), "CANONICAL_NAN must be NaN");
  const nanResult = sqrt(-1);
  ok(Number.isNaN(nanResult), "sqrt(-1) must return NaN");
  equal(Object.is(nanResult, CANONICAL_NAN), true);
  equal(sqrt(4), 2);
  equal(sqrt(0), 0);
});

test("pow with an integer exponent is exactly repeated multiplication", () => {
  for (let base = -6; base <= 6; base++) {
    for (let exponent = 0; exponent <= 12; exponent++) {
      let reference = 1;
      for (let i = 0; i < exponent; i++) reference *= base;
      equal(pow(base, exponent), reference, `pow(${base}, ${exponent})`);
    }
  }
  equal(pow(2, 10), 1024);
  equal(pow(3, 5), 243);
  equal(pow(2, 20), 1048576);
});

test("pow with a fractional exponent tracks |y ln x| * 2^-53", () => {
  const cases: readonly (readonly [number, number])[] = [
    [2, 0.5],
    [2, 1.5],
    [3, 1 / 3],
    [10, 2.5],
    [1.5, 7.25],
    [100, 0.1],
  ];
  for (const [base, exponent] of cases) {
    const want = Math.pow(base, exponent);
    const relative = Math.abs((pow(base, exponent) - want) / want);
    const bound = (Math.abs(exponent * Math.log(base)) + 1) * 2 ** -52;
    ok(relative <= bound, `pow(${base}, ${exponent}) relative ${relative} exceeds ${bound}`);
  }
});

// ── the source scan: fmath must use nothing the allowlist bans ───────────────

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fmath");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const ALLOWED_MATH = new Set([
  "abs", "ceil", "floor", "round", "trunc", "sign", "min", "max",
  "fround", "imul", "clz32", "sqrt",
]);

const BANNED_GLOBALS = ["Date", "performance", "Intl", "setTimeout", "queueMicrotask", "fetch", "window", "document", "require"];

test("fmath sources stay inside the G3 allowlist", () => {
  const files: readonly (readonly [string, string])[] = [
    ["fmath.ts", stripComments(readFileSync(join(sourceDir, "fmath.ts"), "utf8"))],
    ["index.ts", stripComments(readFileSync(join(sourceDir, "index.ts"), "utf8"))],
  ];
  for (const [name, source] of files) {
    for (const match of source.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_]+)/g)) {
      ok(ALLOWED_MATH.has(match[1]!), `${name}: Math.${match[1]} is not in the G3 allowlist`);
    }
    equal(/\*\*/.test(source), false, `${name}: '**' / '**=' is banned in core`);
    equal(/toLocale/.test(source), false, `${name}: toLocale* is banned in core`);
    equal(/%/.test(source), false, `${name}: '%' is outside the module's operator set (+ - * / and sqrt)`);
    for (const global of BANNED_GLOBALS) {
      equal(new RegExp(`\\b${global}\\b`).test(source), false, `${name}: banned global ${global}`);
    }
  }
  // The implementation imports nothing at all; the barrel only re-exports.
  const implementation = files[0]![1];
  equal(/(^|\n)\s*import\b/.test(implementation), false, "fmath.ts must not import");
  equal(/\bfrom\s*["']/.test(implementation), false, "fmath.ts must not reference another module");
  equal(/\bimport\s*\(/.test(implementation), false, "fmath.ts must not use a dynamic import");
});
