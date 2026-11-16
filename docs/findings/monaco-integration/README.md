# Monaco integration evidence (story 11.7, #1705)

Measured 2026-11-14 on macOS arm64, Node 26.13.0, Chromium from Playwright 1.64.0. Policy: [ADR 0029](../../adr/0029-monaco-csp-style-src.md); licence tier: [ADR 0034](../../adr/0034-tiered-dependency-licence-policy.md); contract: [TOOL-10](../../spec/engine/rpgcode-tooling.md#tool-10).

## What ships

- `monaco-editor` **0.57.0**, pinned exactly in `packages/editor-ui/package.json`, imported as ESM and bundled by `tools/browser/build.mjs`. The `editor.main` entry is **not** used: it registers about eighty languages and the TypeScript/CSS/HTML/JSON services. `packages/editor-ui/src/monaco-features.ts` lists the editor contribution modules used instead.
- Emitted next to `tools/browser/editor-web/index.html`: `editor-web.js` (page, unminified, ~9.8 MB with the editor), `editor-web.css` (~190 KB), `codicon.ttf` (153,228 B), `monaco-editor.worker.js` (~640 KB, classic same-origin worker), `language-worker.js` (~2.1 MB, the RPGCode language server).
- No `eval`/`new Function` call in any bundle (the only hit is a class named `FunctionDisposable`); no WebAssembly.

## Licence inventory

| Item | Licence | How shipped |
|---|---|---|
| monaco-editor 0.57.0 (and the vscode code it vendors, Node `path` copy) | MIT | direct dependency, Blue Oak Gold |
| marked 14.0.0 | MIT | transitive |
| dompurify 3.4.17 (overridden from the 3.4.15 monaco-editor pins, for advisory GHSA-c6gr-qvv4-5v3f) | MPL-2.0 OR Apache-2.0 | transitive, used under Apache-2.0 |
| `codicon.ttf` | CC-BY-4.0 (vscode-codicons `LICENSE`; the font file carries no licence metadata, its name table only says "Version 1.15", fontello.com) | file inside the direct dependency, ADR 0034 decision 2 |

All four are in `THIRD_PARTY_NOTICES` with texts. `tools/licences/config.json` `bundledAssets.dependencyAssets` pins the codicon file by SHA-256 (`77f90255…38da`); `pnpm run licence` fails if it changes, if another font appears in the package, or if the notice lacks its name, hash and licence. TypeScript, W3C HTML draft, js-beautify, Ionic and vscode-swift material listed in Monaco's `ThirdPartyNotices.txt` belongs to language features that are not bundled.

## Worker, CSP and offline proof

`tools/browser/tests/editor-program.spec.ts` runs the real page under `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self'`: zero `securitypolicyviolation` events, zero requests outside the page's origin (every other origin is aborted by the test), no `blob:` worker, both workers loaded as same-origin classic scripts (the Monaco editor worker is created by Format Document, which uses it for minimal edits), no Monaco console warning about falling back to the main thread. A negative control serves the page with `style-src 'self'` and the probe reports `style-src-attr` violations, so the probe can fail.

## Known limits

- VS Code colours the semantic classes with the author's theme; the `rpgToolkit.syntax.*` preferences are applied to Monaco only.
- VS Code may normalise a file with mixed line endings to its dominant ending when an edited file is saved; preserving each original ending is not required there (owner ruling in [TOOL-10](../../spec/engine/rpgcode-tooling.md#tool-10)). The standalone document keeps each ending.
- Go to definition in Monaco shows only targets in the open program; another program is opened from the project tree.
