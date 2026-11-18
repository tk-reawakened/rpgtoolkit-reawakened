/**
 * Structural validation for native-document plugin blocks. Plugin-owned `data`
 * remains opaque: this module checks only the block envelope and YAML anchors.
 */

import { isAlias, isMap, isScalar, type Document, type LineCounter, type Node, type Pair } from "yaml";
import { parseVersion } from "./version.ts";

export type PluginBlockProblemKind = "container" | "id" | "duplicate" | "shape" | "version" | "data" | "boundary";

export type PluginBlockProblem = {
  readonly kind: PluginBlockProblemKind;
  readonly pluginId: string | null;
  readonly found: string;
  readonly reason: string;
  readonly line: number | null;
};

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)*$/;
const ENVELOPE_KEYS: Readonly<Record<string, true>> = { version: true, data: true };
const RESERVED_KEYS: Readonly<Record<string, true>> = {
  contract: true,
  version: true,
  tags: true,
  metadata: true,
  pluginData: true,
};
const SNIPPET_LIMIT = 80;

function sourceOf(text: string, node: Node | null): string {
  if (node === null || node.range === undefined || node.range === null) return "";
  return text.slice(node.range[0], node.range[1]);
}

function snippet(text: string, node: Node | null): string {
  const value = sourceOf(text, node).replace(/\s+/g, " ").trim();
  return value.length > SNIPPET_LIMIT ? `${value.slice(0, SNIPPET_LIMIT)}…` : value;
}

function keyName(text: string, pair: Pair): string {
  const key = pair.key as Node | null;
  return isScalar(key) && typeof key.value === "string" ? key.value : snippet(text, key);
}

function lineOf(lines: LineCounter, node: Node | null): number | null {
  return node?.range == null ? null : lines.linePos(node.range[0]).line;
}

function scalarText(node: Node | null): string | null {
  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

/** Validate pluginData without interpreting any value under its data mappings. */
export function validatePluginData(
  document: Document.Parsed,
  text: string,
  lines: LineCounter,
  reservedKeys: readonly string[],
): readonly PluginBlockProblem[] {
  const root = document.contents;
  if (!isMap(root)) return [];
  const problems: PluginBlockProblem[] = [];
  const rootEntries = root.items.filter((pair) => keyName(text, pair) === "pluginData");
  if (rootEntries.length === 0) return problems;

  const add = (kind: PluginBlockProblemKind, pluginId: string | null, found: string, reason: string, node: Node | null): void => {
    problems.push({ kind, pluginId, found, reason, line: lineOf(lines, node) });
  };
  if (rootEntries.length > 1) {
    const key = rootEntries[1]!.key as Node | null;
    add("container", null, snippet(text, key), "`pluginData` appears more than once; it must appear once", key);
  }
  const pluginPairs: { readonly id: string; readonly key: Node | null; readonly value: Node | null }[] = [];
  for (const containerPair of rootEntries) {
    const container = containerPair.value as Node | null;
    if (!isMap(container)) {
      add("container", null, snippet(text, container), "`pluginData` must be a mapping from plugin id to block", containerPair.key as Node | null);
      continue;
    }
    for (const pair of container.items) {
      const id = keyName(text, pair);
      const key = pair.key as Node | null;
      const reserved = RESERVED_KEYS[id] === true || reservedKeys.includes(id);
      if (!PLUGIN_ID.test(id) || reserved) {
        add("id", id, id, reserved ? `plugin id ${JSON.stringify(id)} is a reserved top-level key` : "plugin id must be lowercase ASCII dot-separated identifier segments", key);
      }
      pluginPairs.push({ id, key, value: pair.value as Node | null });
    }
  }

  const seenIds = new Set<string>();
  const emittedDuplicate = new Set<string>();
  for (const { id, key } of pluginPairs) {
    if (seenIds.has(id)) {
      if (!emittedDuplicate.has(id)) {
        emittedDuplicate.add(id);
        add("duplicate", id, id, `plugin id ${JSON.stringify(id)} appears more than once in \`pluginData\``, key);
      }
    } else {
      seenIds.add(id);
    }
  }

  for (const { id, value } of pluginPairs) {
    if (!isMap(value)) {
      add("shape", id, snippet(text, value), "a plugin block must be a mapping", value);
      continue;
    }
    const names = value.items.map((pair) => keyName(text, pair));
    const versionPairs = value.items.filter((pair) => keyName(text, pair) === "version");
    const dataPairs = value.items.filter((pair) => keyName(text, pair) === "data");
    const unknown = value.items.filter((pair) => ENVELOPE_KEYS[keyName(text, pair)] !== true);
    if (versionPairs.length !== 1 || dataPairs.length !== 1 || unknown.length > 0 || names.length !== 2) {
      const offender = unknown[0];
      const missing = [versionPairs.length === 0 ? "version" : "", dataPairs.length === 0 ? "data" : ""].filter(Boolean);
      const reason = offender !== undefined
        ? `plugin block envelope has unexpected key ${JSON.stringify(keyName(text, offender))}`
        : missing.length > 0
          ? `plugin block envelope is missing ${missing.map((name) => JSON.stringify(name)).join(" and ")}`
          : "plugin block envelope must contain exactly one `version` and one `data` key";
      const found = offender === undefined ? snippet(text, value) : snippet(text, offender.key as Node | null);
      add("shape", id, found, reason, offender === undefined ? value : (offender.key as Node | null));
    }
    if (versionPairs.length === 1) {
      const pair = versionPairs[0]!;
      const raw = scalarText(pair.value as Node | null);
      const version = raw === null ? null : parseVersion(raw);
      if (version === null || !version.ok) {
        const found = snippet(text, pair.value as Node | null);
        const reason = version === null ? "plugin version must be a text value" : version.reason;
        add("version", id, found, reason, pair.key as Node | null);
      }
    }
    if (dataPairs.length === 1 && !isMap(dataPairs[0]!.value as Node | null)) {
      const pair = dataPairs[0]!;
      add("data", id, snippet(text, pair.value as Node | null), "plugin block `data` must be a mapping", pair.key as Node | null);
    }
  }

  // Anchor ownership is assigned to the plugin block containing each node; null is
  // document-level YAML. A reference is invalid precisely when its owner differs.
  type PluginScope = { readonly pluginId: string };
  const anchors = new Map<string, { readonly scope: PluginScope | null; readonly node: Node }[]>();
  const aliases: { readonly scope: PluginScope | null; readonly node: Node; readonly source: string }[] = [];
  const visit = (node: Node | null, scope: PluginScope | null): void => {
    if (node === null) return;
    const anchored = (node as Node & { anchor?: string }).anchor;
    if (anchored !== undefined) anchors.set(anchored, [...(anchors.get(anchored) ?? []), { scope, node }]);
    if (isAlias(node)) aliases.push({ scope, node, source: node.source });
    else if (isMap(node)) for (const pair of node.items) {
      visit(pair.key as Node | null, scope);
      visit(pair.value as Node | null, scope);
    }
    else if ("items" in node && Array.isArray(node.items)) for (const child of node.items) visit(child as Node | null, scope);
  };
  for (const pair of root.items) {
    visit(pair.key as Node | null, null);
    if (keyName(text, pair) !== "pluginData" || !isMap(pair.value as Node | null)) {
      visit(pair.value as Node | null, null);
      continue;
    }
    for (const plugin of (pair.value as typeof root).items) {
      const id = keyName(text, plugin);
      visit(plugin.key as Node | null, null);
      const scope: PluginScope = { pluginId: id };
      visit(plugin.value as Node | null, scope);
    }
  }
  const boundaryKeys = new Set<string>();
  for (const alias of aliases) {
    for (const anchor of anchors.get(alias.source) ?? []) {
      if (anchor.scope === alias.scope) continue;
      const id = alias.scope?.pluginId ?? anchor.scope?.pluginId ?? null;
      const token = `${id ?? ""}:${alias.node.range?.[0] ?? -1}:${anchor.node.range?.[0] ?? -1}`;
      if (id !== null && !boundaryKeys.has(token)) {
        boundaryKeys.add(token);
        add("boundary", id, `*${alias.source}`, "an alias or anchor crosses a plugin block boundary", alias.node);
      }
    }
  }
  return problems;
}
