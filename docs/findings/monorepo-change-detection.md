# Knowing which packages a change affects

Findings for issue [#668](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/668) (Epic 23,
ticket 23.4). Two later consumers are assumed: the smart-gates `changes` job
([#664](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/664)) and package publishing
in Epic 10 ([#666](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/666)).

**This is a comparison and a recommendation, not a decision to implement.** Nothing here is
built: no workflow, config or dependency in this change.

**Recommendation in one line.** *Go* on a zero-dependency `changes` job — `git diff --name-only`
against the merge base, mapped through a small checked-in path table seeded from
`tools/deps/edges.json` — and *no-go* on adopting Turborepo, Nx or Lerna now. The workspace has
five real packages, no published artifacts, and a build (`tsc -b`) that is already incremental, so
a task runner would add a second package graph and a second cache without removing work.

## 1. What the repository already has

| Fact | Where |
|---|---|
| pnpm 12.10.1 workspace, five packages: `core`, `synth`, `plugin-tk2-compat`, `runner-harness`, `runner-headless`; all `private`, all `0.0.0`. | `package.json`, `pnpm-workspace.yaml` |
| `packages/core` alone is 262 source files / 64,725 lines; the other four are 40 files / 8,004 lines. | `packages/*/src` |
| 182 test files / 64,223 lines, sharded into eight named groups by `tools/no-skips/run.mjs`. | `tools/no-skips/run.mjs`, CI `unit` matrix |
| One CI workflow with jobs `checks`, `unit` (8 shards), `golden`, `golden-bun`, and a `gate` that merges shard LCOV and enforces the coverage floor. No job currently filters on the changed paths. | `.github/workflows/ci.yml` |
| The build is `tsc -b` with project references, so unchanged packages are not recompiled; a task runner would not make the compiler do less. | `tsconfig.base.json`, `packages/*/tsconfig.json` |
| `tools/deps/edges.json` is the single checked-in edge list (16 package names, including the 11 not yet created) and generates both the dependency-cruiser rules and the architecture diagram (AD-22). It records **permitted** edges, not actual `package.json` dependencies. | `tools/deps/edges.json`, `docs`/architecture spine |
| Inputs that are not packages at all: `fixtures/legacy` (fetched, hashed by `tools/fixtures/sources.json`), `golden/`, `stock/*.prg`, `docs/spec/examples`, `tools/**`. A change to any of these invalidates jobs without touching a package directory. | `tools/fixtures/*`, `golden/`, `stock/`, `docs/spec/examples` |
| Nothing is published; Epic 10 has not shipped, and no package has a changelog or version bump path. | `packages/*/package.json`, `CHANGELOG.md` |

## 2. The two questions, kept separate

1. **CI selection** — given a diff, which of the existing jobs must run?
2. **Release accounting** — once packages publish, which versions bump and which changelogs change?

They share a package graph but almost nothing else. The first is a correctness question with a
cheap answer; the second is a workflow question that only becomes real at Epic 10. Turborepo and
pnpm solve (1); Nx and Lerna solve both.

## 3. The options

**pnpm filters (already installed).** `pnpm --filter "...[origin/main]"` selects changed packages
plus their dependents. Since pnpm 12.7 the `[<since>]` selector compares against the merge base, so
commits landed on `main` after the fork are not counted; uncommitted work still is. It needs Git
2.24+, and it knows only the `package.json` graph: `--test-pattern` and
`--changed-files-ignore-pattern` narrow the result but cannot express "a `golden/` change needs the
golden job". Licence MIT, no new dependency, no config file.

**Turborepo 2.11.10 (2026-10-20, MIT, Rust binary).** A task graph plus local and remote cache.
`turbo run test --affected` is shorthand for `--filter=...[main...HEAD]`; per-task `inputs` globs
can include `golden/**` or `fixtures/**`, which is the one feature none of the pnpm filters have.
Costs: a `turbo.json` task table, a second graph source derived from `package.json`, a `.turbo`
cache to manage, and a binary whose hashes must be trusted in CI. Its cache only pays where a task
has declared outputs worth replaying; here the expensive job is `node --test`, whose only output is
LCOV, and its inputs are the whole of `core` for six of the eight shards.

**Nx 24.0 (2026-10-21, MIT).** The same affected model at task granularity (Nx 24 made `nx affected`
task-based; Nx 23 and earlier were project-based), plus `nx release` for versioning and changelogs,
generators and a daemon. It is the strongest single answer to both questions in §2, and by far the
largest configuration surface for a five-package tree: `nx.json`, per-project `project.json` or
inferred targets, named inputs, and an Nx project graph that would sit beside `edges.json`.

**Lerna 10.1.1 (2026-10-12, MIT).** Now a thin version/publish layer over Nx (it depends on `nx`),
useful almost exclusively for the second question. Adopting it alone still pulls Nx in.

**The in-repo graph tool.** `tools/deps/edges.json` plus `tools/deps/graph.mjs` already generates
the dependency-cruiser rules and the diagram and runs as a CI gate. It answers "is this edge legal",
not "what does this diff touch": it has no hashing, no cache and no changed-file logic, and its 16
entries are allowed edges, several for packages that do not exist yet.

## 4. Comparison

| | pnpm `[since]` filters | Turborepo 2.11.10 | Nx 24.0 | Lerna 10.1.1 | `edges.json` tool |
|---|---|---|---|---|---|
| Changed-package selection | yes (merge base since 12.7) | yes, task-level via inputs | yes, task-level | via Nx | no |
| Non-package inputs (`golden/`, `fixtures/`, `stock/`) | only ignore globs | yes, `inputs` globs | yes, named inputs | via Nx | no |
| Build/test cache | no | local + remote | local + remote | via Nx | no |
| Versioning and changelogs | no | no | `nx release` | `lerna version` | no |
| New dependency in the tree | none | `turbo` | `nx` (+plugins) | `lerna` + `nx` | already present |
| New config surface | none | `turbo.json` | `nx.json` + targets | `lerna.json` | `edges.json` |
| Second package graph beside AD-22's edge list | no | yes | yes | yes | — |
| Licence | MIT (pnpm) | MIT | MIT | MIT | in-repo |
| Fit at 5 private packages, no publish | good | over-specified | over-specified | premature | n/a (wrong job) |

Every licence is MIT or in-repo, so licence is not the differentiator; scope and duplicate truth are.

## 5. Why the recommendation

- **The expensive work is not per-package.** `unit` shards partition *test files*, and six of the
  eight read the whole of `core`. A change to `core` almost always selects most shards anyway; what
  a path table buys is skipping `golden`, `golden-bun` and irrelevant shards for docs-, tool- and
  fixture-only changes — exactly what #664's allowlist is for.
- **`tsc -b` already avoids the work a task runner would cache.** There are no emitted bundles to
  replay; the `unit` jobs spend their time spawning `node --test`, which no cache can shortcut when
  the input is the whole package.
- **A second graph is a real cost.** AD-22 makes `tools/deps/edges.json` the single edge list; a
  task runner derives a different graph from `package.json` (which knows nothing of the 11 planned
  packages, and permits edges the list forbids). That divergence would need a test to police it,
  which is more code than the affected-detection it replaces. The measured run above shows it
  directly: `...[origin/main]` adds the workspace root but not `runner-harness` or
  `runner-headless`, because `edges.json` permits `synth → runner-*` while no `package.json`
  declares it.
- **Publishing is not here yet.** Version bumps and changelogs are the only part of #668 that needs
  a tool, and they are meaningless until Epic 10 creates the first published package.

An implementation (not this ticket) is a `changes` job that computes
`git diff --name-only "$(git merge-base origin/main HEAD)" HEAD`, joins it to a path table with
five rows — docs/spec, tools+fixtures+golden, stock, `packages/<name>` (expanded through the real
`package.json` dependency closure), root config — and exports booleans the other jobs `needs`. It
can ask pnpm for the package half, so no graph is duplicated by hand:

```sh
pnpm --filter "{packages/*}[origin/main]" list --depth -1 --json
```

Measured on 2026-10-30 at `origin/main` `e630c083`: with a one-line edit under `packages/synth/src`
this returns `@tk-reawakened/synth` and nothing else; with no package change it returns `[]`. The
brace form is required — `./packages/*[origin/main]` silently returns `[]` — and `...[origin/main]`
adds the workspace root, so the root selector is excluded rather than filtered later.

## 6. Go / no-go

| Question | Verdict |
|---|---|
| Build a path-table `changes` job now | **Go** — implementation ticket, not this one |
| Use `pnpm --filter "...[origin/main]"` as its package half | **Go** — no new dependency |
| Adopt Turborepo now | **No-go** — revisit per §7 |
| Adopt Nx now | **No-go** — revisit at Epic 10 |
| Adopt Lerna now | **No-go** — same trigger as Nx |

## 7. What would change the decision

Any one of these reopens the comparison:

1. Epic 10 publishes a package, so a version bump and changelog must be produced per release
   (then compare `nx release`, `lerna version` and Changesets, in that order).
2. A task with real declared outputs (bundling, type declarations shipped, docs build) enters CI,
   giving a remote cache something to replay.
3. Eight or more real packages with narrow test shards, where per-package selection stops
   over-selecting.
4. CI wall time on a one-file PR exceeding roughly ten minutes after the path table lands.

## 8. Sources

- pnpm filtering reference (selectors, `[<since>]` merge-base behaviour since 12.7, `--test-pattern`,
  `--changed-files-ignore-pattern`), <https://pnpm.io/filtering>, read 2026-10-30; repository uses
  pnpm 12.10.1.
- Turborepo `run` reference (`--affected`, `--filter`, `inputs`, cache flags, shallow-checkout
  caveat), <https://turborepo.dev/docs/reference/run>, last updated 2026-10-27; latest release
  v2.11.10 on 2026-10-20.
- Nx affected guide (task-based selection in Nx 24, `NX_BASE`/`NX_HEAD`, `nx-set-shas`),
  <https://nx.dev/ci/features/affected>, read 2026-10-30; latest `nx` 24.0.3 on 2026-10-30, MIT.
- Lerna release history and its `nx` dependency, <https://github.com/lerna/lerna>, npm metadata for
  `lerna@10.1.1` (2026-10-12), MIT.
- Repository facts read from `package.json`, `pnpm-workspace.yaml`, `tools/deps/edges.json`,
  `tools/no-skips/run.mjs`, `.github/workflows/ci.yml` at `origin/main` on 2026-10-30.
