---
type: feature
title: "Battle background editor"
ticket: 11
created: '2026-11-25'
status: done
baseline_revision: '275f69f0324af5407d996eca00d5ecf0fb02802f'
route: full
route_source: auto
risk: medium
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Edit a battle background's image, music and four independently labelled sounds, save it and use the saved result in a real battle. Make asset selection and audio audition separate so preview never changes a reference.

## Boundaries & Constraints

**Always:** Preserve same-version binary data and residue, shared document history and lifecycle, and existing project-owner and asset-resolution rules. Register each user action as a command. Keep core deterministic and host I/O behind platform services. Retain originals and report missing, unsupported or refused operations.

**Never:** Silently convert a legacy file; simulate unavailable host audio; claim an audition proves battle playback; add a second asset browser or separate document lifecycle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior |
|---|---|---|
| Edit and save | Binary BKG with six linked fields | Save and reopen all fields, original minor version and trailing bytes; undo and redo use shared history. |
| Linked assets | Existing, missing or ambiguous reference; picker cancelled | Select through the shared picker or report the condition; cancellation and failed lookup do not change stored text. |
| Audio preview | WAV/MIDI, unsupported format, missing file or unavailable host capability | Play/stop/loop where supported; otherwise explain why without changing the reference. Disposing or replacing the view stops its audition safely. |
| Real battle | Saved BKG points to an authored image or tile bitmap | The real battle provider loads the saved background and cues, rendering independently expected pixels and emitting the expected sounds. |
| Older form | Toolkit 2 text BKG | Preserve the original bytes and do not silently convert; expose a clear read-only explanation unless a documented same-version writer is available. |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/battle-data.md#fight-background`, `docs/spec/formats/legacy/text-formats.md#fight-background`, `docs/spec/engine/battle.md`, and `docs/spec/formats/tiles.md#tile-bitmap-tbm` define data and runtime behavior. Document any missing editor policy in its own commit before implementing it (G7).
- `packages/core/src/formats/battle/battle-background.ts` and `model.ts` already read and write binary BKGs and read text BKGs. `packages/core/src/script/packs/battle.ts` returns the binary image directly; `stock/stock_battle/startup.prg` uses it for `bitmap`. The typed BKG picture path is for text grids. The earlier contrary inference in #3493 was retracted. Verify real-battle image and tile-bitmap rendering independently.
- `packages/editor-model/src/special-move-document.ts`, `status-effect-document.ts`, `battle-data-fields.ts`, `battle-data-links.ts`, `kinds.ts`, and `index.ts` provide the shared byte-backed document, field validation, reference and registration patterns.
- `packages/editor-ui/src/battle-data-form.tsx`, the move/status views and `mount.ts` supply linked rows and shared views. `board-audition.ts` and `board-properties-view.tsx` already use platform audio output and registered Play/Stop/Loop commands.
- `packages/host-web/src/workbench.ts` and `index.ts` provide owner-aware asset picking and audition; `tools/browser/editor-web/audition-output.ts` supplies browser playback. `packages/host-vscode/src/custom-editor.ts`, `extension.ts`, `document-bridge.ts`, `webview.tsx` and `extensions/editor/package.json` own the VS Code document/bridge/selector path; report audition unavailable if the host does not supply it.
- `packages/core/test/battle-cues-engine.test.ts`, `packages/editor-model/test/battle-data-documents.test.ts`, `packages/editor-ui/test/battle-data-view.test.ts`, `tools/browser/tests/editor-battle-data.spec.ts`, and `tools/editor-vscode-test/` provide real-provider and host proof patterns.

## Tasks & Acceptance

**Execution:**
- [x] Resolve and document binary/text save and reference behavior from the normative specifications; commit any necessary documentation separately before code.
- [x] Add a BKG document, codec and field commands using the shared document lifecycle and existing reference validation.
- [x] Add the shared BKG view, six individually labelled links, linked picker/navigation and capability-aware audition through existing services and command registry.
- [x] Register and route the document through browser and VS Code hosts, preserving ownership, pending edits, save/close and unavailable-capability semantics.
- [x] Verify binary image and tile-bitmap rendering in the real battle provider and retain the legacy text-grid path; correct any independently demonstrated defect.
- [x] Add independent expected-value coverage for the matrix, binary image and TBM battle rendering, audio cues, host flows and negative cases; update user-facing help and changelog.

**Acceptance Criteria:**
- Given a binary BKG, when an author changes all six references, saves, closes and reopens in either host, then the saved values, version and residue survive, and undo/redo and failed-save behavior follow the shared contract.
- Given the editor-saved BKG and authored assets, when a real battle starts, then independently expected background pixels and music/menu cues come from the saved file.
- Given cancellation, unreadable/missing media or unsupported playback, when a user picks or auditions an asset, then no stored reference is changed and the actual limitation is reported.
- Given a text-form BKG, when opened and saved, then its original bytes are preserved and no unapproved conversion occurs.

## Implementation Notes

- Browser audition uses the existing audio-output service; VS Code explicitly reports that audition is unavailable.
- Editor-saved bytes drive stock battle picture, menu cue and full-engine FightEnemy music assertions. A deliberately disabled Stop failed the looping-audio browser assertion (#3507).
- The packaged VS Code proof seeds its nested BKG/TBM in the flat CI workspace (#3508); the CI-shaped local proof passed.

## Plan Change Log

## Review Triage Log

## Verification

- Run focused editor-model, editor-ui and core real-battle tests, including independent expected bytes and rendered pixels.
- Run browser and packaged VS Code host proofs; use actual supported services and record capability limits.
- Run project-required checks and golden CI before merge; independently review the final exact head.

## Closure evidence

The owner merged [#3509](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3509) at `958617ee7f45e0413d401f86bc2b02bf4c712715` on 2026-11-26 and closed [#1736](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1736); its [required gate](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45885937529/job/140146218752) passed.

| Acceptance clause | Observed evidence |
|---|---|
| A BKG round-trips all six links and loads in a real battle | The browser proof fills all six labelled links, saves exact bytes, and the stock battle reads the editor's saved background, menu sounds and FightEnemy music; the packaged VS Code Web proof does the same through the custom editor. |
| Preview cancellation and missing or unsupported audio are reported without mutating references | Focused editor-ui tests cover cancellation and each refusal, and the real proofs compare backing bytes before and after refusal. The VS Code host reports audition unavailable rather than faking it. |
| Text-form backgrounds stay read-only and byte-preserving | The text form is read-only, and the proofs assert unchanged source bytes. |
| Host capability is honest | Browser hosts audition audio; the VS Code host states that audition is unavailable. No desktop file-host or VS Code playback capability is claimed. |

Three independent-review findings were filed after the merge: [#3516](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3516) and [#3517](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3517) remain open fixes for audition-by-suffix and browser Open eligibility; [#3518](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3518) was fixed by the merged head and is closed. None contradicts the acceptance table above.
