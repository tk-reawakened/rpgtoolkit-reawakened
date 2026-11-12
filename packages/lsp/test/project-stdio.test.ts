import { deepEqual, equal, match } from "node:assert/strict";
import { test } from "node:test";
import { UNASSESSED_CODE } from "../src/index.ts";
import { mainFileBytes, memoryProject } from "./project-support.ts";
import { startStdio } from "./stdio-client.ts";

/**
 * #2089 through the shipped stdio binary: the running project's dialect, not the
 * editor language mode, decides whether Toolkit 2 dialogue parses
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 */

const TK2 = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/talk.prg": "" }, "Main/legacy.gam");
const TK3 = memoryProject({ "Main/modern.gam": mainFileBytes("tk3"), "Prg/talk.prg": "" }, "Main/modern.gam", { rootUri: "file:///modern/" });

test("stdio: a Toolkit 2 project parses loose dialogue; a 3.1 project and an unassessed buffer do not claim it", { timeout: 15_000 }, async () => {
  const client = await startStdio();
  try {
    await client.project(TK2.snapshot());
    deepEqual(await client.open(TK2.uri("Prg/talk.prg"), "Hello there\n", "rpgcode-tk2"), [], "assessed Toolkit 2 project");
    const loose = await client.open("file:///loose/talk.prg", "Hello there\n", "rpgcode");
    deepEqual(loose.map((item) => item.code), [UNASSESSED_CODE, "syntax.error"], "outside the project: provisional 3.1 reading, marked unassessed");
    match(loose[0]!.message, /not a program of the running project/);
    await client.project(TK3.snapshot(2));
    const modern = await client.open(TK3.uri("Prg/talk.prg"), "Hello there\n", "rpgcode-tk2");
    deepEqual(modern.map((item) => item.code), ["syntax.error"], "a 3.1 project keeps the genuine error whatever the language mode");
    equal(modern[0]!.severity, 1);
  } finally {
    await client.close();
  }
});
