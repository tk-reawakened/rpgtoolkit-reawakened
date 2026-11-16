---
type: feature
title: "Create new projects with explicit starter contents"
ticket: 10
status: built
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
