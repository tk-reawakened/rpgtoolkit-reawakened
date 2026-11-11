// ADR 0025 "What 11.2 does first" item 4 (lint half): the repository's ESLint configuration reads `.tsx` files, so the
// guard-rail rules (G2, G3) and the suppression rules apply to the editor's views. Fixture sources are linted as text
// under a synthetic path, as packages/core/test/lint-rules.test.ts does, so nothing is written to the tree.
import { test } from "node:test";
import { deepEqual, equal, match } from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const eslint = new ESLint({ cwd: repoRoot });

async function lint(path, code) {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, path) });
  if (result === undefined) throw new Error(`no lint result for ${path}`);
  return result.messages.map((message) => ({ rule: message.ruleId, severity: message.severity, text: message.message }));
}

const rules = (messages) => [...new Set(messages.map((message) => message.rule))].sort();

const cleanView = `
import { useState } from "preact/hooks";
export function View({ title }: { readonly title: string }) {
  const [open, setOpen] = useState(false);
  return <section aria-label={title}><button type="button" onClick={() => setOpen(!open)}>{open ? "close" : "open"}</button></section>;
}
`;

test("lint parses JSX in a .tsx file and finds nothing wrong with a clean view", async () => {
  deepEqual(await lint("packages/editor-ui/src/view.tsx", cleanView), []);
});

test("lint applies the core guard-rails to a .tsx file (a Node built-in import)", async () => {
  const messages = await lint(
    "packages/core/src/view.tsx",
    `import { readFileSync } from "node:fs";\nexport const View = () => <p>{readFileSync.name}</p>;\n`,
  );
  deepEqual(rules(messages), ["no-restricted-imports"]);
});

test("lint applies the core guard-rails to a .tsx file (a DOM global)", async () => {
  const messages = await lint("packages/core/src/view.tsx", `export const View = () => <p>{document.title}</p>;\n`);
  deepEqual(rules(messages), ["no-restricted-globals"]);
});

// `packages/editor-ui` does not exist yet, and the rule classifies packages by their `package.json`, so an existing
// package stands in: the point is that the rule reads `.tsx`.
test("lint refuses a .tsx file that reaches a sibling package by a relative path", async () => {
  const messages = await lint(
    "packages/runner-web/src/view.tsx",
    `import { core } from "../../core/src/index.ts";\nexport const View = () => <p>{core}</p>;\n`,
  );
  deepEqual(rules(messages), ["guardrails/no-escaping-relative-import"]);
  equal(messages[0]?.severity, 2);
});

test("lint refuses inline suppression in a .tsx file", async () => {
  const messages = await lint(
    "packages/editor-ui/src/view.tsx",
    `// eslint-disable-next-line no-restricted-imports\nexport const View = () => <p>x</p>;\n`,
  );
  equal(rules(messages).includes("guardrails/no-unmarked-suppression"), true, JSON.stringify(messages));
});

// G2 rule 4 and the G2 enforcement section: `editor-ui` (and the `editor-model` it stands on) reach a host only through
// platform-services, so they import no host runtime and no `host-*` package. The dependency graph covers `@tk-reawakened/`
// edges; these modules are outside the workspace, so only lint can see them.
const hostImports = [
  ["electron", 'import { app } from "electron";\nexport const a = app;\n'],
  ["electron subpath", 'import { ipcMain } from "electron/main";\nexport const a = ipcMain;\n'],
  ["vscode", 'import * as vscode from "vscode";\nexport const a = vscode;\n'],
  ["@tauri-apps/api", 'import { invoke } from "@tauri-apps/api/core";\nexport const a = invoke;\n'],
  ["@tauri-apps/plugin", 'import { open } from "@tauri-apps/plugin-dialog";\nexport const a = open;\n'],
  ["@capacitor/core", 'import { Capacitor } from "@capacitor/core";\nexport const a = Capacitor;\n'],
  ["@capacitor/filesystem", 'import { Filesystem } from "@capacitor/filesystem";\nexport const a = Filesystem;\n'],
  ["a host-* package", 'import { host } from "@tk-reawakened/host-vscode";\nexport const a = host;\n'],
  ["a host-* subpath", 'import { host } from "@tk-reawakened/host-web/testing";\nexport const a = host;\n'],
  ["a type import", 'import type { Uri } from "vscode";\nexport type A = Uri;\n'],
  ["a re-export", 'export { app } from "electron";\n'],
  ["a dynamic import", 'export const load = () => import("electron");\n'],
];

for (const [path, label] of [
  ["packages/editor-ui/src/host.tsx", "editor-ui .tsx"],
  ["packages/editor-model/src/host.ts", "editor-model .ts"],
]) {
  test(`lint refuses a host runtime or a host-* package in ${label} (G2 rule 4)`, async () => {
    for (const [what, code] of hostImports) {
      const messages = await lint(path, code);
      equal(messages.length > 0, true, `${what} must be refused in ${path}`);
      for (const message of messages) {
        equal(message.severity, 2, `${what}: ${message.text}`);
        match(message.text, /G2/, `${what} names the guard-rail: ${message.text}`);
      }
    }
  });
}

test("lint refuses a host runtime in an editor-ui test file as well (the whole package is scoped)", async () => {
  const messages = await lint("packages/editor-ui/test/host.test.ts", hostImports[0][1]);
  deepEqual(rules(messages), ["no-restricted-imports"]);
});

test("lint lets a host package and the host runtimes alone: only editor-ui and editor-model are scoped", async () => {
  for (const path of ["packages/runner-web/src/host.ts", "packages/runner-desktop/src/host.ts"]) {
    deepEqual(await lint(path, hostImports[0][1]), [], path);
    deepEqual(await lint(path, hostImports[2][1]), [], path);
  }
});

test("lint accepts the editor's own allowed imports", async () => {
  deepEqual(
    await lint(
      "packages/editor-ui/src/ok.tsx",
      `import { useState } from "preact/hooks";\nimport type { MainDocument } from "@tk-reawakened/editor-model";\nimport type { PlatformServices } from "@tk-reawakened/platform-services";\nexport const V = (p: { readonly d: MainDocument; readonly s: PlatformServices }) => { const [x] = useState(p.d); return <p>{String(x)}</p>; };\n`,
    ),
    [],
  );
  deepEqual(
    await lint("packages/editor-model/src/ok.ts", `import { BinaryReader } from "@tk-reawakened/core";\nexport const a = BinaryReader;\n`),
    [],
  );
});
