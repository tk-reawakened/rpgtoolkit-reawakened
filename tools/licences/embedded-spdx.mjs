import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Inspect the public root bundles separately from their package-level licence declaration. */
export function embeddedSpdx(packagePath) {
  const findings = [];
  for (const path of ["index.js", "index.cjs"]) {
    const file = join(packagePath, path);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const identifiers = new Set();
    for (const match of bytes.toString("utf8").matchAll(/SPDX-License-Identifier:\s*([^\r\n*]+)/g)) {
      identifiers.add(match[1].trim());
    }
    if (identifiers.size > 0) findings.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      expressions: [...identifiers].sort(),
    });
  }
  return findings;
}
