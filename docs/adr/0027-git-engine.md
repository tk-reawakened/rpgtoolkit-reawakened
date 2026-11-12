# ADR 0027 — The Git engine is isomorphic-git, chosen through the G6 licence inventory

* **Status:** Proposed (2026-11-12). Not approved by the owner. No code follows from it until it is accepted (issue #1829).
* **Date:** 2026-11-12
* **Context documents:** [0022](0022-shared-editor-authoring-contracts.md) D13 (Git is a capability), [0003](0003-permissive-licences-acceptable.md) (permissive licences), [guardrails](../guardrails.md) G6 (licence gate) and G7 (clean-room provenance), [0026](0026-editors-are-registered-by-document-kind.md).
* **Does not reopen:** ADR 0022 D13.1, D13.2, D13.4 and D13.5; the exclusion of push, pull, remotes and credentials; ADR 0003; the text of G6 and G7.
* **Amends if accepted:** the wording of ADR 0022 D13.3, "the user's installed `git` in desktop". See Decision 3.

## In plain terms

ADR 0022 says the editor must show which game files changed, preview the change, and record a commit, and that it must work without Git. This ADR picks the library that does that work, and records what its licence allows. The choice follows the licence test in G6, not preference.

## Context

- ADR 0022 D13.3 defines the standalone surface: status of changed documents, diff preview, stage and commit, and a read-only log, behind a platform-services `scm` interface. It leaves the engine open and says the choice is gated by G6.
- G6 rule 1 requires every shipped dependency to be rated Bronze or better on the Blue Oak list. Rule 2 blocks copyleft of any strength, including GPL, and any licence that is unknown or unlisted. A blocked licence needs an ADR exception.
- The repository gate is `tools/licences/check.mjs`, run as `pnpm run licence`. Its policy in `tools/licences/config.json` sets `minimumRating` to Bronze and blocks MS-PL. It evaluates AND, OR and parentheses. It does not evaluate SPDX `WITH` exceptions: `GPL-2.0-only WITH GCC-exception-2.0` is rejected as a malformed expression.

## Candidates

| Candidate | Where it runs | Licence | G6 result |
|---|---|---|---|
| isomorphic-git 1.44.13, with `@isomorphic-git/lightning-fs` 4.10.5 for browser storage and `diff` 8.0.2 for text diff | Browser and desktop, pure JavaScript | MIT, MIT, BSD-3-Clause | Passes (inventory below) |
| simple-git 4.0.2 | Desktop only; drives a `git` binary the user has installed | MIT | Passes for the npm package. Not usable in the browser |
| nodegit 0.27.0 | Desktop, native | MIT (wrapper) | Fails on its libgit2 component (finding 1) |
| wasm-git 0.0.17 | Browser, WebAssembly build of libgit2 | None declared | Blocked: licence unknown (finding 2) |

**Finding 1, libgit2.** libgit2's `COPYING` declares GPL-2.0 with a linking exception. G6 rule 2 blocks GPL-2.0 by name, and the gate cannot model the exception. A libgit2-based engine therefore needs an ADR exception, and this ADR does not propose one. This reads the licence file for policy purposes. It is not a legal opinion.

**Finding 2, wasm-git.** The npm package has no `license` field. Its README has no licence statement. GitHub reports the repository licence as `NOASSERTION`. Its build wraps libgit2, so finding 1 applies as well. G6 rule 2 blocks unknown licences.

## Licence inventory

Evidence: the npm `license` field, and the LICENSE file from the package itself. Blue Oak ratings come from the pinned list (version 16, `tools/licences/blue-oak-list.json`).

| Package | Version | Licence | Blue Oak rating | LICENSE file | Gate |
|---|---|---|---|---|---|
| isomorphic-git | 1.44.13 | MIT | Silver | `LICENSE.md`, "Copyright 2017-2023 the 'isomorphic-git' authors" | pass |
| @isomorphic-git/lightning-fs | 4.10.5 | MIT | Silver | `LICENSE` | pass |
| diff | 8.0.2 | BSD-3-Clause | Bronze | `LICENSE`, "Copyright (c) 2009-2015, Kevin Decker" | pass |
| simple-git | 4.0.2 | MIT | Silver | npm field only | pass |
| nodegit | 0.27.0 | MIT (wrapper) | Silver | npm field only; native libgit2 component not inventoried | fail (finding 1) |
| wasm-git | 0.0.17 | none declared | not rated | none found | blocked (finding 2) |

**Closure of the chosen set.** isomorphic-git, lightning-fs and diff together bring 53 packages. The licences are MIT 43, Apache-2.0 4, ISC 3, BSD-3-Clause 1, `(MIT AND Zlib)` 1 and `(MIT AND BSD-3-Clause)` 1. All 53 pass the gate, with 0 failures. Each of these licences is rated Silver or Bronze on the Blue Oak list.

**How the gate was run.** The inventory was run through the repository's own `loadBlueOakList`, `loadConfig` and `evaluateLicense` functions from a scratch script outside the repository. That script is not committed. The gate was also checked against known verdicts: `GPL-2.0-only` and `GPL-2.0-or-later` fail, and `MIT` passes. The repository gate `pnpm run licence` runs in CI on the implementation PR that adds these dependencies.

## Decision (proposed)

1. **The Git engine is isomorphic-git (MIT).** `@isomorphic-git/lightning-fs` (MIT) provides browser storage, and `diff` (BSD-3-Clause) provides text diff previews. Together they implement the D13.3 surface: status, diff preview, stage, commit and read-only log, behind the platform-services `scm` interface.
2. **No libgit2-based engine** (`nodegit`, `wasm-git`). Choosing one would need an ADR exception for GPL-2.0 with a linking exception, or a verified licence for `wasm-git`. Neither is proposed here.
3. **Desktop uses the same engine, reading the working tree through Node's filesystem.** This changes the wording of ADR 0022 D13.3. The alternative is simple-git, which is MIT and needs the user's `git`. **This is an owner decision.** The recommendation is one engine on both hosts, so behaviour is identical and no `git` install is needed.
4. **Scope is unchanged.** Push, pull, remotes and credentials stay out of scope (ADR 0022 D13.3).

## Consequences

- Browser and desktop share one code path. Desktop does not need a `git` binary.
- The engine implements a subset of git. Features outside the D13.3 surface may be missing, and repositories that depend on them will not work.
- Performance on large binary game repositories is unmeasured. The implementation acceptance criteria must measure it, as 11.14 did for history.
- The production tree gains 53 packages. Each version bump must pass the G6 gate in CI.

## Owed before acceptance

Stated as unverified in this ADR:

1. A spike that runs status, add, commit and log on a fixture repository, in Node and through the lightning-fs browser adapter. This tests decision 1's coverage and browser claims, which are not yet verified.
2. Confirmation of isomorphic-git's browser support from its own documentation. It has not been read in this session.
3. Owner confirmation of decision 3, and of the resulting D13.3 wording change.
4. Owner decision on whether `wasm-git`'s licence should be pursued. Not needed for the proposed option.
5. `pnpm run licence` in the implementation PR that adds the dependencies.
