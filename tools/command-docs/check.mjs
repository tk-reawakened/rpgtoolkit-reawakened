import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSpecTable } from "./spec-table.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const core = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
const { commandDocumentation, validateCommandDocumentation, CORE_PLUGIN, MEDIA_PLUGIN, BATTLE_PLUGIN, CATALOGUE_PLUGIN, NATIVE_PACK_TABLE } = core;
const specPath = join(root, "docs/spec/engine/rpgcode-functions.md");
const allowlistPath = join(root, "tools/command-docs/legacy-allowlist.json");

function readAllowlist() {
  const value = JSON.parse(readFileSync(allowlistPath, "utf8"));
  if (value === null || typeof value !== "object" || !Array.isArray(value.commands)) {
    throw new Error("legacy-allowlist.json must contain a commands array");
  }
  return value.commands;
}

function defaultPlugins() {
  const ids = ["core", "media", "battle", "catalogue", "gsmisc", "triuken", "filereadwrite", "proplug", "xfmwin", "kaimu", "twbutton"];
  const definitions = { core: CORE_PLUGIN, media: MEDIA_PLUGIN, battle: BATTLE_PLUGIN, catalogue: CATALOGUE_PLUGIN, ...NATIVE_PACK_TABLE };
  return ids.map((id) => {
    const definition = definitions[id];
    if (definition === undefined) throw new Error(`default plugin ${id} is not available`);
    return { definition };
  });
}

function specLinkDiagnostics(documentation) {
  const diagnostics = [];
  const seen = new Set();
  for (const entry of documentation) {
    for (const link of entry.see) {
      if (!link.startsWith("docs/spec/")) continue;
      const key = `${entry.pluginId}/${entry.name}:${link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hash = link.indexOf("#");
      const relativePath = hash < 0 ? link : link.slice(0, hash);
      const anchor = hash < 0 ? "" : link.slice(hash + 1);
      const path = join(root, relativePath);
      if (!existsSync(path)) {
        diagnostics.push({ code: "doc.see-file", pluginId: entry.pluginId, name: entry.name, key: `${entry.pluginId}/${entry.name}`, message: `${entry.pluginId}/${entry.name} see link ${link} names a missing docs/spec file` });
        continue;
      }
      if (anchor === "") continue;
      const text = readFileSync(path, "utf8");
      const slug = (heading) => heading.toLowerCase().replace(/[^\\p{L}\\p{N} -]/gu, "").trim().replace(/\\s+/g, "-");
      const anchorExists = text.includes(`id=\"${anchor}\"`) || text.split(/\\r?\\n/).some((line) => /^#{1,6}\\s+/.test(line) && slug(line.replace(/^#{1,6}\\s+/, "")) === anchor);
      if (!anchorExists) diagnostics.push({ code: "doc.see-anchor", pluginId: entry.pluginId, name: entry.name, key: `${entry.pluginId}/${entry.name}`, message: `${entry.pluginId}/${entry.name} see link ${link} names a missing docs/spec anchor` });
    }
  }
  return diagnostics;
}

/** Every public battle-facing command and alias needs a row in the native command tables (legacy or Reawakened addition). */
function battleRowDiagnostics(documentation, rows) {
  const names = new Set(rows.map((row) => row.name.toLowerCase()));
  return documentation
    .filter((entry) => entry.pluginId === "battle" && entry.access === "public" && !names.has(entry.name.toLowerCase()))
    .map((entry) => ({ code: "native.row-missing", pluginId: entry.pluginId, name: entry.name, key: `${entry.pluginId}/${entry.name}`, message: `${entry.pluginId}/${entry.name} is a public battle built-in with no row in docs/spec/engine/rpgcode-functions.md` }));
}

export function check({ plugins = defaultPlugins(), rows = parseSpecTable(readFileSync(specPath, "utf8")), allowlist = readAllowlist() } = {}) {
  const documentation = commandDocumentation(plugins);
  const diagnostics = [...validateCommandDocumentation(plugins, rows, allowlist), ...specLinkDiagnostics(documentation), ...battleRowDiagnostics(documentation, rows)];
  return { diagnostics, documentation };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = check();
    if (result.diagnostics.length > 0) {
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.pluginId === undefined ? "allowlist" : `${diagnostic.pluginId}/${diagnostic.name}`;
        console.error(`${diagnostic.code}: ${location}: ${diagnostic.message}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
