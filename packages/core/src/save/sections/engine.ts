/** Owner: core/engine; request sequencing, phase dispatch, claims and diagnostics. */
import type { Diagnostic } from "../../ports/engine.ts";
import type { EffectRecord } from "../../script/effects.ts";
import type { SectionKey } from "../state.ts";

export type EngineEffectQueue = Partial<Record<SectionKey, EffectRecord[]>>;

export type EnginePhase = "input" | "waits" | "threads" | "events" | "movement" | "edges" | "triggers" | "animation" | "audio" | "time";

/** The resumable VM portion of a fixed tick (AD-1 breakpoint cursor). */
export type OpenTickCursor = {
  /** Ready-thread order captured before the threads phase began. */
  readyThreads: number[];
  /** Index of `currentThread` in `readyThreads`. */
  readyIndex: number;
  currentThread: number;
  /** Number of VM instructions consumed in this open tick. */
  stepsUsed: number;
  /** Suppresses re-hitting a breakpoint while its source line still runs. */
  skip?: { file: string; line: number };
};

/** Boot and runtime asset requests; script-character and script-item bridge AssetReply bytes to waiting RPGCode continuations (AD-17). */
export type EngineRequestKind = "main" | "font" | "program" | "board" | "tile" | "animation" | "image" | "board-preview" | "audio" | "script-character" | "script-item" | "script-asset";

/** Boot progress (E-02): `main` and `assets` load files, `startup` runs the start-up program, `board` loads `initBoard`. */
export type BootStage = "main" | "assets" | "startup" | "board" | "running" | "stopped";

export type BootState = {
  stage: BootStage;
  /** Canonical key of the main file asset. */
  main: string;
  /** Keys of the private fonts installed for this run, in index order (E-02 step 2). */
  fonts: string[];
};

/** A `send` waiting for the engine to swap boards between ticks (E-19). */
export type BoardTransition = {
  board: string;
  /** One-based tile coordinates and layer. */
  x: number;
  y: number;
  layer: number;
};

export type EngineSection = {
  readonly nextRequestId?: number;
  readonly pending?: { readonly reqId: number; readonly key: string; readonly kind: EngineRequestKind }[];
  readonly failed?: boolean;
  phase?: EnginePhase;
  claims?: number[];
  openTick?: OpenTickCursor;
  pendingEffects?: EngineEffectQueue;
  effectDropped?: Partial<Record<SectionKey, number>>;
  effectDiagnostics?: Diagnostic[];
  /** Present when the engine boots from a main file; absent in scene mode. */
  boot?: BootState;
  /** The `send` the engine will perform before the next tick. */
  transition?: BoardTransition;
  /** The one outstanding video and whether its completion reply has arrived. */
  video?: { readonly reqId: number; readonly key: string; readonly presentation: "full" | "small"; readonly ended: boolean };
};
