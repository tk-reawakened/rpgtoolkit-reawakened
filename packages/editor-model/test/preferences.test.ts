// Editor preferences (story 11.5): validation per type, layer precedence, user-only entries, reset, search, and the
// VS Code block the catalogue generates. Every case runs over the in-memory host's settings, which store as a host does.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createPreferences, PREFERENCE_CATALOGUE, preferenceById, validatePreference, vscodeContributions } from "../src/index.ts";

const entry = (id: string) => {
  const found = preferenceById(id);
  ok(found !== undefined, id);
  return found;
};

test("each type refuses a value of the wrong kind with a reason, and coerces nothing", () => {
  equal(validatePreference(entry("editor.showTips"), "true").ok, false);
  equal(validatePreference(entry("editor.language"), "fr").ok, false);
  const refused = validatePreference(entry("syntax.keyword.color"), "blue");
  equal(refused.ok, false);
  equal(refused.ok ? "" : refused.reason, "Enter a colour as # and six hexadecimal digits, such as #1a2b3c.");
  equal(validatePreference(entry("editor.backgroundImage"), "a\nb").ok, false);
  equal(validatePreference(entry("editor.backgroundImage"), "x".repeat(261)).ok, false);
  deepEqual(validatePreference(entry("syntax.keyword.color"), "#ABCDEF"), { ok: true, value: "#abcdef" });
});

test("the project value wins over the user value, which wins over the default, and reset restores the next layer down", async () => {
  const host = createMemoryPlatformServices({});
  const prefs = createPreferences({ settings: host.settings });
  await prefs.refresh();
  const row = () => prefs.getSnapshot().rows.find((r) => r.entry.id === "board.startLocationDisplay")!;
  equal(row().effective, "initial");
  equal(row().source, "default");
  deepEqual(await prefs.set("board.startLocationDisplay", "user", "every"), { ok: true });
  equal(row().source, "user");
  deepEqual(await prefs.set("board.startLocationDisplay", "project", "initial"), { ok: true });
  equal(row().effective, "initial");
  equal(row().source, "project");
  await prefs.reset("board.startLocationDisplay", "project");
  equal(row().effective, "every");
  await prefs.reset("board.startLocationDisplay", "user");
  equal(row().source, "default");
  deepEqual(await host.settings.get("user", "board.startLocationDisplay"), { ok: true, value: null });
});

test("a refused value is stored nowhere; a user-only entry refuses the project layer", async () => {
  const host = createMemoryPlatformServices({});
  const prefs = createPreferences({ settings: host.settings });
  await prefs.refresh();
  const bad = await prefs.set("syntax.keyword.color", "user", "red");
  equal(bad.ok, false);
  deepEqual(await host.settings.get("user", "syntax.keyword.color"), { ok: true, value: null });
  const personal = await prefs.set("editor.showTips", "project", false);
  equal(personal.ok, false);
  equal((await prefs.set("no.such", "user", true)).ok, false);
});

test("a stored invalid or project-layer value for a user-only entry falls back and is reported once", async () => {
  const host = createMemoryPlatformServices({});
  await host.settings.set("user", "syntax.keyword.color", "red");
  await host.settings.set("project", "editor.showTips", false);
  const prefs = createPreferences({ settings: host.settings });
  await prefs.refresh();
  await prefs.refresh();
  const snapshot = prefs.getSnapshot();
  const keyword = snapshot.rows.find((r) => r.entry.id === "syntax.keyword.color")!;
  equal(keyword.effective, "#0000ff");
  equal(snapshot.rows.find((r) => r.entry.id === "editor.showTips")!.effective, true);
  equal(snapshot.problems.length, 2);
});

test("a host without a project layer refuses to write one and never reads it", async () => {
  const host = createMemoryPlatformServices({});
  await host.settings.set("project", "board.startLocationDisplay", "every");
  const prefs = createPreferences({ settings: host.settings, projectLayer: false });
  await prefs.refresh();
  equal(prefs.getSnapshot().rows.find((r) => r.entry.id === "board.startLocationDisplay")!.effective, "initial");
  equal((await prefs.set("board.startLocationDisplay", "project", "every")).ok, false);
});

test("a host that cannot save says so and leaves the snapshot unchanged", async () => {
  const host = createMemoryPlatformServices({});
  const settings = { get: host.settings.get, set: () => Promise.resolve({ ok: false as const, error: { code: "io-error" as const, message: "disk full" } }) };
  const prefs = createPreferences({ settings });
  await prefs.refresh();
  const result = await prefs.set("editor.showTips", "user", false);
  equal(result.ok, false);
  equal(prefs.getSnapshot().rows.find((r) => r.entry.id === "editor.showTips")!.effective, true);
});

test("search matches every word against group, label, description and id", async () => {
  const prefs = createPreferences({ settings: createMemoryPlatformServices({}).settings });
  await prefs.refresh();
  deepEqual(prefs.search("flood").map((r) => r.entry.id), ["board.revertToDrawAfterFlood", "board.recursiveFlood"]);
  equal(prefs.search("").length, PREFERENCE_CATALOGUE.length);
  equal(prefs.search("keyword nonsense").length, 0);
});

test("the VS Code block committed in the extension is the one the catalogue generates", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../extensions/editor/package.json", import.meta.url), "utf8"));
  const generated = vscodeContributions();
  deepEqual(pkg.contributes.configuration, generated.configuration);
  deepEqual(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations, generated.restrictedConfigurations);
  for (const property of Object.values(generated.configuration.properties)) equal(property.scope, "window");
  equal(generated.restrictedConfigurations.includes("rpgToolkit.board.startLocationDisplay"), false);
});
