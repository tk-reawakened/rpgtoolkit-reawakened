---
type: feature
title: "Edit complete project and game settings"
ticket: 6
status: done
---

## Scope

Cover all fields in editor-features T-10–14 including physical bindings and conflicts, 50 runtime keys, cursor hotspot/key, pathfinding, enemy pool and encounter mode, display/debug colors and plugin/menu/battle choices; distinguish effective and owning sources and use the existing `audioSettings.defaultSoundFont` persistence contract.

## Acceptance

Apply stages a document edit, Save persists and Cancel leaves unchanged; unavailable plugin data survives and no code is enabled silently; unsupported legacy values and version loss are disclosed.

## Verification

Both hosts edit and reopen representative fields in every T-10 through T-14 category while preserving unknown data and a runner loads the resulting project.

## Decisions and prerequisites

The project SoundFont uses `audioSettings.defaultSoundFont` in `docs/spec/formats/main-file.md#tkr-audio-settings-extension`; the existing reader/writer already owns its nullable and residue-preserving encoding. 11.1 may settle UI scope and ownership, not choose a competing persistence home.

Prerequisites: 11.3, 11.4 and 21.2 (the existing game-file audio-settings reader/writer and boot contract).

## Merged-state reconciliation, 2026-11-15

PR #2291 merged as `25c0b2b2bf54d228e7697847e02d53d110ebe66e` with a successful required `gate`; issue #1704 is closed. At `3e61f3c2aedd2cd86dc0c29b5ebd750f5708f7bf`, `game-settings-hosts.test.ts` passed through all three host adapters: staged representative fields in every T-10–T-14 category, save/reopen, opaque bytes and real-engine boot. The accepted representative-field proof does not claim that native action-binding editing exists; that separate control surface remains #1103.
