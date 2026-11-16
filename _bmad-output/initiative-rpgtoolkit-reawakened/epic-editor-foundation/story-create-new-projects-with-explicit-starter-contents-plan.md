---
type: feature
title: "Create new projects with explicit starter contents"
ticket: 10
status: done
---

## Scope

Use packaging-and-paths defaults and validated destinations; list optional tiles, character, startup/system programs, menu and battle plugins and music, with provenance and availability made explicit.

## Acceptance

A blank project is usable without any starter kit, unavailable starter material is not silently manufactured, and overwrites require explicit review.

## Verification

In both hosts a new project opens and its generated .gam and standard folders resolve correctly, while cancel and failed creation preserve existing data.

## Decisions and prerequisites

Starter content requires rights-cleared provider evidence; no legacy asset bundle is assumed redistributable.

Prerequisites: 11.4, 11.6.

## Merged-state reconciliation, 2026-11-15

PR #2707 merged as `7450da3e85807d5dcaf11340ad46523ea4cb5370` with a successful required `gate`. Browser creation and the shared/VS Code adapter creation, cancellation, conflict and engine-boot tests are implemented and passed again in the 162-test focused foundation run at `3e61f3c2aedd2cd86dc0c29b5ebd750f5708f7bf`.

Issue #1708 is reopened, not marked done: #2759 records the remaining real VS Code folder-picker → create → project-open proof. The merged PR explicitly proves only command activation, first question and cancel in the actual workbench, with creation covered by adapter doubles. The desktop attempt was blocked by macOS Accessibility permission; injected picker answers are not equivalent evidence.

## Real-workbench completion candidate, 2026-11-15

The continuation implemented a durable real VS Code web proof for #2759. It drives the actual command, questions, starter checkboxes and directory picker; independently verifies the complete generated folder/file inventory, untouched bystander bytes and decoded main-file fields; then waits for the main file's settings editor and correct title after VS Code converts to a multi-root workspace. No later command activates the extension or opens the file on its behalf. The same proof is included in the ordinary required native-browser lane.

The proof exposed #2804 (the test provider rejected a directory URI's trailing separator), #2806 (selected directories needed canonical identities) and #2807 (wildcard project activation cannot resume without a file-search provider). Directory read normalization and selected-root normalization fix the first two. A literal `workspaceContains:Main` alternative was tested and still failed after the asynchronous virtual provider restarted; delayed `onStartupFinished` activation fixes that edge without pretending the original glob proved it.

Observed verification: the provider regression failed with `Invalid path segment` before the fix and the four provider tests passed afterward; the selected-root command regression failed to open the main file before canonicalization and all nine command tests passed afterward (99–527 ms individually). The real-workbench creation proof failed its automatic-tab assertion without reliable startup activation, then passed end to end with the delayed event (32.05 s for the whole host scenario). The 42 model/UI/command regressions passed with no skips. These are integration-host proofs, not ordinary sub-second unit tests. The plan remains built until independent review, required CI and merge complete.

## Merged acceptance closure, 2026-11-16

PR #2809 merged as `8c76126aef88f78639690c418576c56486b9cb7f`; GitHub reports it merged and that commit is in `origin/main`. Issue #1708 and its real-picker gap #2759 are closed by that PR.

The final default native-workbench proof passed in 138.16 seconds: sprite save/reopen; the complete Cancel settings/board/art/bitmap lifecycle; real new-project command, questions and folder picker; independently checked generated inventory, bystander bytes and decoded main-file fields; **detachment of the previous extension host**, followed by the selected `Quest.gam` tab and exact rendered game title; then the complete Keep lifecycle. No activation or file-open command supplies the automatic-open outcome.

The earlier focused result did not require previous-host detachment and is not the final after-restart evidence. Default-lane verification exposed the remembered-picker-directory assumption (#2810) and premature consumption of the pending open during folder-window conversion (#2821). Both are fixed. The strengthened existing command regression fails on the old implementation, then all nine command cases pass with no skips; its two conversion event orders complete in 55.5 ms.

Independent source review approved head `fed8170b493ffc8ef912b34d8b280fe953d4ad43`. Required CI run `43809700797` passed every check, including `gate`, browser, native VS Code web, all eight unit shards, desktop on three OSes, mobile, Node/Bun goldens, script dogfood and static checks. This completes the actual-workbench gap alongside the browser/shared creation, cancellation, conflict and engine-boot evidence already merged in #2707. Existing reload-probe investigations #2590 and #2644 remain open; a successful run does not establish every cause of those intermittent failures.
