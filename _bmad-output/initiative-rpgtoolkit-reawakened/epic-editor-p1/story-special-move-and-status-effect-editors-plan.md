---
type: feature
title: "Special move and status effect editors"
ticket: 10
status: draft
risk: high
---

## Intent

Edit linked SPC and STE definitions including use contexts, signed damage and costs, status duration and changes, programs, animation and descriptions.

## Scope and acceptance

Follow battle-data.md for raw usable-byte mapping and avoid claims about unspecified zero-duration or plugin-specific rules; preserve unsupported provider data.

## Verification

Each format opens, edits, saves, reopens and loads through the chosen real battle provider using an authored enemy fixture (no enemy-editor UI required) with correct inverted usability flags, signed values and preserved untouched fields.

## Dependencies and decisions

Prerequisites: 13.1 (shared registration/lifecycle seam), 2.7 (battle formats) and 11.6 (settings/reference support). The owner's 12/13-before-29/30 sequence replaces the former enemy-editor prerequisite with independently authored enemy fixtures and the existing real battle provider. This story remains in Epic 13; 29.6 later consumes its actual linked editors. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-57, T-58 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.
