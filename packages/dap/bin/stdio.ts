/**
 * The stdio host for the RPGCode debug adapter (TOOL-8 server note).
 *
 * This file lives outside `packages/dap/src/` and the package's public export,
 * so importing the package never opens a pipe and the library stays free of
 * Node APIs (G2, AD-21). It is the one place that reads a program and a board
 * from disk and hands them to `createSceneDebugTarget`.
 *
 *   node packages/dap/dist-bin/stdio.js --program <Prg/probe.prg> --board <Boards/probe.brd>
 *
 * A client's `launch` arguments may repeat either path; they win over the
 * command line, so an editor that knows the file it is debugging passes it.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createSceneDebugTarget } from "@tk-reawakened/runner-harness";
import { serveDebugSession } from "../dist/index.js";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

const programPath = option("program");
const boardPath = option("board");
if (programPath === undefined || boardPath === undefined) {
  process.stderr.write("usage: rpgcode-dap --program <path.prg> --board <path.brd>\n");
  process.exit(2);
}

serveDebugSession(
  {
    input: { onData: (listener) => void process.stdin.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk))) },
    output: { write: (text) => void process.stdout.write(text) },
  },
  {
    launch: (launchArguments) => {
      const program = typeof launchArguments.program === "string" ? launchArguments.program : programPath;
      const board = typeof launchArguments.board === "string" ? launchArguments.board : boardPath;
      return createSceneDebugTarget({
        board: basename(board),
        boardBytes: new Uint8Array(readFileSync(resolve(board))),
        program: readFileSync(resolve(program), "utf8"),
        programPath: resolve(program),
        seed: 7,
        width: 320,
        height: 240,
      });
    },
  },
);
