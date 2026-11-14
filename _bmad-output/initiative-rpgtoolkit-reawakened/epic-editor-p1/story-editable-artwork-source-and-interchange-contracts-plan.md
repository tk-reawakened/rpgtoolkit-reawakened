---
type: feature
title: "Editable artwork source and interchange contracts"
ticket: 21
status: draft
risk: high
---

## Intent

Specify persistent layers, frames, recipes and source-to-output relationships by extending the Epic 27 tile/pack contracts where appropriate, and define standard image/sheet/animation interchange and exact multi-cell timing/lowering before implementation.

## Scope and acceptance

1. Publish normative contracts and worked examples before dependent code, with an owner approval gate. Reconcile with 27.11/27.12 rather than replacing their baseline contracts or inventing a competing family.
2. Specify ownership and stable identity for source images, layers and their order/visibility/opacity, frames, named sheet regions, recipe inputs/parameters/overrides and generated outputs. Distinguish source identity, display order and source coordinates.
3. Decide whether existing native documents suffice. A new document kind needs the catalogue admission test, its ADR/registry/schema and reference/checker rules; no extension is reserved here. Keep structured metadata separate from pixel payloads and explain the Git diff and preservation behavior.
4. Define standard exchange for PNG images/sheets and animation metadata: dimensions/origins/margins/gaps, alpha/key conversion, named regions, frame order and timing, missing sources and explicit loss reporting. Do not silently choose a generic JSON convention or assume support for an external application's editable file.
5. Specify single-tile and multi-cell frame timing, tick conversion, empty frames, loop boundaries and phase when artwork is placed or revisited. Demonstrate the exact lowering to real existing game assets. If existing outputs cannot express the requirement, obtain the required runtime ADR/spec approval before implementation, rather than faking synchronized preview.
6. Define invalidation/regeneration, generated-file ownership, conflicts, per-file save results and checkpoint recovery under ADR 0022. Saving a source does not falsely claim its outputs were all saved.
7. Examples cover a roof spanning cells, layered water frames, a kitbash house with an override, terrain and three-face iso recipes, and an external odd-grid sheet. State each preserved field and every intentionally lossy exchange.
8. Owner approval of this contract is required before 22 and dependent implementation begin. Unsettled schema and timing choices remain explicit decisions for this story, not assumptions assigned to UI builders.

## Verification

The owner approves normative source and interchange contracts with worked roof, water, kitbash and external-sheet examples, preservation and recovery rules, and an explicit mapping to real runtime outputs without an unapproved format or timing assumption.

## Dependencies and decisions

Prerequisites: 27.11, 27.12. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-1 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
