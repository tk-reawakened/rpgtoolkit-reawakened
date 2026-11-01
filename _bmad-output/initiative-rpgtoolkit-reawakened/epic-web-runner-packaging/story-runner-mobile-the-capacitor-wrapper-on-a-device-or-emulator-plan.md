---
title: "runner-mobile: the Capacitor wrapper on a device or emulator"
type: 'feature'
ticket: 12
created: '2026-11-01'
status: in-progress
tracker_id: "#940"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/940"
baseline_revision: '0adba2ba'
risk: 'medium'
hitl: true
context:
  - 'docs/spec/engine/runners.md#mobile (Capacitor 8.5.3; the MUST NOT)'
  - 'spine AD-17 (blob keys and GameId)'
  - 'packages/runner-web/src/player-page.ts (the shared page 9.11 extracted)'
---

# runner-mobile: the Capacitor wrapper on a device or emulator

## The line this entry stops at

The wrapper is built up to and including the **device proof**: the code is complete and an Android emulator ran the
live page, reached a board, responded to touch input, and preserved a save across a restart. Evidence is committed below.

## What is built

1. **`packages/runner-mobile/capacitor.config.json`** — `appId com.tkreawakened.player`, `appName TK Reawakened`,
   `webDir dist` (the page the build writes there).
2. **`packages/runner-mobile/src/storage.ts`** — the wrapper's whole platform surface: the same four calls the desktop
   preload exposes (`openPackage`, `readBlob`, `writeBlob`, `listBlobs`), over an injectable filesystem. AD-17's keys
   (`saves/<gameId>/…`, `files/<gameId>/…`), an escaping path refused before the platform sees it, and a base64 read
   decoded because Capacitor returns text for a binary file.
3. **`packages/runner-web/src/player-page.ts`** — the player page **extracted** so the desktop shell and the mobile
   wrapper run one implementation, which is what `runners.md#mobile`'s MUST NOT requires: a platform difference is a host
   service, never a second renderer, input path or asset source. `runner-desktop/app/player.ts` is now a thin wrapper.
4. **`packages/runner-mobile/app/player.ts`** — the mobile page: the same `bootPlayerPage`, run against the mobile host,
   with the package the app carries at `public/demo.tpk`.
5. **`tools/mobile/build.mjs`** — the page bundle, the Capacitor `webDir` (`index.html`, `apps/`, the bundled-asset list)
   and its own bundled list, so the mobile build depends on no other build.

## Provably green today

- `packages/runner-mobile/test/storage.test.ts` (4): the AD-17 save round trip, an escaping path refused (`..`, absolute,
  drive letter), a base64 read decoded, and an absent package as `null` rather than a crash.
- `tools/browser/tests/mobile.spec.ts`: the mobile page, against a Capacitor-shaped `Filesystem` stub, boots the package to
  **tick 120, state `91172695de52cfd6`, draw `9a40be8a0b5ca816`**, 128 commands, blend worst 0, frame worst 0, and writes
  its save through the same four-call host.
- The desktop and web lanes still pass after the shared-page extraction (8 browser tests).

## The hang, and what settled it

The first `mobile.spec.ts` run timed out with `window.__mobile` unset and no page error. Instrumentation first: the spec
now records `console`, `pageerror`, `requestfailed` and any `http >= 400` and dumps them on timeout, and a probe outside
the spec showed **`HTTP 404` for the page itself** — the static host's `ROOTS` did not include
`packages/runner-mobile/app`, so the page never loaded and nothing ever ran. It was not a `deviceready` race, a double
`await` or a base64 decode: the bundle was never requested. Adding the root to the host fixed it.

## The device proof (a person's, in this order)

```bash
pnpm install && pnpm build
pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo \
  --out fixtures/packages/demo.tpk --title Demo
pnpm mobile:build
cd packages/runner-mobile && npx cap sync android
cd android && ./gradlew installDebug        # a booted emulator or a connected device
```

Pass condition: the status overlay shows the demo board (`boards/start.brd` after the title screen), the player moves
after a tap/click, and a save written on the device (`saves/<gameId>/slot-1.json` inside the app's files) is restored
after a restart. The exact state hash depends on the live tick and input timing and is not asserted.

## Device-run evidence

Captured from an Android 15 x86_64 emulator with the APK built from this worktree at commit-to-be.

Initial owner observations (same emulator session) are preserved because they are the most credible acceptance evidence
in this repo today:

- **Board visible but cropped in portrait** — the 640×480 logical frame was overflowing a narrow CSS viewport; the canvas
  is now centred and letterboxed, never overflowing.
- **Click/tap landing a tile low** — pointer events were being mapped through `canvas.width/bounds.width`, but the
  shared helper now subtracts `getBoundingClientRect()` offsets and clamps to the logical frame in one place.
- **Rotation unhandled** — the page now listens to `resize`, recomputes the letterbox, and keeps the live session and
  engine state; ticks continue across rotation.

Evidence files:

- `evidence/emulator-board-entry.png` — title screen, then `boards/start.brd` at tick 6492, player at 213,146, save
  `slot-1.json` written.
- `evidence/emulator-touch-move.png` — after an `adb shell input tap 700 800`, the player moved to 254,266 (`moved: yes`).
- `evidence/emulator-key-move.png` — after d-pad arrow keys, the player moved to 304,127 (`moved: yes`).
- `evidence/emulator-save-survives-restart.png` — after `adb shell am force-stop com.tkreawakened.player` and a fresh
  launch, the save was read back (`save slot-1.json: restored+written`) and the player is at 305,178.
- `evidence/emulator-portrait-fit-after-fix.png` — portrait board fully visible and centred; tick 1528, player 213,146.
- `evidence/emulator-landscape-rotation.png` — after `adb shell content insert user_rotation=1`; tick 7361, session
  continued, player 241,210.
- `evidence/emulator-landscape-tap.png` — after `adb shell input tap 1200 600` in landscape; tick 10614, player moved to
  400,319.
- `evidence/emulator-portrait-after-rotation.png` — rotated back to portrait and tapped; tick 13758, player 400,319,
  canvas still fully visible.
- `evidence/emulator-run-summary.json` — the key numbers from the runs.

## An emulator in CI

Probably possible (GitHub's ubuntu runners can run the Android emulator when `/dev/kvm` is exposed) but **unverified here**,
and it would need a workflow change, which this account cannot push. It is not claimed.

## Out of scope

Store submission, signing, icons, splash screens and per-platform chrome; and any fork of the renderer, input path or
asset source.
