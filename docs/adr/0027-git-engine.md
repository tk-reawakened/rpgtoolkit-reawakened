# ADR 0027 — Git engine candidate inventory and conditional recommendation

* **Status:** Proposed (2026-11-12). Not approved by the owner. No code follows from it until it is accepted (issue #1829).
* **Date:** 2026-11-12
* **Context documents:** [0022](0022-shared-editor-authoring-contracts.md) D13 (Git is a capability), [0003](0003-permissive-licences-acceptable.md) (permissive licences), [guardrails](../guardrails.md) G6 (licence gate) and G7 (clean-room provenance), [0026](0026-editors-are-registered-by-document-kind.md).
* **Does not reopen:** ADR 0022 D13.1, D13.2, D13.4 and D13.5; the exclusion of push, pull, remotes and credentials; ADR 0003; the text of G6 and G7.
* **Amends if accepted:** the wording of ADR 0022 D13.3, "the user's installed `git` in desktop". See Decision 3.

## In plain terms

ADR 0022 says the editor must show which game files changed, preview the change, and record a commit, and that it must work without Git. This ADR records a reproducible G6 inventory for one candidate; functional fit remains unverified, so no engine is selected or implementation approved while this ADR is Proposed.

## Context

- ADR 0022 D13.3 defines the standalone surface: status of changed documents, diff preview, stage and commit, and a read-only log, behind a platform-services `scm` interface. It leaves the engine open and says the choice is gated by G6.
- G6 rule 1 requires every shipped dependency to be rated Bronze or better on the Blue Oak list. Rule 2 blocks copyleft of any strength, including GPL, and any licence that is unknown or unlisted. A blocked licence needs an ADR exception.
- The repository gate is `tools/licences/check.mjs`, run as `pnpm run licence`. Its policy in `tools/licences/config.json` sets `minimumRating` to Bronze and blocks MS-PL. It evaluates AND, OR and parentheses. It does not evaluate SPDX `WITH` exceptions: `GPL-2.0-only WITH GCC-exception-2.0` is rejected as a malformed expression.

## Candidates

| Candidate | Where it runs | Licence | G6 result |
|---|---|---|---|
| isomorphic-git 1.44.13, with `@isomorphic-git/lightning-fs` 4.10.5 for browser storage and `diff` 8.0.2 for text diff | Browser/desktop candidate; adapter and runtime claims unverified | MIT, MIT, BSD-3-Clause | The pinned 53-package closure passes G6 (inventory below); functional fit unverified |
| simple-git 4.0.2 | Desktop only; drives a `git` binary the user has installed | MIT (direct package) | Direct package metadata passes; transitive closure is not inventoried, so candidate G6 status is unverified. Not usable in the browser |
| nodegit 0.27.0 | Desktop, native | MIT (wrapper) | Fails on its libgit2 component (finding 1) |
| wasm-git 0.0.17 | Browser, WebAssembly build of libgit2 | None declared | Blocked: licence unknown (finding 2) |

**Finding 1, libgit2.** libgit2's `COPYING` declares GPL-2.0 with a linking exception. G6 rule 2 blocks GPL-2.0 by name, and the gate cannot model the exception. A libgit2-based engine therefore needs an ADR exception, and this ADR does not propose one. This reads the licence file for policy purposes. It is not a legal opinion.

**Finding 2, wasm-git.** The npm package has no `license` field. Its README has no licence statement. GitHub reports the repository licence as `NOASSERTION`. Its build wraps libgit2, so finding 1 applies as well. G6 rule 2 blocks unknown licences.

## Licence inventory

The reproducible fixture pins the direct dependencies in `tools/licences/fixtures/git-engine/package.json`; `package-lock.json` resolves the complete npm dependency closure. `tools/licences/inventory-git-engine.mjs` checks manifest/lock agreement and installed package versions and SPDX metadata, then records each exact package ID, version, resolved tarball URL, integrity hash, SPDX expression, Blue Oak rating, G6 decision, and the relative path and SHA-256 of each discovered root licence file. G6 results use the repository's `loadBlueOakList`, `loadConfig` and `evaluateLicense` functions with Blue Oak list version 16.

Reproduce from the repository root with the pinned fixture lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix tools/licences/fixtures/git-engine
node tools/licences/inventory-git-engine.mjs --check
```

`--check` compares the generated inventory with the committed result without
rewriting it. Run `node tools/licences/inventory-git-engine.mjs --write`
separately only when intentionally regenerating the committed inventory.

The committed result is [`inventory.json`](../findings/git-engine-g6-inventory/inventory.json). It records 53 locked package entries and 0 G6 failures. The declared SPDX expressions are MIT (43 packages), Apache-2.0 (4), ISC (3), BSD-3-Clause (1), `(MIT AND Zlib)` (1), and `(MIT AND BSD-3-Clause)` (1). Three entries have no discovered root licence file (`clean-git-ref@2.0.1`, `diff3@0.0.3`, and `minimisted@2.0.1`); their package metadata SPDX expressions are recorded, and the inventory does not claim a licence file exists for them.

Direct-package evidence:

| Package | Locked version | Declared SPDX | Licence-file evidence | G6 |
|---|---|---|---|---|
| isomorphic-git | 1.44.13 | MIT | `LICENSE.md`, SHA-256 `b916888fb16893c3a1df138543f994b96bb6892d74b6777c3a080d9cd2520c48` | pass |
| @isomorphic-git/lightning-fs | 4.10.5 | MIT | `LICENSE`, SHA-256 `df563bf6740c35bef4afefe212b1227499bddd83c39283bbe8a07b4d89c17cf1` | pass |
| diff | 8.0.2 | BSD-3-Clause | `LICENSE`, SHA-256 `eda81a415869e67809f6a9f3fd6056062cb83a462118e07eec5e92b2e0c40ce9` | pass |

## Decision (proposed)

1. **Conditional candidate only: isomorphic-git with lightning-fs and diff.** The locked dependency closure passes G6, but that does not establish feature coverage. A spike must demonstrate the D13.3 surface (status, stage, commit, read-only log and text diff preview) and the D13.4 binary-preview behavior using the target desktop and browser/lightning-fs adapters. `diff` is inventoried as a text-diff dependency; it is not evidence that D13.4 is implemented. Until the spike evidence exists and the owner accepts this ADR, no engine is selected and no implementation is approved.
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
