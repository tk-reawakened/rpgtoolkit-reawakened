import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPackageCatalogue, parsePackageManifest } from "../src/package-catalogue.ts";

/**
 * The `script-spec` package folder (TOOL-5): a valid manifest the catalogue can
 * load by name, and a start-up program that is plain RPGCode.
 */

const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "script-spec", "package");
const manifestText = readFileSync(join(folder, "manifest.json"), "utf8");
const programSource = readFileSync(join(folder, "startup.prg"), "utf8");

test("the manifest parses and declares the start-up program", () => {
  const parsed = parsePackageManifest(manifestText, "script-spec/manifest.json");
  ok(parsed.ok);
  equal(parsed.manifest.name, "script-spec");
  equal(parsed.manifest.namespace, "scriptspec");
  equal(parsed.manifest.program, "startup.prg");
  deepEqual(parsed.manifest.requests, []);
});

test("the catalogue loads the package by name", () => {
  const result = buildPackageCatalogue([{ label: "script-spec", manifestText, programSource }]);
  ok(result.ok);
  equal(result.entries.length, 1);
  const [entry] = result.entries;
  ok(entry);
  equal(entry.name, "script-spec");
  ok(entry.startup !== undefined);
  equal(entry.startup.kind, "inline");
  ok(programSource.includes("function describe("));
  ok(programSource.includes("function expect("));
  ok(programSource.includes('specResult("fail"'));
});
