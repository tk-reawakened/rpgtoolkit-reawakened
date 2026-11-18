/**
 * The checker reports stamp, document identity, plugin-envelope and registered
 * extension problems without repairing documents.
 */

import { readDocument, type DocumentInput, type StampReport } from "./document.ts";
import { compareText, foldId } from "./fold.ts";
import { classifyExtension, extensionOf, lookupExtension, REGISTRY, validateRegistry, type Registry } from "./registry.ts";
import type { PluginBlockProblemKind } from "./plugin-data.ts";

export type CheckConfig = {
  /** Extensions that mark a native document; absent means the shipped registry. */
  readonly documentExtensions?: readonly string[];
  /** The extension-to-contract table; absent means the shipped registry. */
  readonly registry?: Registry;
};

export type DuplicateIdReport = {
  readonly class: "duplicate-id";
  readonly id: string;
  readonly paths: readonly string[];
};

export type FoldCollisionReport = {
  readonly class: "fold-collision";
  readonly foldedId: string;
  readonly paths: readonly string[];
};

export type PluginBlockReport = {
  readonly class: "plugin-block";
  readonly path: string;
  readonly kind: PluginBlockProblemKind;
  readonly pluginId: string | null;
  readonly found: string;
  readonly reason: string;
  readonly line: number | null;
};

export type ExtensionContractMismatchReport = {
  readonly class: "extension-contract-mismatch";
  readonly path: string;
  readonly extension: string;
  readonly registered: string;
  readonly stamp: string;
};

export type CheckReport =
  | StampReport
  | DuplicateIdReport
  | FoldCollisionReport
  | PluginBlockReport
  | ExtensionContractMismatchReport;

export type ReportClass = CheckReport["class"];

export const REPORT_CLASSES: readonly ReportClass[] = [
  "stamp",
  "duplicate-id",
  "fold-collision",
  "plugin-block",
  "extension-contract-mismatch",
];

const RESERVED_KEYS: Readonly<Record<string, readonly string[]>> = {
  "animation-clip": ["canvas", "delay", "colourKey", "frames"],
};

/**
 * The ID of a document: its path, extension included, with empty and `.` parts
 * dropped. Case is kept; comparison folds it with the ASCII-only fold.
 */
export function documentId(path: string): string {
  return path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

type Doc = {
  readonly input: DocumentInput;
  readonly path: string;
  readonly id: string;
};

/** Throws a RangeError naming the first unusable checker option. */
export function validateConfig(config: CheckConfig): void {
  if (config.documentExtensions !== undefined &&
      (config.documentExtensions.length === 0 || config.documentExtensions.some((extension) => extension === ""))) {
    throw new RangeError("at least one non-empty document extension is required");
  }
  if (config.registry !== undefined) validateRegistry(config.registry);
}

/** Whether a path names a native document under the supplied registry/configuration. */
export function isDocumentPath(path: string, config: Pick<CheckConfig, "documentExtensions" | "registry">): boolean {
  if (config.documentExtensions === undefined) return classifyExtension(extensionOf(path), config.registry ?? REGISTRY) === "native-registered";
  const folded = foldId(path);
  return config.documentExtensions.some((extension) => {
    const suffix = foldId(extension);
    return folded.endsWith(suffix) && path.length > suffix.length;
  });
}

function group<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/** Check a folder's documents; reports are stable by class, then path. */
export function checkDocuments(inputs: readonly DocumentInput[], config: CheckConfig = {}): CheckReport[] {
  validateConfig(config);
  const registry = config.registry ?? REGISTRY;
  const docs: Doc[] = inputs
    .filter((input) => isDocumentPath(input.path, config))
    .sort((left, right) => compareText(left.path, right.path))
    .map((input) => ({ input, path: input.path, id: documentId(input.path) }));
  const reads = docs.map((doc) => {
    const extension = extensionOf(doc.path) ?? "";
    const contract = lookupExtension(extension, registry)?.contract;
    const reserved = [...(contract === undefined ? [] : RESERVED_KEYS[contract] ?? [])];
    const read = readDocument(doc.input, ["contract"], reserved);
    return { ...doc, read };
  });
  const reports: CheckReport[] = [];
  for (const doc of reads) {
    reports.push(...doc.read.stampReports);
    for (const problem of doc.read.pluginProblems) {
      reports.push({ class: "plugin-block", path: doc.path, ...problem });
    }
  }

  const byId = group(reads, (doc) => doc.id);
  for (const [id, same] of byId) {
    if (same.length > 1) reports.push({ class: "duplicate-id", id, paths: same.map((doc) => doc.path) });
  }
  const byFold = group(reads, (doc) => foldId(doc.id));
  for (const [foldedId, same] of byFold) {
    if (new Set(same.map((doc) => doc.id)).size > 1) {
      reports.push({ class: "fold-collision", foldedId, paths: same.map((doc) => doc.path) });
    }
  }

  for (const doc of reads) {
    const entry = lookupExtension(extensionOf(doc.path) ?? "", registry);
    const contractValues = doc.read.fields.get("contract");
    if (entry === undefined || contractValues === undefined || contractValues.length !== 1) continue;
    const stamped = contractValues[0]!;
    if (stamped.kind === "text" && stamped.value !== entry.contract) {
      reports.push({
        class: "extension-contract-mismatch",
        path: doc.path,
        extension: entry.extension,
        registered: entry.contract,
        stamp: stamped.value,
      });
    }
  }

  const rank = (report: CheckReport): number => REPORT_CLASSES.indexOf(report.class);
  const firstPath = (report: CheckReport): string => {
    switch (report.class) {
      case "stamp":
      case "plugin-block":
      case "extension-contract-mismatch":
        return report.path;
      case "duplicate-id":
      case "fold-collision":
        return report.paths[0] ?? "";
    }
  };
  return reports.sort((left, right) => rank(left) - rank(right) || compareText(firstPath(left), firstPath(right)));
}
