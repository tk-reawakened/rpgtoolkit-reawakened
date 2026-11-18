---
title: 'Preserve and check native plugin blocks'
type: 'feature'
ticket: 10
created: '2026-11-18'
status: 'in-review'
baseline_revision: '81e49bf28bdda76a0c2a7724a73341a1c72dd0c8'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegated recommended implementation choices for autonomous Epic 12 work">

## Intent

**Problem:** Shipped native-data tooling still expects separate, linked plugin documents, while the current pre-release contract puts opaque plugin blocks in each native document. The editor therefore refuses valid plugin-bearing clips and rename/checker behavior is stale.

**Approach:** Cut checker, rename, clip and package identity tooling over together to the documented flat document shape and plugin envelope, preserving plugin text exactly. The flat shape is selected under the user's direction to use recommended answers; this is not a claim of direct approval of the whole proposed ADR.

## Boundaries & Constraints

**Always:** Follow `docs/spec/formats/native-contracts.md#plugin-blocks` and `docs/spec/engine/rpgcode-modules-and-objects.md#pkg-2-qualified-ids`: the stamp and core fields stay at the top level; `pluginData` is the only open dictionary; each envelope is closed, with a qualified id, version and mapping data. Check all seven `plugin-block` problem kinds, keep unknown data and comments exactly, and never rewrite opaque blocks on rename or ordinary clip edits. Native clip optional fields remain actually absent, not `null`. Keep namespaces single-segment and default qualified IDs to the last segment.

**Never:** Inspect or copy legacy GPL source; change runtime loading, implement plugin-present validation, migrations, plugin definitions or nested plugin blocks; silently regenerate source-backed blocks or invent a format-1.0 promise. A writer that cannot preserve source must refuse.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Valid plugin blocks | Authored clip with comments, flow formatting, unknown keys and `1.10` | Checker clean; edit delay changes one line; rename leaves block bytes untouched | No normalization |
| Invalid envelopes | One each of container, id, duplicate, shape, version, data and boundary | Checker names path, kind and plugin ID where available | Never descend into plugin-owned data as a schema |
| Source-backed write | Read clip carrying blocks then write it | Retain the original source bytes for blocks, including comments | Refuse if the required original source is missing or no longer matches the model |
| Qualified package | `com.example.weather` | Distinct package ID, default namespace `weather`; collisions detected | Invalid IDs and dotted namespaces refused |
| Retired links | Old owner/plugin link fields and CLI flags | Link checker classes and both link-field options are removed; reference renames remain | Unknown flags fail explicitly |

</frozen-after-approval>

## Code Map

- `docs/adr/0023-native-data-contracts-versioning-identity-and-sidecars.md` and `docs/spec/formats/native-contracts.md` already specify flat blocks; record the delegated flat-shape choice accurately before code, keeping overall ADR approval proposed.
- `packages/native-data/src/document.ts`, `check.ts`, `report.ts`, and `index.ts` parse stamps and currently report obsolete links. A shared AST-level plugin envelope validator must retain duplicate keys, inspect anchors/aliases and report structured `container`, `id`, `duplicate`, `shape`, `version`, `data`, `boundary` without decoding plugin-owned data as a schema.
- `packages/native-data/src/clip.ts` currently discards source in `readClip` and regenerates in `writeClip`; preserve block source explicitly. For a model containing blocks, a source-backed write must require the original text, validate that its parsed clip matches the requested model, and return it unchanged; absent or mismatching source is refused. Existing in-place property edits keep using splices. Clips without blocks retain ordinary fresh-document writing.
- `packages/native-data/src/rename.ts`, `packages/native-data-cli/src/run.ts`, `packages/native-data-rename/src/run.ts`, their tests and `CONTRIBUTING.md` carry retired link flags and call shapes. Preserve reference-field rewrites but never visit `pluginData`.
- `packages/core/src/script/manifest.ts` and `packages/runner-harness/src/package-catalogue.ts` share the old single-segment identity pattern; separate package ID and namespace patterns, migrate all callers, and test default namespace and collisions.
- `packages/native-data-import/`, `docs/spec/examples/native/animation-clip/`, their tests and registry/checker fixtures carry the old shape. Update the full consumer surface and examples in the same cutover; do not add whole legacy games.

## Tasks & Acceptance

**Execution:**
- [x] Record the delegated flat-shape selection in ADR/spec as a docs-first commit without representing it as direct approval.
- [x] Implement and test shared AST envelope validation, the checker report union and readable reporting; remove retired link classes/config.
- [x] Migrate rename and both CLIs and all callers/tests to the new checker contract; preserve opaque block bytes.
- [x] Implement source-preserving clip read/edit/write and importer integration; update authored valid/invalid examples and model/editor consumers.
- [x] Implement qualified package IDs and dot-free namespace behavior across core and catalogue; update their consumers and tests.
- [x] Prove each error kind and round trip with authored fixtures, including perturbation controls that fail for a regenerating writer; locally typecheck, lint, test, run the editor proof and applicable goldens before PR.
- [ ] Independently review practical blockers, log edge cases, push and merge only after required checks.

**Acceptance Criteria:**
- Given a plugin-bearing fixture project, when checked and renamed, the checker reports only real envelope faults and every plugin block remains byte-for-byte unchanged.
- Given an authored clip, when its delay is edited, saved and reopened, only that line differs and every plugin comment and unknown value remains intact.
- Given a qualified package ID, when loaded without an explicit namespace, its last segment is used and namespace collisions are still reported.

## Implementation Notes
- Plugin-bearing clips retain an exact source token and whole-document writes require matching original text; ordinary editor changes use in-place splices. Plugin-owned values are never regenerated.

## Plan Change Log

## Review Triage Log
- Independent review found the runtime still used the full qualified package ID as its default namespace (#3197). Fixed the resolver to use the shared final-segment rule; a runtime regression catches the former behavior. Review also requested an actual filesystem move of a plugin-bearing clip; that proof now verifies unchanged bytes and a clean checker.
- A first rename-review report described the wrong checkout and was withdrawn after re-review of this worktree. The clip review found no substantiated blocker; its observation that the source token can include trailing core text is an implementation detail, not a demonstrated preservation defect.
- Browser CI failed the unrelated creator-test race proof (#3199): its held read was released immediately after typing. The proof now waits until the real tab reports unsaved changes before releasing it; the full creator-test scenario passed locally. CI did not establish the precise scheduling cause.

## Verification
- Affected native-data, importer, CLIs, core manifest, catalogue and editor tests: 158 passed; new tests individually report under one second. Project build and affected test typechecks, lint, dependency graph, provenance and generated editor help passed.
- Real Chromium proof edited, saved and reopened a clip carrying a plugin block; exact saved bytes were checked, including comments and `1.10`. Screenshot inspected. Both AST reprinting and value regeneration differed from the preservation fixture.
- After the review fixes, 200 engine-boot and rename-executor tests passed, including the two new cases. The preservation test failed against both an AST-reprinting writer and a value-regenerating writer, then passed after restoration. Before the runtime namespace fix, headless golden passed and closing matched all 8 baselines (2 clean boots and 6 expected failures).
- Full local typecheck passed, as did 5,189 workspace tests with no skips. The repaired creator-test browser scenario and its targeted lint passed locally.

- Run the affected native-data, importer, CLI, rename, core manifest, catalogue and editor tests individually and together; inspect new unit durations.
- Typecheck affected projects, lint, dependency graph, provenance, docs/schema checks, and locally exercise native clip authoring before pushing. Run headless goldens if the core manifest change affects them.
