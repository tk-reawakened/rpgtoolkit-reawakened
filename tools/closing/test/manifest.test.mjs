import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CLOSING_MANIFEST_PATH, closingGames, writeClosingManifest } from "../manifest.mjs";

/**
 * The manifest is how both hosts find the fetched games: a PWA origin cannot list a directory over HTTP, and the desktop
 * shell serves static paths over `app://`. These tests cover the two ways it can be wrong — a game listed without its
 * files, and a checkout with no fixtures at all.
 */
test("every fetched game is listed with its sorted, slash-separated files", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-closing-manifest-"));
  try {
    const demo = join(root, "fixtures", "legacy", "demo");
    mkdirSync(join(demo, "boards"), { recursive: true });
    writeFileSync(join(demo, "boards", "start.brd"), "board");
    writeFileSync(join(demo, "start.prg"), "program");
    const other = join(root, "fixtures", "legacy", "Basic");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "main.gam"), "game");

    assert.deepEqual(closingGames(root), {
      Basic: ["main.gam"],
      demo: ["boards/start.brd", "start.prg"],
    });
    assert.equal(writeClosingManifest(root), 2);
    const written = JSON.parse(readFileSync(join(root, CLOSING_MANIFEST_PATH), "utf8"));
    assert.deepEqual(written, { schema: 1, games: { Basic: ["main.gam"], demo: ["boards/start.brd", "start.prg"] } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a checkout without fetched fixtures writes an empty map instead of failing", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-closing-manifest-"));
  try {
    assert.deepEqual(closingGames(root), {});
    assert.equal(writeClosingManifest(root), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(root, CLOSING_MANIFEST_PATH), "utf8")), { schema: 1, games: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
