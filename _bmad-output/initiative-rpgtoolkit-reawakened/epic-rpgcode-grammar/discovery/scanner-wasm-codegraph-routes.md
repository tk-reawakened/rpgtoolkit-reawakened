---
type: discovery
title: "Scanner, Wasm and CodeGraph routes (epic 22, entry 22.2)"
date: 2026-10-30
baseline_revision: 2ea1768e5081ab3ce80e2f5f55f9d7c4bd54c4c3
issue: "#626"
---

# Scanner, Wasm and CodeGraph routes

Entry 22.2 proves the toolchain route before any RPGCode grammar work (22.3 onward) or any claim that a Wasm
artifact can be loaded by CodeGraph. Everything below was executed on the baseline revision on macOS arm64; the
disposable smoke grammar lives outside the repository and **nothing from it is committed**. No dependency was
added to `core`, `editor-ui` or any workspace package, and no VM, state, save, hash, golden or ledger file changed.

Independence (G7, ADR 0011): the smoke grammar is a toy newline/continuation language written for this proof. It
derives from no spec page, no sample game, no `packages/core/src/script/parse.ts` and no legacy source.

## F-01 — Recorded versions and licences

| Tool | Version | Licence | Role in the route |
|---|---|---|---|
| tree-sitter CLI | 0.25.10 (`tree-sitter-cli`, npm) | MIT | `generate`, native build, `build --wasm` |
| Grammar ABI emitted | `LANGUAGE_VERSION 15` with a `tree-sitter.json`; **14** when the file is absent (the CLI warns: “No `tree-sitter.json` file found … required to generate with ABI 15. Using ABI version 14 instead”) | — | artifact contract; a manifest is mandatory to pin 15 |
| C compiler (native) | Apple clang 21.0.0 (clang-2100.3.34.2) | Xcode system tool | native smoke build |
| C→Wasm compiler | Emscripten 6.0.13 (`brew install emscripten`) | Apache-2.0 AND (Apache-2.0 WITH LLVM-exception) AND (MIT OR NCSA) | `tree-sitter build --wasm` |
| web-tree-sitter (loader, proof) | 0.27.1 (npm) | MIT | Node and headless-Chromium loading |
| web-tree-sitter (inside CodeGraph) | 0.25.10 | MIT | the runtime CodeGraph 1.6.2 actually parses with |
| tree-sitter-wasms (inside CodeGraph) | 0.1.13 | Unlicense | CodeGraph's 36 prebuilt grammars; dev tool only, never shipped by us |
| CodeGraph | 1.6.2 + `@colbymchenry/codegraph-darwin-arm64` 1.6.2 | MIT | target consumer, already documented in `docs/codegraph.md` |
| Node | 26.13.0 | — | smoke runs |
| Chromium (headless, agent browser) | as installed for this session | — | browser Wasm proof |

G6: every build-time tool above is permissive (MIT, Apache-2.0 with LLVM exception, MIT/NCSA, Unlicense). None is
a runtime dependency of any shipped package, and no lockfile in this repository changed. The CLI, Emscripten and
the loaders were installed outside the checkout solely to produce the evidence below.

## F-02 — The external-scanner smoke case works natively

Grammar: one statement rule (`name` then a line end) whose `_end` is an external token, so the scanner must decide
whether `_` before a newline continues the line. Scanner state is one boolean, serialized to and from one byte.

```sh
tree-sitter generate                      # -> src/parser.c, src/scanner.c, ABI 15 (tree-sitter.json present)
tree-sitter build                         # -> parser.dylib
tree-sitter parse sample.tsmoke
```

```text
(source_file [0, 0] - [3, 0]
  (statement [0, 0] - [1, 0]
    (name [0, 0] - [0, 5])
    (continuation [0, 5] - [1, 0]))
  (statement [1, 0] - [2, 0]
    (name [1, 0] - [1, 6]))
  (statement [2, 0] - [3, 0]
    (name [2, 0] - [2, 5])
    (continuation [2, 5] - [3, 0])))
```

The `continuation` nodes exist only because the C scanner returned `true` for them, so the native route exercises
the scanner, not just generated rules.

## F-03 — The same grammar builds to Wasm and loads in a browser

```sh
tree-sitter build --wasm                 # 3.0 s -> tree-sitter-tkr_scan_smoke.wasm, 1,935 bytes
node load-wasm.mjs                       # web-tree-sitter 0.27.1, Node 26
```

```text
abi: 15
(source_file (statement (name) (continuation)) (statement (name)) (statement (name) (continuation)))
statement 0 7 name@0-5,continuation@5-7
statement 7 14 name@7-13
statement 14 21 name@14-19,continuation@19-21
```

The same 1,935-byte artifact, served over `http://127.0.0.1:8817/`, loaded in a headless Chromium tab with
`web-tree-sitter.js` and its runtime wasm:

```json
{"ok":true,"abi":15,"sexp":"(source_file (statement (name) (continuation)) (statement (name)) (statement (name) (continuation)))","bytes":1935}
```

Offset representation: node offsets are UTF-8 **byte** ranges (`0-7`, `7-14`, `14-21`). The smoke source is ASCII,
so byte and UTF-16 indices coincide here; the editor's UTF-16 mapping over non-ASCII source is production work for
22.3/22.9 and is not claimed by this entry.

## F-04 — The artifact is compatible with CodeGraph's own runtime

The ABI-15 artifact also loads under **web-tree-sitter 0.25.10**, the runtime bundled in CodeGraph 1.6.2, and
produces the identical tree:

```text
loaded under web-tree-sitter 0.25.10: (source_file (statement (name) (continuation)) (statement (name)) (statement (name) (continuation)))
```

So artifact loading and ABI compatibility are **not** the blocker. Registration and extraction are.

## F-05 — CodeGraph 1.6.2 cannot register a third-party grammar

Evidence from the installed package (`@colbymchenry/codegraph-darwin-arm64` 1.6.2, `lib/dist/`):

| Fact | Evidence |
|---|---|
| Grammars are Wasm, loaded through `web-tree-sitter` from a **fixed filename map** | `extraction/grammars.js:71-74` (“maps each language to its .wasm grammar file”), `:111` (`EXTENSION_MAP`), `:522` (`Language.load(bytes ?? resolveWasmPath(lang))`) |
| A grammar path can only be vendored-ours or a `tree-sitter-wasms` package member | `extraction/grammars.js:452-456` — `path.join(__dirname, 'wasm', wasmFile)` for `VENDORED_WASM_LANGS`, else `require.resolve('tree-sitter-wasms/out/<file>')`. There is no config, env var or API that adds a file |
| The language set is closed | `extraction/grammars.js:761` `isLanguageSupported`; the `Language` union in `extraction/grammars.d.ts`; one extractor module per language under `extraction/languages/` |
| Project config maps a **custom extension onto a supported language**, nothing more | `project-config.js:50-56` (“one of CodeGraph's supported languages… otherwise hardcoded”), validated at `:169` with `isLanguageSupported` |

Empirical probe in a throwaway project (`.prg` and `.rnc` files plus `codegraph.json`):

```json
{"extensions":{".prg":"typescript",".rnc":"rpgcode"}}
```

```text
[CodeGraph] Ignoring extension ".rnc" in codegraph.json: "rpgcode" is not a supported language { file: '/private/tmp/cg-probe/codegraph.json' }
◆  Indexed 1 files
●  1 nodes, 0 edges in 618ms
▲  start.prg: parse produced no symbols (tree has errors) — the file is indexed but contributes nothing to the graph
```

Two failure modes recorded: an unknown language name is skipped with a located warning, and re-pointing `.prg` at
TypeScript indexes the file but yields no symbols. Mapping RPGCode to TypeScript is therefore not a route (it is
also what ADR 0011 forbids).

## F-06 — Blocker, upstream/local follow-up and exit criteria

**B-01 (blocker, not ours to clear):** CodeGraph 1.6.2 has no supported seam for a third-party grammar and
extractor. A Wasm artifact alone cannot make `codegraph` understand `.rnc`/`.prg`.

Options recorded for review, none of them implemented here:

1. **Upstream change** — a feature request that lets `codegraph.json` name a grammar Wasm file and an extractor
   (or a query-driven generic extractor). Exit criteria: a released CodeGraph version indexes a spec-authored
   `.rnc` fixture from entry 22.8's artifact and returns named function, class and call nodes through
   `codegraph explore`, with an edited file re-indexing incrementally.
2. **Separately maintained adapter** — our own package reads the tree from the artifact and writes a compatible
   graph increment. Exit criteria: the adapter answers the same three navigation questions the benchmark in
   `docs/codegraph.md` used, from the artifact, and cannot import `core` or the runtime parser.
3. **No CodeGraph integration** — keep the index TypeScript-only and deliver RPGCode navigation through
   `editor-ui` alone. Exit criteria: ADR 0011's CodeGraph paragraph is amended to say so.

Owner: entry **22.10** (CodeGraph integration) with the Epic 22 reviewer; this entry assigns no person. Options 1
and 3 need no editor work and must not hold 22.3 onward.

## F-07 — Chosen package location, artifact ownership and handoffs (for review, no code)

| Question | Proposal |
|---|---|
| Package location | `packages/grammar-rpgcode/` — outside `core`, which gains no dependency and never imports it (G2 edge: `grammar-rpgcode ← editor-ui`, and → the CodeGraph adapter if option 2 is chosen) |
| Artifact ownership | the package owns `tree-sitter-rpgcode.wasm` and its `tree-sitter.json` (which pins ABI 15); the grammar version bumps with the artifact, starting at `0.x` until entry 22.8 |
| Build tooling | `tree-sitter-cli` and Emscripten are dev-only dependencies of that package (MIT and Apache-2.0 respectively); nothing is added to the player path, `core`'s allowlist or the runner bundles |
| Handoff to the editor | `editor-ui` receives the Wasm bytes through platform services, as it receives every other asset (G2); it never reads files |
| Handoff to CodeGraph | blocked by B-01; if option 2 is chosen, the adapter consumes the same package's queries and adds no new grammar |
| Version pinning | the CLI version and the emitted ABI are recorded in the package and checked in CI when 22.3 lands; this entry changes no CI |

## Not claimed, not done

- No RPGCode grammar, scanner, query or corpus exists yet; 22.3 onward owns them.
- No `.wasm` artifact, grammar package, dependency or CI job is added by this entry.
- No incremental-parse parity, error-recovery or scanner-serialization guarantee is claimed for RPGCode: only the
  smoke scanner's one-byte state was serialized and restored on the paths above.
- No CodeGraph integration is claimed or attempted; `docs/codegraph.md`'s “no RPGCode support” statement stands.
- Emscripten was installed on this machine with Homebrew and the npm packages live under `/tmp`; the repository,
  its lockfiles and its dependency allowlists are byte-identical to the baseline.
