/**
 * Plain-language text for each structured checker report.
 */

import type { CheckReport } from "./check.ts";

export const code = (text: string): string => `\`${text}\``;

/** `a`, `b` and `c`: each item in code quotes, joined for a sentence. */
export function list(items: readonly string[]): string {
  const quoted = items.map(code);
  if (quoted.length <= 2) return quoted.join(" and ");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]!}`;
}

export function formatReport(report: CheckReport): string {
  switch (report.class) {
    case "stamp": {
      const where = report.line === null ? report.path : `${report.path}:${report.line}`;
      const found = report.found.length === 0 ? "" : `; found ${report.found.map((value) => JSON.stringify(value)).join(", ")}${report.problem === "not-first" ? " first" : ""}`;
      if (report.key === null) return `${where}: stamp cannot be read: ${report.reason}${found}`;
      if (report.problem === "missing") return `${where}: stamp key ${code(report.key)} is missing`;
      const state = {
        repeated: "repeated",
        malformed: "malformed",
        "not-first": "not among the first two keys",
        unreadable: "unreadable",
      }[report.problem];
      return `${where}: stamp key ${code(report.key)} is ${state}: ${report.reason}${found}`;
    }
    case "duplicate-id":
      return `duplicate ID ${code(report.id)}: ${list(report.paths)} ${report.paths.length === 2 ? "both" : "all"} resolve to it`;
    case "fold-collision":
      return `${list(report.paths)} fold to the same ID ${code(report.foldedId)}: IDs are compared with only A to Z folded to a to z`;
    case "plugin-block": {
      const where = report.line === null ? report.path : `${report.path}:${report.line}`;
      const plugin = report.pluginId === null ? "" : ` plugin ${code(report.pluginId)}`;
      const found = report.found === "" ? "" : `; found ${JSON.stringify(report.found)}`;
      return `${where}: plugin block${plugin} ${code(report.kind)}: ${report.reason}${found}`;
    }
    case "extension-contract-mismatch":
      return `${report.path}: the extension ${code(report.extension)} is registered for the contract ${code(report.registered)}, but the stamp names ${code(report.stamp)}. Either the extension or the stamp is wrong; the checker cannot tell which.`;
    case "native-art": {
      const where = report.line === null ? report.path : `${report.path}:${report.line}`;
      return `${where}: ${report.field}: ${report.message}`;
    }
  }
}
