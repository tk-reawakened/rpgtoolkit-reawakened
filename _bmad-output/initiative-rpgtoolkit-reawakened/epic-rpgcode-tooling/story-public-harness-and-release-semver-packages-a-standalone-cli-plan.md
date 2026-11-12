---
title: 'Public harness and release'
type: 'feature'
ticket: 11
created: '2026-11-11'
status: 'in-progress'
baseline_revision: '0dd69052b76d402eab0235ab6ee0290d9ee44535'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/engine/rpgcode-tooling.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The harness and tools work in the repository, but private workspace packages cannot be installed by an independent author. The extension has a build, not demonstrated publication to either registry.

**Approach:** Publish a versioned, supported package closure and extension, document the existing result protocol and harness API, and supply a standalone CLI and reusable Action. Prove the published artifacts outside the checkout before declaring the story done.

## Boundaries & Constraints

**Always:** Preserve G1–G7, especially G2 boundaries, G5 golden discipline and G6 for all shipped trees and bundles. Keep package entry points and dependency edges consistent with AD-21/AD-22. The approved TOOL-9 `tkr script` commands, exit meanings, `tkr-script-result/1` and compatibility rule remain authoritative. Preserve desktop and web extension support. Resolve #950's reopened CI-proof gate before marking this entry complete.

**Never:** Publish, mutate registry namespaces, create tags, or claim completion before the plan checkpoint, appropriate credentials and the release authorization. Do not expose tokens in logs. Do not treat an internal workspace run, local tarball, VSIX build, or npm prerelease as proof of public installation. Do not close #951 from a planning PR.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior | Error handling |
|---|---|---|---|
| Independent author | Published versions, clean environment and copied stock package | Node and Bun run `check`, `fmt --check`, `test`; JSON matches schema and documented exit code | Fail the release on missing dependency, checkout path, bad schema or mismatched status |
| Findings or bad input | Deliberately invalid source, formatting difference, failing/strict-skipped spec or bad path | Documented nonzero code and valid JSON envelope on stdout | Assert stderr separately; no false success |
| Missing access | Registry or Marketplace/Open VSX credentials unavailable | Preserve reviewed release artifacts and report the blocked publication | No implicit alternate registry, silent skips, or success claim |
| Action consumer | Separate fixture repository, pinned published Action and packages | Same commands, JSON and exits as CLI | Failing fixture must fail its job |

</frozen-after-approval>

## Code Map

- `packages/script-cli/package.json`, `packages/script-cli/src/cli.ts`, `src/commands/` and `docs/spec/schemas/tkr-script-result.schema.json`: existing `tkr` bin, real command dispatch, exits 0–3 and schema; preserve TOOL-9.
- `packages/runner-headless/package.json`, `packages/runner-harness/package.json`, `packages/script-tools/package.json`, `packages/script-cli/package.json`, `packages/script-spec/package.json`, `packages/core/package.json`, `packages/plugin-tk2-compat/package.json`: presently private `0.0.0`; `workspace:*` edges require a complete publishable dependency closure, not just headline packages. Recompute the closure from production dependencies before publishing.
- `extensions/rpgcode/package.json`, `extensions/rpgcode/build.mjs`: existing publisher ID, desktop/browser clients, bundled servers and debug adapter; `.github/workflows/ci.yml` builds the VSIX. Build output is not registry-install proof.
- `docs/spec/engine/rpgcode-tooling.md` TOOL-6/TOOL-9: ruled index and result schema evolution; do not invent a conflicting promise. `packages/runner-harness/src/index.ts` is the current programmatic barrel; audit exports and dependencies before promising stability.
- #943 and #949 are closed. #950 is open pending real VS Code web CI proof: merged #2009 has passing `vscode-web` and `gate` on [run 43147366173](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43147366173); reconcile the issue rather than assume it closed. Baseline main CI: [run 43148959805](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43148959805).

## Decisions and checkpoint

Already approved: early extension publishes under its own ID to both registries; `tkr script` command family and TOOL-9 schema/exit contract; epic scope includes all release surfaces. In this session the user selected the following recommendations and authorized release:

1. Publish the seven-package production closure above as coordinated `1.0.0` versions under the existing `@tk-reawakened` scope; recompute before release.
2. Use a repository-hosted composite Action pinned to an immutable release commit and install an exact released CLI version; use Node as the Action runtime while independently testing Bun.
3. Use registry-supported automated authentication and least-privilege publisher credentials for npm, Marketplace and Open VSX. Missing credentials or access block publication.

## Tasks & Acceptance

**Execution, after checkpoint approval:**
- [ ] `packages/{core,plugin-tk2-compat,runner-harness,runner-headless,script-tools,script-spec,script-cli}/package.json` and workspace build configuration — calculate transitive production closure; choose owner-approved coordinated versions, replace private-only packaging as needed, produce clean tarballs with built JavaScript, declarations, assets, licences and resolvable non-workspace dependency ranges. Audit additional production dependencies instead of assuming the list is exhaustive.
- [ ] `packages/runner-harness/src/index.ts`, `packages/runner-headless/src/index.ts`, `packages/script-tools/src/index.ts` — audit the public exports and document the approved API compatibility policy; preserve single public entries and G2. Any missing behavior or contract goes through doc-first G7, not an invented shim.
- [ ] `packages/script-cli/`, `docs/spec/engine/rpgcode-tooling.md` and user-facing documentation — make the released CLI installable with `npx` and usable under Node and Bun; document exact supported runtime versions, JSON schema/exit codes, and an executable example driving the harness from another test runner. Do not revise approved TOOL-9 semantics.
- [ ] `.github/` — add the chosen reusable Action, pinned package inputs and a copy-paste consumer CI recipe; add release automation with no embedded credentials. Supply a separate fixture repository/test that executes the Action as a consumer, including a negative case.
- [ ] `extensions/rpgcode/` and release workflow — package the existing desktop/web extension and notices, publish the same intended version to both registries after authorization, and record registry identifiers and versions. Retain a real web debugger check.
- [ ] `tools/licences/`, `THIRD_PARTY_NOTICES` and release checks — run G6 against each actual packed/published production tree and bundled extension, not only workspace metadata; `ovsx` remains dev-only and must not ship.

**Acceptance:** Given no checkout, when a clean container installs published versions, then the copied stock package's three commands return documented exits and schema-valid JSON under Node and Bun. Given a separate fixture repository, when it uses the released Action, then its passing and intentionally failing workflows report correctly. Given each registry, when installing the published extension, then the intended version installs and desktop/web paths work. Given the published trees, when the licence, dependency graph, provenance and relevant G5 gates run, then all pass and their evidence is recorded. Completion also requires the done checkpoint and resolved #950 dependency.

## Verification

1. Before public release: build from a fresh clone at the candidate commit with a clean home and pinned tools; pack every closure package; inspect tarball manifests, rewritten dependency ranges, licences and file lists. Install only those tarballs into a separate empty directory without workspace links, then exercise CLI and programmatic harness. This is preparation, not published proof.
2. Run focused CLI/schema, harness, extension desktop/web, Action fixture and negative-case tests; run `pnpm graph`, `pnpm licence`, `pnpm provenance` and the applicable CI/golden gates. Validate actual packed dependency trees separately against G6. Record commands, versions and results.
3. After explicit release authorization: publish in dependency order; in a new clean container with isolated home/cache, install exact published package versions from the public registry, copy the stock fixture without the checkout, and run `check`, `fmt --check`, `test` plus deliberate nonzero cases under both supported runtimes. Validate stdout against the published schema and compare process exit to `exitCode`; verify no workspace paths are available.
4. Run the released Action in an independent fixture repository, including its failure case. Install the published extension from Marketplace and Open VSX separately and exercise desktop and web paths. Record registry URLs, versions, job URLs and actual outcomes; leave #951 open if any proof or credential is missing.

## Implementation Notes

- Candidate preparation: seven packages packed with their licences and `script-spec/package/startup.prg`. In an independent local directory, Node 26.13.0 and Bun 1.4.2 ran the packed CLI on a copied stock package, and both ran three actual cases in the copied `pass-project`. The stock package itself contains no spec cases. The programmatic `createScriptHost` example ran under Node. This is not fresh-clone or published-registry proof.
- `pnpm build`, `pnpm licence`, `pnpm graph`, `pnpm provenance` and six release helper tests passed locally. An installed-package licence scan found nine MIT packages. `npm ls --omit=dev --all` on this local-tarball install reported the seven file-installed workspace packages invalid; do not treat that install as proof of normal registry dependency resolution.
- `npm whoami` returned `ENEEDAUTH`; access to organisation secrets returned HTTP 403. Registry scope control and both extension publisher credentials remain unverified. No publication was attempted.
- Remaining acceptance includes clean-clone proof, schema and negative-case validation against released packages, the Action fixture repository, extension publication and both registry installs, and release automation. The local preparation is not release completion.
- Subsequent preparation: a clean clone at `5ff0eff3eee88cc27665240e392d7aa2c14bc8a7` installed dependencies and passed `release:preflight` and all 13 release helper tests; a CI-equivalent extension `npm ci`, build and bundle licence audit also passed from that clone. The first extension-install attempt from `/tmp` with an absolute npm `--prefix` failed; running the workflow's relative command from the repository root passed. One CLI tarball matched byte-for-byte across the worktree and clean clone. This was not a fresh-container or published-registry run.
- The branch now includes manual release automation with credential probes and resumable npm integrity checks; its release workflow has not been run. Independent review found and prompted fixes for the real-Action preflight and partial-release handling. Published packages, a remote Action consumer fixture and both extension-registry installations still need proof; this story remains open.
- The existing extension publisher pulled a restricted Microsoft signing helper outside the pnpm licence inventory (#2017). Preparation now uses the named EPL-exempt `ovsx` 0.7.0 and MIT `vsce` 2.15.0 with locked dependencies, disables npm install scripts and keytar's pnpm build, and patches their vulnerable parsers (#2018). The original publisher and parser versions are not shipped. `pnpm audit --dev` still reports three unrelated dependency advisories, tracked as #2019–#2021; it does not establish exploitability.

## Plan Change Log

## Review Triage Log
