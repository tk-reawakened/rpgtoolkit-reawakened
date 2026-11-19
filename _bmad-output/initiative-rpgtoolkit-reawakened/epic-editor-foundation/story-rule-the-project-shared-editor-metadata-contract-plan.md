---
title: 'Rule project-shared editor metadata'
type: 'feature'
ticket: '25'
created: '2026-11-18'
status: 'draft'
baseline_revision: '0df89080daae07b6733fd22ba6312f8d58881442'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project cannot yet preserve shared creator-facing names, descriptions and Game drawer organization for legacy assets and board elements without confusing them with runtime data. Board slots change when objects are deleted or reordered.

**Approach:** Record a docs-first contract for optional shared metadata, with identity and failure rules that never silently attach an annotation to a different object. The owner has delegated routine decisions and recommendations for asynchronous progress; distinguish these decisions from a direct review of the contract.

## Boundaries & Constraints

**Always:** Keep legacy asset bytes and game behavior authoritative. Existing projects open and run without metadata. Follow document identity and host capability contracts, preserve unknown data, and disclose non-atomic host operations. Document group and lifecycle choices and the package exclusion explicitly.

**Never:** Infer a board object's identity from a reused slot, equal-looking content, filename or geometry. Do not turn creator descriptions into game state, invent reference links, claim atomic saves or require native-format migration. Do not implement the provider or UI in this docs-only story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| No metadata | Existing project | Open and run normally, showing derived names | No forced file creation |
| Object reorder/delete | Legacy board and metadata | Preserve annotations only with a proven operation mapping; deleted object's annotations never move to another | Ambiguous entries remain unmatched |
| External modification | Board or metadata changed independently | Detect where host supports it; preserve both versions and prevent unproven attachment | Explain uncertainty and recovery; never claim atomicity |
| Metadata unreadable | Invalid or unsupported metadata | Game data remains usable; preserve original bytes | Explain the problem; no automatic replacement |

</frozen-after-approval>

## Code Map

- `docs/design/editor-project-metadata.md` — owner direction and unresolved choices.
- `docs/adr/0022-shared-editor-authoring-contracts.md` D1–D4 — path identity, lifecycle, non-atomic multi-document operations and recovery.
- `docs/spec/formats/packaging-and-paths.md` — explicit package exclusion and post-write verification.
- `packages/host-web/src/settings.ts` — existing project preference file, not an annotation store.
- `packages/editor-model/src/board-objects.ts` and `board-editor.ts` — object kind/index selections, reorder and delete; slot indices are not durable identities.
- `packages/host-web/src/filesystem.ts` and `packages/platform-services/src/fs.ts` — host-dependent watch/rename and no conditional write.
- `docs/spec/formats/native-scene.md` — native local IDs do not carry over into legacy board output.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/design/editor-project-metadata.md` — replace first-pass uncertainty with concrete delegated recommendations and a versioned sidecar contract, including exact association, fallback, groups and UI rules.
- [ ] `docs/spec/formats/packaging-and-paths.md` — specify and verify exclusion of the editor-only metadata file.
- [ ] `_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-foundation/tickets.toml` and board follow-on — coordinate implementation prerequisites and acceptance with the contract without changing completed stories.
- [ ] Review the contract independently against supported host behavior, realistic board edits, concurrent file modification and export semantics.

**Acceptance Criteria:**
- Given an unchanged board and its saved metadata, when reopened, annotations resolve to their intended element; after any unproven modification or interrupted multi-file save they do not silently attach to a different element.
- Given supported editor edits and a safe, known object mapping, when metadata is saved and reopened, names follow the original objects across reorder; deleted elements do not pass names to successors.
- Given an existing project without metadata, when opened or run, it remains usable and no metadata file is created until the creator makes an annotation or organization change.
- Given names and descriptions for an asset, when viewed from another host, the shared metadata supplies them without changing the game file or the runtime reference.
- Given an exported distribution, when its archive is inspected, editor-only metadata is absent.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Existing project settings are `.tkr/editor-settings.json`, but contain preference values rather than annotations. Existing project identity folds ASCII case only. Board records are indexed lists with no durable IDs, so a sidecar mapping must bind each element to a verified board revision and transform known operations, not trust a slot after unverified change. Exact format choice requires checking existing YAML support and packaging practices before freezing it.

## Verification

- Validate links, rule consistency and package-exclusion wording against the current docs.
- Run the repository provenance scan on the documentation change.
- Run ticket-store status for the two affected epics and check reported dependency problems.
