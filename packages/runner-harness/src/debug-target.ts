/**
 * The scene a debug session drives (TOOL-8; AD-21).
 *
 * A debug adapter needs an engine it can stop inside and a program it can name
 * to a client. This module builds the smallest such scene: one authored board
 * and one inline program, launched through `SceneInit` (`initialBoard` plus
 * `program`), with the board's bytes answered the way a host answers an asset
 * request. It is the platform-neutral half of the launch — no file is read here,
 * so the host supplies the bytes — which is why it lives beside the other
 * headless-runner builders and not in `dap` (AD-21: `dap` depends on
 * `runner-harness`).
 *
 * docs/spec/engine/rpgcode-tooling.md#tool-8
 */

import {
  assetKey,
  createAssetIndex,
  createEngine,
  PACKAGE_ROOT,
  type AssetKey,
  type Engine,
  type InputRecord,
  type RunnerRequest,
  type TickReport,
} from "@tk-reawakened/core";

export type SceneDebugTargetOptions = {
  /** The board file's name inside `Boards/`, for example `debug.brd`. */
  readonly board: string;
  /** The board's bytes, exactly as a host would deliver them. */
  readonly boardBytes: Uint8Array;
  /** The program's source text; it runs as an inline program, so no file is read. */
  readonly program: string;
  /** The client's own path for `program`, which breakpoints and stack frames report. */
  readonly programPath: string;
  readonly seed?: number;
  readonly width?: number;
  readonly height?: number;
  readonly maxTicks?: number;
};

export type SceneDebugTarget = {
  readonly engine: Engine;
  /** The launched program: the client's path and the text the engine compiled. */
  readonly program: { readonly path: string; readonly text: string };
  /** The inputs that answer `report`'s host requests, for the next `advance`. */
  answer(report: TickReport): readonly InputRecord[];
};

function reply(request: RunnerRequest, tick: number, boardKey: AssetKey, boardBytes: Uint8Array): InputRecord | null {
  if (request.kind === "asset") {
    return { tick, event: { kind: "asset", reqId: request.reqId, bytes: request.key === boardKey ? boardBytes : null } };
  }
  if (request.kind === "playVideo") return { tick, event: { kind: "video.ended", reqId: request.reqId } };
  return null;
}

/**
 * Build the scene and settle its launch, so the first `continue` starts the
 * program. The board is requested by the first `advance`, exactly as a runner
 * would see it, and answered from `boardBytes`.
 */
export function createSceneDebugTarget(options: SceneDebugTargetOptions): SceneDebugTarget {
  const boardKey = assetKey(`Boards/${options.board}`);
  const engine = createEngine({
    seed: options.seed ?? 0,
    assetIndex: createAssetIndex([boardKey]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: options.board,
    width: options.width ?? 320,
    height: options.height ?? 240,
    maxTicks: options.maxTicks ?? 3600,
    program: options.program,
  });
  const answer = (report: TickReport): readonly InputRecord[] => {
    const inputs: InputRecord[] = [];
    for (const request of report.requests) {
      const input = reply(request, report.tickAfter, boardKey, options.boardBytes);
      if (input !== null) inputs.push(input);
    }
    return inputs;
  };
  const opening = engine.advance(0, []);
  const replies = answer(opening);
  if (replies.length > 0) engine.advance(0, replies);
  return { engine, program: { path: options.programPath, text: options.program }, answer };
}
