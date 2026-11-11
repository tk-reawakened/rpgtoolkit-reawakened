import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CASES, caseProblem, caseSetup, measure } from "../measure.mjs";

test("a child that exits without a report fails promptly and writes diagnostics", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
  const out = join(dir, "nested", "failure.json");
  try {
    await assert.rejects(measure({
      game: "test.tpk",
      out,
      timeoutMs: 5000,
      command: [process.execPath, "-e", "process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exitCode = 23"],
    }), /exit code 23[\s\S]*(?:out[\s\S]*err|err[\s\S]*out)/);
    const failure = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(failure.exitCode, 23);
    assert.equal(failure.signal, null);
    assert.match(failure.error, /exit code 23/);
    assert.match(failure.output, /out/);
    assert.match(failure.output, /err/);
    assert.equal(typeof failure.elapsedMs, "number");
    assert.ok(failure.elapsedMs >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the deadline path retains its error and writes diagnostics", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
  const out = join(dir, "failure.json");
  try {
    await assert.rejects(measure({
      game: "test.tpk",
      out,
      timeoutMs: 0,
      command: [process.execPath, "-e", "process.stdin.resume()"],
    }), /^Error: no report within the deadline; log:\n/);
    const failure = JSON.parse(readFileSync(out, "utf8"));
    assert.match(failure.error, /^no report within the deadline; log:\n/);
    assert.equal(typeof failure.elapsedMs, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.platform !== "win32") {
  test("a child terminated by a signal reports that signal", { timeout: 1000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
    const out = join(dir, "failure.json");
    try {
      await assert.rejects(measure({
        game: "test.tpk",
        out,
        timeoutMs: 5000,
        command: [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      }), /signal SIGTERM/);
      const failure = JSON.parse(readFileSync(out, "utf8"));
      assert.equal(failure.exitCode, null);
      assert.equal(failure.signal, "SIGTERM");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("each launch case lays out the directories its rule reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-case-"));
  try {
    const pkg = join(dir, "demo.tpk");
    writeFileSync(pkg, "package bytes");
    writeFileSync(`${pkg}.json`, JSON.stringify({
      schema: 1, file: "demo.tpk", sha256: "a".repeat(64), size: 13, gameId: "g-demo", title: "Demo", version: "1",
    }));

    const argument = caseSetup("argument", pkg);
    assert.deepEqual(argument.launchArgs.slice(-2), ["--game", pkg]);
    assert.equal(argument.expected, "argument");

    const playerJson = caseSetup("player-json", pkg);
    const dataDir = playerJson.launchArgs[1];
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "player.json"), "utf8")), { schema: 1, defaultGame: pkg });
    assert.equal(playerJson.launchArgs.includes("--game"), false);

    const baked = caseSetup("baked", pkg);
    const resources = baked.launchArgs[baked.launchArgs.indexOf("--resources") + 1];
    assert.equal(readFileSync(join(resources, "game.tpk"), "utf8"), "package bytes");
    assert.equal(readFileSync(join(resources, "game.tpk.json"), "utf8").includes("g-demo"), true);

    const library = caseSetup("library", pkg);
    const registry = JSON.parse(readFileSync(join(library.launchArgs[1], "library.json"), "utf8"));
    assert.equal(registry.schema, 1);
    assert.equal(registry.entries[0].gameId, "g-demo");
    assert.equal(registry.entries[0].packageLocation, pkg);
    assert.equal(library.picked, "g-demo");

    const empty = caseSetup("library-empty", pkg);
    assert.equal(empty.expected, "none");

    assert.deepEqual(CASES, ["argument", "player-json", "baked", "library", "library-empty"]);
    assert.throws(() => caseSetup("nonsense", pkg), /unknown --case/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a case's expectation fails on the wrong launch step, the wrong pick, or a silent empty library", () => {
  assert.equal(caseProblem({ expected: "argument", picked: null }, { resolvedBy: "argument" }), null);
  assert.match(caseProblem({ expected: "argument", picked: null }, { resolvedBy: "config" }), /expected launch step argument/);

  assert.equal(caseProblem({ expected: "library", picked: "g" }, { resolvedBy: "library", picked: "g" }), null);
  assert.match(caseProblem({ expected: "library", picked: "g" }, { resolvedBy: "library", picked: "other" }), /expected the library entry g/);

  assert.match(caseProblem({ expected: "none", picked: null }, { resolvedBy: "none", error: null }), /expected the stated reason/);
  assert.match(caseProblem({ expected: "none", picked: null }, { resolvedBy: "library", error: "No game was chosen: pass --game" }), /expected launch step none/);
  assert.equal(caseProblem({ expected: "none", picked: null }, { resolvedBy: "none", error: "No game was chosen: pass --game" }), null);
});
