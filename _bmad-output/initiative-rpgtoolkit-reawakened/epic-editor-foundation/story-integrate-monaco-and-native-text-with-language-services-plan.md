---
type: feature
title: "Integrate Monaco and native text with language services"
ticket: 7
status: done
---

## Scope

Use the transport-free LSP with correct browser worker and VS Code native transports; implement token styles, bookmarks, quick-reference and keyboard accessibility using existing command documentation, preserve encoding and unknown text.

## Acceptance

Native VS Code and shared views have one authoritative text identity, language failures do not prevent editing, and real program content survives save and reopen in both hosts.

## Verification

In both hosts a .prg edits and saves with live coloring, symbols and comments navigation, call tips, command reference insertion, header template and distraction-free mode, even without Epic 22.

## Decisions and prerequisites

ADR 0021 selects Monaco, not its integration version. The CSP posture is accepted in [ADR 0029](../../../docs/adr/0029-monaco-csp-style-src.md): standalone Monaco pages allow inline styles and self fonts while scripts remain strict; VS Code keeps its native text editors and strict style policy. 11.7 still must complete the worker/offline, production asset, and G6 licensing proofs. 22.9 may add grammar later and is not a prerequisite.

Prerequisites: 11.3, 11.5, 10.1, 10.5.

## Code Review

### 2026-11-15 — queued text repair

Independent blind, edge-case, verification-gap and intent reviews covered the repair diff. Triage: 0 decisions, 7 patches, 0 deferred, 0 rejected. The edge-case and verification reviewers independently identified the same repeated-materialization defect; it is grouped below without dropping either report.

- [x] [Review][Patch] Redo must restore only captured insertion fragments, preserving unchanged identities after a net-zero queued save (#2769). Full-root restoration by text equality was insufficient; the regression now includes Undo → Save → Redo and replacement position, specified in TOOL-10 before the code commit.
- [x] [Review][Patch] Materialize text once per diff, not once per changed range (#2771; blind, edge-case and verification-gap). A deterministic read-count regression checks two total revision reads and applies the emitted edits to verify the target.
- [x] [Review][Patch] Do not retain deletion metadata for new transient typing identities above the pending base's maximum identity (#2770). The paste/delete proof now drives `changePendingText` and checks the tombstone list as well as reachable payloads.
- [x] [Review][Patch] Exercise the actual pending-edit path in retention evidence (#2770), rather than measuring direct rope edits alone. Retained history now contains only insertion fragments and is cleared when the command queue drains. These are structural reachability checks, not browser heap/GC measurements.
- [x] [Review][Patch] Preserve unchanged subtrees when merging queued revisions and test repeated merged saves (#2772). The sharing proof includes `mergePendingText`, not only direct edits.
- [x] [Review][Patch] Assert cached lengths, heights and AVL balance during varied replacements (#2772).
- [x] [Review][Patch] Verify UTF-16 code-unit preservation across block boundaries, including surrogate and combining code units (#2769). The text helper preserves them; the authoritative program document still enforces Windows-1252.

The intent audit correctly limits the evidence: helper reachability is not an end-to-end heap measurement or a constant global memory bound for arbitrarily many distinct save requests. PR completion also requires the whole-PR review, real-browser checks, required CI and cleanup recorded in the PR handoff.


Follow-up review caught replacement anchors being placed after restored suffixes when a later unchanged character survived, and when the replacement was textually net-zero. Both are covered by direct merge regressions under #2768/#2769. Structural sharing now reuses unchanged interior spans too; the added both-end-edit regression covers the reviewer’s counterexample under #2772.

The independent whole-PR review found four additional defects, all tracked and fixed in this PR:

- [x] [Review][Patch] #2780 directory deletion/rename left the browser language snapshot stale; a mocked worker/timer integration test checks actual inventories after both operations.
- [x] [Review][Patch] #2781 a leading NUL accepted by standalone text edits or new-program headers reopened as compiled; docs-first clarification and atomic-refusal/save-reopen tests now preserve source kind. Native VS Code editing is not claimed to enforce this standalone rule.
- [x] [Review][Patch] #2782 non-whitespace continuation underscores suppressed following comments/bookmarks; LEX-1 boundary tests cover whitespace and allowed trailing comments.
- [x] [Review][Patch] #2783 destructor names lost declaration colouring; LEX-4 tests cover declarations and bitwise NOT control input.

CI follow-up for #2720: a verified command-palette row disappeared during Playwright's pointer-stability wait. The harness now checks visibility/identity and invokes the normal list click handler in one browser task. Only an explicit no-dispatch result can retry; evaluation errors, timeouts and all post-dispatch failures propagate. An independent reviewer inspected the control flow and cached VS Code list handler. The negative control dismisses the first successfully prepared palette and explicitly requires a no-dispatch result; existing autosave completion barriers remain mandatory. Host focus transitions use bounded settling/backoff pacing.

CI follow-up #2784: a save invalidated a File snapshot during browser verification. The saved-file helper now retries NotReadableError only from the snapshot read, acquiring a new File within its existing bounded poll; permission failures still propagate. A controlled browser test requires fresh snapshots and immediate permission-error failure. Independent review found no remaining issue; all six focused Chromium scenarios passed.

## Merged-state reconciliation, 2026-11-15

PR #2708 merged as `3e61f3c2aedd2cd86dc0c29b5ebd750f5708f7bf`; its required `gate` and browser, VS Code web, unit, golden and desktop checks report success, and #1705 is closed. On that revision, `program-document.test.ts`, `program-view.test.ts` and `program-editing.test.ts` passed in the 162-test focused run (zero skips). Creator gameplay tests remain #1707; contextual help remains #1709, rather than being inferred from this editor integration.
