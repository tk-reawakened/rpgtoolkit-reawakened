# CodeGraph navigation (issue #620)

CodeGraph 1.6.2 (MIT) is an optional, globally installed development tool,
configured using its [README](https://github.com/colbymchenry/codegraph).
No workspace dependency or lockfile changes. From the repository root:

```sh
npm install -g @colbymchenry/codegraph@1.6.2
codegraph init packages --yes
codegraph status packages
codegraph sync packages              # refresh after source changes
codegraph explore --path packages "createEngine surfacePixels"
```

The ignored SQLite index lives at **`packages/.codegraph/codegraph.db`**.
Never initialize at the repository root. This snapshot indexes 482 TypeScript
files, 10,899 nodes and 43,400 edges (36.90 MB); an inventory audit found no paths
outside `packages/`. Two barrel files (`core/src/index.ts`,
`core/src/ports/index.ts`) produced parser warnings/no symbols, limiting coverage.
The project-local `.codex/config.toml` starts `codegraph serve --mcp --path packages`;
launch Codex from the repository root and trust the checkout's local configuration.
Other MCP clients should pass this checkout's absolute `packages/` path.

Six actual Codex CLI agent sessions answered these paired navigation questions:

| Question | Tool calls without / with | Actual total tokens without / with |
|---|---:|---:|
| Inventory add/equip/unequip → owners, stats and queued events | 12 / 9 | 475,856 / 433,896 |
| Script mediaPlay → beforePlay versus engine music | 6 / 5 | 285,207 / 271,427 |
| Booted board → composition, rasterization and surfacePixels revisions | 5 / 6 | 231,090 / 315,568 |

Each fresh, ephemeral read-only session used Codex 0.163.0-alpha.11.2 with its
default model (no override; JSONL does not identify the model), identical questions
and a 350-word answer cap. Controls disabled MCP and used `rg`/source reads;
indexed sessions called `codegraph_explore` once, then verified source. A tool
call means one completed MCP or shell invocation, including batched shell reads.
Totals are actual `turn.completed.usage` input + output tokens across the whole
agent turn; cached input is already included, never added twice. Exact questions,
arm order, input/cached/output counts and timings are in the
[measurement record](findings/codegraph-navigation-benchmark.json).

These single samples show mixed results, not established savings. Pairs ran
concurrently; caches and host skill/context-loading warnings limit comparability.
Answers traced the requested owners/phases and named relevant tests; no automated
correctness score was assigned. Textual “exclude path” queries pinned unwanted
runtime-parser source in two indexed runs: natural-language exclusions are not
access controls. That returned source was not used for the grammar ADR. Claude
quota failures and zero-token CLI configuration failures were excluded.

**No RPGCode support:** this index does not parse `.rnc`/`.prg`. The independent
[grammar proposal](adr/0011-tree-sitter-rpgcode.md) derives only from `docs/spec/`.
CodeGraph 1.6.2 is still the latest release (2026-10-03) and takes a new language
only by contribution — a vendored grammar `.wasm` plus a per-language extractor
in its repository — not through `codegraph.json`, which maps an extension onto a
language it already ships. The route, its two stages and its cost are recorded in
the [registration prerequisite](../_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-grammar/discovery/codegraph-registration-prerequisite.md);
no adapter of ours is planned. The `lib/dist/…` paths cited below are the
installed package's build of the repository's `src/…`.
