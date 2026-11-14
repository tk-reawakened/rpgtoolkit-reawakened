---
type: feature
title: "Tileset curation and single tile conversion"
ticket: 5
status: draft
risk: high
---

## Intent

Provide staged two-set curation, single-tile conversion and safe impact disclosure for indexed legacy tile references.

## Scope and acceptance

Work on copies until OK, warn that changed indices affect references and show known and unknown dynamic references; never promise a safe reorder merely from static references; use 12.2 browser rather than another model.

Native curation uses the source regions from 23 and the contracts/providers of 27.13. Presentation reorder cannot change stable references; moving source rectangles requires explicit mapping review rather than interpreting sheet position as identity. Keep native behavior distinct from legacy numeric-index operations. Known uses and uncertain script references remain separately labelled.

## Verification

Tests cover wildcard GPH import, export, duplicate removal, insert/delete/blank/move/reorder, display width, supported TST and ISO transfer directions, cancel and reopened rendered indices.

For native assets, reorder, duplicate and transfer entries used by a board, stamp and animation, then reopen and prove those references still name the intended artwork. Cancel and a refused output write preserve source and report per-file state through the existing recovery contract.

## Dependencies and decisions

Prerequisites: 4, 23, 27.13, 12.16. Apply the epic Notes and existing format, document, history and host-service contracts; T-38 maps to CAP-16. Do not replace the 12.2 browser, 12.16 scene editor or Epic 27's reader/writer/checker.
