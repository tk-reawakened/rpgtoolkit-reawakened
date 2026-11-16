---
type: feature
title: "Author and execute real engine RPGCode creator tests"
ticket: 9
status: done
---

## Scope

Extend the existing TOOL-5 framework rather than create an editor-only runner; build versioned inspectable fixture data, input actions, observable state/event projections, bounded wait, deterministic seed, isolated board/party/variables/provider, and source revision reporting. Refactor the existing Node-specific project discovery and file loading behind a host-neutral input seam so the same framework runs from browser and VS Code platform services without a second runner.

## Acceptance

A test driver advances waiting programs without blocking, failures show expected/actual and last action, changing the guarded outcome makes its assertion fail, and shipped game manifests exclude test-only code; visual authorship is not a prerequisite.

## Verification

A code-authored fresh fixture runs passing and deliberately failing wall or door assertions with deterministic ticks, source-located results and identical supported headless and visible inputs.

**Observed before final CI:** The shared runtime suite passed 122 tests, with focused fixture, action-scheduler, source-path and bounds regressions individually under one second. The real Chromium workbench proof passed with saved-byte, engine-frame, racing-edit refusal and included-source checks; disabling source reveal made its caret assertion fail, and restoring it passed. The real VS Code web-host proof passed with nine harness checks, save refusal, a paused Save All race, source navigation, visible/headless frame parity and a wall-removal negative control. The frame SHA-256 was `5af8e3a8a9edb0447ffa8976e067b7ae3da4e0d1d7e882b90c2aa1d438ac3a06`. Independent runtime and shared-UI reviews were completed; final native-delta review and exact-head required CI remain gates before merge.

**Final verification and merge (2026-11-16):** PR [#2830](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2830) merged as `25a0ca46178ee5651f0eceee847abb622848e70b`. Required CI [run 43914239180](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43914239180) passed on reviewed head `306e8dd10c7ead7d9bd4dcead245a65afce65543`, including all unit shards, script dogfood, golden, browser, native VS Code creator tests and desktop/mobile jobs. The actual native creator proof reported saved revisions, source navigation, frame parity and the frame hash above; the browser creator proof passed in 5.9 seconds. The initial macOS job received no runner and was cancelled; its retry ran the actual desktop checks and passed (#2905), without bypassing the required gate. Independent final review approved the targeted New Board form selector and deliberate dogfood-baseline migration; earlier native/runtime/UI reviews also completed. This supersedes the pending-review/CI note above.

The deliberate CLI hash changes reflect only the synthetic spec program identity changing from `__spec.prg` to the loader asset key `prg/__spec.prg` and its corresponding VM definition-owner IDs; exact old/current fixture snapshots otherwise matched, including source hashes. Optimized and canonical hashing matched the exact current fixture states. Full local `pnpm script:dogfood` and 38 focused output-contract tests passed before CI; the hash algorithm was not changed.

## Decisions and prerequisites

10.8 is blocked and partial: F-A/F-D/F-E/F-G and PKG-7 must be resolved by that provider; 11.1 specifies missing gameplay capabilities and this story implements and proves them rather than claiming they exist.

Prerequisites: 11.1, 11.7, 11.8, 10.8.
