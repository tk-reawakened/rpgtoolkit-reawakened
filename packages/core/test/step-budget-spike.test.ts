// Entry 19.2 spike: does a stock ATB tick written in RPGCode, with statuses and
// events, fit the per-thread STEP_BUDGET once cancelable emits park and resume
// threads? Objects and emitters are not built yet, so the model uses what exists
// (flat arrays in globals, callables from Epic 18, a hand-rolled listener list,
// a dispatcher thread parked and woken with threadsleep/threadwake). The
// numbers are in discovery/step-budget-spike.md; this test is the benchmark that
// produced them and pins the determinism and save/restore claims.
//
// Set STEP_SPIKE_REPORT=1 to print the measurement tables.
import { equal, ok } from "node:assert/strict";
import { log } from "node:console";
import { env } from "node:process";
import { test } from "node:test";
import {
  collectStateGarbage,
  createGameState,
  defaultWaitPoll,
  restoreGameState,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  stepThread,
  type GameState,
  type ScriptServices,
} from "../src/index.ts";
import { runTimePhase } from "../src/time/index.ts";
import { createScriptServices } from "./script-test-services.ts";

/** Fighter values from docs/spec/examples (Ada fp 6 dp 4 hp 30; Slime fp 3 dp 1 hp 12) and E-72. */
const PLAYER = { hp: 30, fp: 6, dp: 4, max: 75 };
const ENEMY = { hp: 12, fp: 3, dp: 1, max: 123 };
const SPEED = 3;

interface Config {
  /** Listeners per event type (`damage`, `hit`, `fallen`). */
  listeners: number;
  /** Statuses on every fighter. */
  statuses: number;
  /** `round`: statuses apply when a fighter acts (E-75). `tick`: a status also adjusts speed every tick (pessimistic). */
  statusMode: "round" | "tick";
  /** `inline`: the listeners run in the emitting call. `queued`: a plain emit appends to a queue a dispatcher thread drains. */
  plain: "inline" | "queued";
  /** `inline`: the emitter runs the listeners itself. `parked`: the emitter parks, a dispatcher thread runs them and wakes it. */
  cancelable: "inline" | "parked";
  /** All four fighters charged on the same tick, again and again (the worst tick). */
  aligned: boolean;
  /** Huge HP so nobody falls, or the stock values so fighters fall (and `fallen` fires). */
  immortal: boolean;
  /** `single`: one battle thread runs all four fighters. `perFighter`: one thread per fighter (each has its own budget). */
  threads: "single" | "perFighter";
  /** The cancel listener cancels every damage event (to show the emitter sees `canceled` and later listeners still run). */
  cancelAll: boolean;
  /** Cancelable emits at all (the baseline has none). */
  emits: boolean;
}

const BASE: Config = {
  listeners: 3,
  statuses: 2,
  statusMode: "round",
  plain: "inline",
  cancelable: "inline",
  aligned: false,
  cancelAll: false,
  threads: "single",
  immortal: true,
  emits: true,
};

function listenerSource(type: number, index: number, cancelAll: boolean): string {
  if (type === 0) {
    const kind = index % 3;
    if (kind === 0) return "(a, b, d) => { if (shield[b] > 0) { evD = evD / 2 } }";
    if (kind === 1) return cancelAll ? "(a, b, d) => { evCancel = 1 }" : "(a, b, d) => { if (evD < 1) { evCancel = 1 } }";
    return "(a, b, d) => { dmgLog[a] = dmgLog[a] + evD }";
  }
  if (type === 1) return "(a, b, d) => { hits[a] = hits[a] + 1 }";
  return "(a, b, d) => { falls = falls + 1 }";
}

function program(config: Config): string {
  const lines: string[] = [];
  const fighter = (i: number): typeof PLAYER => (i < 2 ? PLAYER : ENEMY);
  for (let i = 0; i < 4; i += 1) {
    const f = fighter(i);
    const hp = config.immortal ? 100000 : f.hp;
    lines.push(`hp[${i}] = ${hp}`, `fp[${i}] = ${f.fp}`, `dp[${i}] = ${f.dp}`, `mx[${i}] = ${f.max}`, `spd[${i}] = ${SPEED}`);
    lines.push(`ch[${i}] = ${config.aligned ? f.max - SPEED : `random(${f.max})`}`);
    lines.push(`shield[${i}] = ${i === 2 || i === 3 ? 1 : 0}`, `hits[${i}] = 0`, `dmgLog[${i}] = 0`);
    lines.push(`stN[${i}] = ${config.statuses}`);
    for (let k = 0; k < config.statuses; k += 1) {
      lines.push(`stHp[${i * 4 + k}] = ${k % 2 === 0 ? -1 : 1}`, `stSpd[${i * 4 + k}] = ${k % 2 === 0 ? -1 : 1}`, `stLeft[${i * 4 + k}] = 100000`);
    }
  }
  lines.push("falls = 0", "bt = 0", "acts = 0", "done = 0", "cHead = 0", "cTail = 0", "qHead = 0", "qTail = 0", "evCancel = 0", "evD = 0");
  for (let t = 0; t < 3; t += 1) {
    lines.push(`nl[${t}] = ${config.emits ? config.listeners : 0}`);
    for (let k = 0; k < config.listeners; k += 1) lines.push(`lis[${t * 16 + k}] = ${listenerSource(t, k, config.cancelAll)}`);
  }
  // Run every listener of type t, in registration order (EMIT-3: one list, registration order).
  lines.push("runP = (t, a, b, d) => { for (pk = 0; pk < nl[t]; pk = pk + 1) { pf = lis[t * 16 + pk]; pf(a, b, d) } }");
  lines.push("runC = (a, b, d) => { for (ck = 0; ck < nl[0]; ck = ck + 1) { cf = lis[ck]; cf(a, b, d) } }");
  // A plain emit: inline runs the listeners now; queued appends plain data to the queue.
  if (config.plain === "inline") {
    lines.push("emitP = (t, a, b, d) => { runP(t, a, b, d) }");
  } else {
    lines.push("emitP = (t, a, b, d) => { qT[qTail] = t; qA[qTail] = a; qB[qTail] = b; qD[qTail] = d; qTail = qTail + 1 }");
    lines.push(
      "dispatch = () => { while (1) { while (qHead < qTail) { runP(qT[qHead], qA[qHead], qB[qHead], qD[qHead]); qHead = qHead + 1 } threadsleep(getthreadid(), 0.001) } }",
    );
  }
  // A cancelable emit of `damage`. The event is `evD`/`evCancel` for the listeners; the emitter reads
  // its own answer back from `rD[me]` and `rC[me]` (one slot per thread, so parallel emitters never share a global).
  if (config.cancelable === "inline") {
    lines.push("emitC = (a, b, d) => { local(me); me = getthreadid(); evD = d; evCancel = 0; runC(a, b, d); rD[me] = evD; rC[me] = evCancel }");
  } else {
    // Parked: the emitter appends a plain-data entry, wakes the dispatcher and parks; the dispatcher runs the
    // listeners in registration order, stores the answer and wakes the owner.
    lines.push(
      "emitC = (a, b, d) => { local(me); me = getthreadid(); cA[cTail] = a; cB[cTail] = b; cD[cTail] = d; cO[cTail] = me; cTail = cTail + 1; threadwake(cid); threadsleep(me, 0) }",
      "cdispatch = () => { while (1) { if (cHead < cTail) { evD = cD[cHead]; evCancel = 0; runC(cA[cHead], cB[cHead], cD[cHead]); rD[cO[cHead]] = evD; rC[cO[cHead]] = evCancel; threadwake(cO[cHead]); cHead = cHead + 1 } else { threadsleep(getthreadid(), 0) } } }",
    );
  }
  lines.push(
    "act = (i) => {",
    "  local(ak)",
    "  local(at)",
    "  local(ad)",
    "  local(me)",
    "  me = getthreadid()",
    "  acts = acts + 1",
    "  ch[i] = 0",
    "  for (ak = 0; ak < stN[i]; ak = ak + 1) { hp[i] = hp[i] + stHp[i * 4 + ak]; stLeft[i * 4 + ak] = stLeft[i * 4 + ak] - 1 }",
    "  if (i < 2) { at = 2 } else { at = 0 }",
    "  if (hp[at] <= 0) { at = at + 1 }",
    "  ad = fp[i] + random(3) - dp[at]",
    "  if (ad < 1) { ad = 1 }",
    "  emitC(i, at, ad)",
    "  if (rC[me] == 0) {",
    "    hp[at] = hp[at] - rD[me]",
    "    emitP(1, i, at, rD[me])",
    "    if (hp[at] <= 0) { emitP(2, i, at, 0) }",
    "  }",
    "  done = done + 1",
    "}",
  );
  lines.push(
    "stepF = (fi) => {",
    "  local(sp)",
    "  local(sk)",
    "  if (hp[fi] > 0) {",
    "    sp = spd[fi]",
    ...(config.statusMode === "tick" ? ["    for (sk = 0; sk < stN[fi]; sk = sk + 1) { sp = sp + stSpd[fi * 4 + sk] }"] : []),
    "    ch[fi] = ch[fi] + sp",
    "    if (ch[fi] >= mx[fi]) { act(fi) }",
    "  }",
    "}",
  );
  if (config.plain === "queued") lines.push('qid = thread("dispatch()", 0)');
  if (config.cancelable === "parked") lines.push('cid = thread("cdispatch()", 0)');
  // Setup is one-off and must not count as a battle tick: the battle starts on the next tick.
  lines.push("threadsleep(getthreadid(), 0.001)");
  if (config.threads === "perFighter") {
    lines.push("fighter = (i) => { while (1) { stepF(i); bt = bt + 1; threadsleep(getthreadid(), 0.001) } }");
    for (let i = 0; i < 4; i += 1) lines.push(`fid[${i}] = thread("fighter(${i})", 0)`);
    lines.push("threadsleep(getthreadid(), 0)");
  } else {
    lines.push("tick = () => { local(fi); bt = bt + 1; for (fi = 0; fi < 4; fi = fi + 1) { stepF(fi) } }");
    lines.push("while (1) {", "  tick()", "  threadsleep(getthreadid(), 0.001)", "}");
  }
  return lines.join("\n");
}

interface Run {
  /** Per tick, the steps each thread ran, by thread id. */
  byThread: Array<Record<number, number>>;
  /** Largest single-thread step count in any tick (the number THR-3 caps at STEP_BUDGET). */
  threadPeak: number;
  /** Largest single-thread step count among the fighter/battle threads (not the dispatchers). */
  actorPeak: number;
  /** Largest single-thread step count among the dispatcher threads. */
  dispatcherPeak: number;
  /** Mean steps per tick of the busiest thread. */
  idleFloor: number;
  /** Ticks where a thread ran its whole budget and was still ready. */
  preempted: number;
  /** Engine ticks from the first action starting to the fourth finishing (1 = same tick), or null. */
  fourActsAt: number | null;
  acts: number;
  /** Fighter-ticks that did not run because a thread was parked or preempted. */
  lostTicks: number;
  ticks: number;
  state: GameState;
}

function start(config: Config, seed = 7): { state: GameState; services: ScriptServices } {
  const state = createGameState({ seed });
  startProgram(state.vm, { kind: "inline", text: program(config), ir: "1" });
  return { state, services: createScriptServices(state) };
}

/** One tick of the script phases, in the order `advanceScriptTick` uses, returning each thread's steps. */
function tickOnce(state: GameState, services: ScriptServices, budget: number): { steps: Record<number, number>; preempted: number } {
  runWaitsPhase(state.vm, state.time, defaultWaitPoll);
  const ready = state.vm.threads.filter((thread) => thread.status === "ready").sort((a, b) => a.id - b.id);
  const steps: Record<number, number> = {};
  let preempted = 0;
  for (const thread of ready) {
    if (thread.status !== "ready") continue;
    const ran = stepThread(thread, state.vm, services, budget);
    steps[thread.id] = ran;
    if (ran >= budget && thread.status === "ready") preempted += 1;
  }
  runTimePhase(state.time);
  collectStateGarbage(state);
  return { steps, preempted };
}

const peak = (values: number[]): number => values.reduce((a, b) => (b > a ? b : a), 0);

function run(config: Config, ticks: number, budget: number): Run {
  const { state, services } = start(config);
  const byThread: Array<Record<number, number>> = [];
  let preempted = 0;
  let fourActsAt: number | null = null;
  let firstActAt: number | null = null;
  for (let t = 0; t < ticks; t += 1) {
    const result = tickOnce(state, services, budget);
    // Tick 0 is one-off setup, not a battle tick.
    if (t >= 1) {
      byThread.push(result.steps);
      preempted += result.preempted;
    }
    if (firstActAt === null && Number(state.vm.globals.acts) >= 1) firstActAt = t;
    if (fourActsAt === null && Number(state.vm.globals.done) >= 4) fourActsAt = t;
  }
  const dispatchers = [state.vm.globals.qid, state.vm.globals.cid].filter((id): id is number => typeof id === "number");
  const actors = byThread.map((tick) =>
    Object.entries(tick).filter(([id]) => !dispatchers.includes(Number(id))).map(([, steps]) => steps),
  );
  const dispatched = byThread.map((tick) =>
    Object.entries(tick).filter(([id]) => dispatchers.includes(Number(id))).map(([, steps]) => steps),
  );
  const fighters = config.threads === "single" ? 1 : 4;
  return {
    byThread,
    threadPeak: peak(byThread.flatMap((tick) => Object.values(tick))),
    actorPeak: peak(actors.flat()),
    dispatcherPeak: peak(dispatched.flat()),
    idleFloor: Math.min(...actors.map((tick) => peak(tick)).filter((value) => value > 0)),
    preempted,
    fourActsAt: fourActsAt === null || firstActAt === null ? null : fourActsAt - firstActAt + 1,
    acts: Number(state.vm.globals.acts),
    lostTicks: (ticks - (config.threads === "single" ? 1 : 2)) * fighters - Number(state.vm.globals.bt),
    ticks,
    state,
  };
}

const BIG = 1_000_000;
/** Ticks of a typical battle (random starting charges, seed 7) and of the worst burst (all four fighters act together). */
const TICKS = 300;
const BURST_TICKS = 14;

interface Row {
  name: string;
  config: Config;
}

const parked: Partial<Config> = { plain: "queued", cancelable: "parked" };
const rows: Row[] = [
  { name: "A0 no emits (ATB + 2 statuses only)", config: { ...BASE, emits: false } },
  { name: "A1 L=0 (emit call cost only)", config: { ...BASE, listeners: 0 } },
  { name: "A2 L=3 inline", config: BASE },
  { name: "A3 L=3 inline, no statuses", config: { ...BASE, statuses: 0 } },
  { name: "A4 L=3 inline, 4 statuses ticking speed every tick", config: { ...BASE, statuses: 4, statusMode: "tick" } },
  { name: "A5 L=8 inline", config: { ...BASE, listeners: 8 } },
  { name: "A6 L=16 inline", config: { ...BASE, listeners: 16 } },
  { name: "B1 L=3 plain emits queued (dispatcher thread)", config: { ...BASE, plain: "queued" } },
  { name: "B2 L=8 plain emits queued", config: { ...BASE, listeners: 8, plain: "queued" } },
  { name: "C1 L=3 parked cancelable + queued, one battle thread", config: { ...BASE, ...parked } },
  { name: "C2 L=8 parked cancelable + queued, one battle thread", config: { ...BASE, listeners: 8, ...parked } },
  { name: "D0 per-fighter threads, no emits", config: { ...BASE, threads: "perFighter", emits: false } },
  { name: "D1 per-fighter threads, L=3 inline", config: { ...BASE, threads: "perFighter" } },
  { name: "D2 per-fighter threads, L=8 inline", config: { ...BASE, threads: "perFighter", listeners: 8 } },
  { name: "D3 per-fighter threads, L=3 parked + queued", config: { ...BASE, threads: "perFighter", ...parked } },
  { name: "D4 per-fighter threads, L=8 parked + queued", config: { ...BASE, threads: "perFighter", listeners: 8, ...parked } },
  { name: "E1 mortal fighters, one thread, L=3 parked + queued", config: { ...BASE, immortal: false, ...parked } },
];

const REPORT = env.STEP_SPIKE_REPORT === "1";

test("spike: steps per tick for the stock ATB tick across configurations", () => {
  const results = new Map<string, { typical: Run; worst: Run; real: Run }>();
  for (const { name, config } of rows) {
    // Demand: no preemption, so the number is what the code needs. Real: the 1000-step budget as shipped.
    const typical = run(config, TICKS, BIG);
    const worst = run({ ...config, aligned: true }, BURST_TICKS, BIG);
    const real = run({ ...config, aligned: true }, BURST_TICKS, STEP_BUDGET);
    results.set(name, { typical, worst, real });
    if (REPORT) {
      log(
        [
          name.padEnd(54),
          `idle tick ${typical.idleFloor}`,
          `typical: max/thread ${typical.threadPeak} (actors ${typical.actorPeak}, dispatch ${typical.dispatcherPeak}) lost ${typical.lostTicks}/${typical.acts} acts`,
          `worst(4 act at once): max/thread ${worst.threadPeak} (actors ${worst.actorPeak}, dispatch ${worst.dispatcherPeak}) headroom ${STEP_BUDGET - worst.threadPeak}`,
          `real budget: preempted ${real.preempted}, 4 acts done by tick ${real.fourActsAt}`,
        ].join(" | "),
      );
    }
    ok(worst.fourActsAt !== null, `${name}: the four aligned actions finish`);
  }
  const of = (prefix: string) => {
    const entry = [...results.entries()].find(([name]) => name.startsWith(prefix));
    if (entry === undefined) throw new Error(`no row ${prefix}`);
    return entry[1];
  };
  // The findings the note rests on, as inequalities so a compiler change that shifts a count by a few steps does not fail them.
  ok(of("A0").worst.actorPeak > STEP_BUDGET, "one thread cannot even run four actions in a tick with no events at all");
  ok(of("A2").worst.actorPeak > STEP_BUDGET && of("A2").real.preempted > 0, "three inline listeners push the burst over the budget");
  ok(of("D1").worst.threadPeak < STEP_BUDGET * 0.6, "one thread per fighter with three inline listeners leaves 40 percent of the budget");
  ok(of("D2").worst.threadPeak < STEP_BUDGET, "one thread per fighter with eight inline listeners still fits");
  ok(of("C1").worst.threadPeak < STEP_BUDGET && of("C1").real.preempted === 0, "a parked dispatch fits the budget");
  const stall = of("C1").typical.lostTicks / of("C1").typical.acts;
  ok(stall > 1.5 && stall < 2.5, `a parked cancelable emit costs its emitter about two ticks, got ${stall}`);
  ok(of("D3").worst.fourActsAt! < of("C1").worst.fourActsAt!, "parallel emitters resolve a burst faster than one thread");
});

test("spike: two runs give the same hash (deterministic)", () => {
  const config: Config = { ...BASE, ...parked, immortal: false };
  const a = run(config, 200, STEP_BUDGET);
  const b = run(config, 200, STEP_BUDGET);
  equal(snapshot(a.state), snapshot(b.state));
  equal(JSON.stringify(a.byThread), JSON.stringify(b.byThread));
});

test("spike: a save at every step of a parked cancelable dispatch restores to the same state at every step", () => {
  const config: Config = { ...BASE, aligned: true, threads: "perFighter", ...parked, immortal: false };
  // Budget 1: every thread runs one step per tick, so each tick boundary is a step boundary,
  // including between two listeners of one dispatch and while emitters are parked.
  const steps = 1500;
  const straight = start(config);
  let state = start(config).state;
  let services = createScriptServices(state);
  let queuedWhileParked = 0;
  let betweenListeners = 0;
  for (let t = 0; t < steps; t += 1) {
    tickOnce(state, services, 1);
    tickOnce(straight.state, straight.services, 1);
    const queued = Number(state.vm.globals.chead) < Number(state.vm.globals.ctail);
    const emitterParked = state.vm.threads.some(
      (thread) => thread.id > 3 && thread.status === "waiting" && thread.wait?.kind === "sleep" && thread.wait.until === null,
    );
    if (queued && emitterParked) queuedWhileParked += 1;
    // The dispatcher is inside a listener call: its frames are cdispatch, runC and the listener.
    if (state.vm.threads.some((thread) => thread.id === state.vm.globals.cid && thread.frames.length >= 3)) betweenListeners += 1;
    const json = snapshot(state);
    equal(json, snapshot(straight.state), `the restored run diverged at step ${t}`);
    state = restoreGameState(json);
    services = createScriptServices(state);
  }
  ok(queuedWhileParked > 0, "saves must include steps where an emitter was parked with its entry still queued");
  ok(betweenListeners > 0, "saves must include steps inside one dispatch's listener calls");
});

test("spike: a cancelable emit gives the emitter the mutated event and the cancel, and later listeners still run (EMIT-5, EMIT-6)", () => {
  for (const cancelAll of [false, true]) {
    const config: Config = { ...BASE, ...parked, cancelAll };
    const { state, services } = start(config);
    for (let t = 0; t < 400; t += 1) tickOnce(state, services, STEP_BUDGET);
    // Let any in-flight dispatch finish: nothing parked on an emit and the queue drained.
    for (let t = 0; t < 40 && !(Number(state.vm.globals.chead) === Number(state.vm.globals.ctail) && state.vm.threads.every((thread) => thread.status !== "waiting" || thread.id === 1 || thread.id === state.vm.globals.cid || thread.id === state.vm.globals.qid)); t += 1) {
      tickOnce(state, services, STEP_BUDGET);
    }
    const g = state.vm.globals;
    const taken = 200000 - Number(g["hp[2]"]) - Number(g["hp[3]"]);
    const logged = Number(g["dmglog[0]"]) + Number(g["dmglog[1]"]);
    ok(logged > 0, "the logging listener runs after the cancel listener (it is registered after it)");
    if (cancelAll) {
      equal(Number(g["hp[2]"]) + Number(g["hp[3]"]), 200000, "a canceled hit changes no HP");
    } else {
      // The shield listener halved the event; the emitter applied the halved value, and the log listener saw it.
      equal(taken, logged);
    }
  }
});
