# ADR 0027 — Git engine candidate inventory and conditional recommendation

* **Status:** Proposed (2026-11-12). Not approved by the owner. No code follows from it until it is accepted (issue #1829).
* **Date:** 2026-11-12
* **Context documents:** [0022](0022-shared-editor-authoring-contracts.md) D13 (Git is a capability), [0003](0003-permissive-licences-acceptable.md) as amended by [0034](0034-tiered-dependency-licence-policy.md), [guardrails](../guardrails.md) G6 (licence gate) and G7 (clean-room provenance), [0026](0026-editors-are-registered-by-document-kind.md).
* **Does not reopen:** ADR 0022 D13.1, D13.2, D13.4 and D13.5; the exclusion of push, pull, remotes and credentials; ADR 0003's direct-dependency threshold; or G7. Current G6 tiering is defined by ADR 0034.
* **Amends if accepted:** the wording of ADR 0022 D13.3, "the user's installed `git` in desktop". See Decision 3.

## In plain terms

ADR 0022 says the editor must show which game files changed, preview the change, and record a commit, and that it must work without Git. The previously recommended published Git package contains LGPL code despite its MIT package metadata and is blocked by G6. No engine is selected or implementation approved while this ADR is Proposed.

## Context

- ADR 0022 D13.3 defines the standalone surface: status of changed documents, diff preview, stage and commit, and a read-only log, behind a platform-services `scm` interface. It leaves the engine open and says the choice is gated by G6.
- G6 requires direct production dependencies to be rated Bronze or better on the Blue Oak list; known transitive dependencies may use licences outside that list if they permit our actual use and redistribution and are not copyleft or restricted. Copyleft, restricted, unknown, missing or unclassifiable licences are blocked at either tier.
- At the time of this inventory, the repository gate was `tools/licences/check.mjs`, run as `pnpm run licence`, with `minimumRating` set to Bronze and MS-PL blocked. That pre-amendment gate applied the rating to the whole tree. ADR 0034 requires the checker to distinguish direct from transitive dependencies. The evaluator handles AND, OR and parentheses but not SPDX `WITH` exceptions: `GPL-2.0-only WITH GCC-exception-2.0` is rejected as a malformed expression.

## Candidates

| Candidate | Where it runs | Licence | G6 result |
|---|---|---|---|
| isomorphic-git 1.44.13, with `@isomorphic-git/lightning-fs` 4.10.5 and `diff` 8.0.2 | Browser/desktop candidate; adapter and runtime claims unverified | Package metadata: MIT, MIT, BSD-3-Clause | **Blocked:** published isomorphic-git includes LGPL-3.0-or-later code (finding 3). Metadata alone was a false pass |
| simple-git 4.0.2 | Desktop only; drives a `git` binary the user has installed | MIT (direct package) | Direct package metadata passes; transitive closure is not inventoried, so candidate G6 status is unverified. Not usable in the browser |
| nodegit 0.27.0 | Desktop, native | MIT (wrapper) | Fails on its libgit2 component (finding 1) |
| wasm-git 0.0.17 | Browser, WebAssembly build of libgit2 | None declared | Blocked: licence unknown (finding 2) |

**Finding 1, libgit2.** libgit2's `COPYING` declares GPL-2.0 with a linking exception. G6 rule 2 blocks GPL-2.0 by name, and the gate cannot model the exception. A libgit2-based engine therefore needs an ADR exception, and this ADR does not propose one. This reads the licence file for policy purposes. It is not a legal opinion.

**Finding 2, wasm-git.** The npm package has no `license` field. Its README has no licence statement. GitHub reports the repository licence as `NOASSERTION`. Its build wraps libgit2, so finding 1 applies as well. G6 rule 2 blocks unknown licences.

**Finding 3, embedded LGPL.** The published isomorphic-git 1.44.13 package's [path join implementation](https://github.com/isomorphic-git/isomorphic-git/blob/v1.44.13/src/utils/join.js) identifies code copied from `@zenfs/core/path` as `LGPL-3.0-or-later`; it also appears in the published root bundles. The package-level MIT declaration does not make that separately licensed code eligible. The previous metadata-only inventory reported a false pass ([#2867](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2867)). No tree-shaking or notice removal changes its licence.

An independently evaluated source derivative replacing the entire ineligible module with the [earlier MIT re-export](https://github.com/isomorphic-git/isomorphic-git/blob/ee6c7f5fb9ed65ce6daaf77ff6977a934a9bc1e8/src/utils/join.js) is a possible candidate, not an accepted dependency. Its actual source, complete notices, browser and desktop operation, safety, and host integration must pass their gates before selection.

## Licence inventory

The reproducible fixture pins the direct dependencies in `tools/licences/fixtures/git-engine/package.json`; `package-lock.json` resolves its npm dependency closure. The inventory records package metadata and discovered licence files. Package metadata and a clean root licence file alone do **not** establish the licence of embedded code; the published bundles must also be examined, and incomplete evidence is not a G6 pass.

Reproduce from the repository root with the pinned fixture lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix tools/licences/fixtures/git-engine
node tools/licences/inventory-git-engine.mjs --check
```

`--check` compares the generated inventory with the committed result without
rewriting it and exits nonzero if any identified licence fails. For this pinned
fixture it is expected to fail: the ESM and CommonJS root bundles both identify
the LGPL component. The scanner examines explicit SPDX identifiers in root
`index.js` and `index.cjs` only; a clean result is not a complete licence audit.
Run `node tools/licences/inventory-git-engine.mjs --write` separately only when
intentionally regenerating the committed inventory.

The committed [`inventory.json`](../findings/git-engine-g6-inventory/inventory.json) records 53 locked package entries and two identified failures, one for each published isomorphic-git root bundle. Its previous zero-failure result described package metadata, not the actual bundled-component licence; finding 3 disproves the candidate-level pass. Three entries have no discovered root licence file (`clean-git-ref@2.0.1`, `diff3@0.0.3`, and `minimisted@2.0.1`); their declared terms and actual embedded notices must be documented accurately.

Direct-package evidence:

| Package | Locked version | Declared SPDX | Licence-file evidence | G6 |
|---|---|---|---|---|
| isomorphic-git | 1.44.13 | MIT | `LICENSE.md`, SHA-256 `b916888fb16893c3a1df138543f994b96bb6892d74b6777c3a080d9cd2520c48`; published bundle includes LGPL code | **fail** |
| @isomorphic-git/lightning-fs | 4.10.5 | MIT | `LICENSE`, SHA-256 `df563bf6740c35bef4afefe212b1227499bddd83c39283bbe8a07b4d89c17cf1` | pass |
| diff | 8.0.2 | BSD-3-Clause | `LICENSE`, SHA-256 `eda81a415869e67809f6a9f3fd6056062cb83a462118e07eec5e92b2e0c40ce9` | pass |

## Decision (proposed)

1. **No published isomorphic-git candidate is approved.** The pinned 1.44.13 package fails G6 (finding 3). Any replacement must first establish actual licence and notice closure and demonstrate D13.3 status, stage, commit, read-only log and text-diff preview, plus D13.4 binary preview, using the target desktop and browser adapters. Until those gates pass and this ADR is accepted, no engine is selected and no implementation is approved.
2. **No libgit2-based engine** (`nodegit`, `wasm-git`). Choosing one would need an ADR exception for GPL-2.0 with a linking exception, or a verified licence for `wasm-git`. Neither is proposed here.
3. **Desktop may use the same engine, reading the working tree through Node's filesystem.** This would change the wording of ADR 0022 D13.3. The alternative is simple-git, which is MIT as a direct package and needs the user's `git`; its dependency closure has not been inventoried. An owner decision and the spike are still required. The recommendation remains one engine on both hosts, subject to those gates.
4. **Scope is unchanged.** Push, pull, remotes and credentials stay out of scope (ADR 0022 D13.3).

## Consequences

- If accepted, browser and desktop would share one code path and the desktop would not need a `git` binary.
- An accepted implementation would still provide only a subset of Git; repositories that depend on unsupported features would not work.
- Performance on large binary game repositories is unmeasured. The spike must verify the D13.4 binary-preview behavior and measure relevant repository performance before acceptance.
- Fixture closure: 53 packages. The actual production dependency delta is deferred to the implementation lockfile; every version bump must pass the G6 gate in CI.

## Owed before acceptance

Stated as unverified in this ADR:

1. A spike that exercises status, stage, commit and read-only log on a fixture repository in Node and through the lightning-fs browser adapter, and separately verifies D13.3 text-diff preview and D13.4 binary preview.
2. Confirmation of isomorphic-git's browser support from its own documentation. It has not been read in this session.
3. Owner confirmation of decision 3 and of the resulting D13.3 wording change.
4. Owner decision on whether `wasm-git`'s licence should be pursued. Not needed for the proposed option.
5. `pnpm run licence` in the implementation PR that adds the dependencies.
