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
  - 'packages/runner-web/src/live-session.ts (shared live session)'
---

# runner-mobile: the Capacitor wrapper on a device or emulator

## The line this entry stops at

The code runs a live page on an Android emulator, but the captured evidence does not yet establish device acceptance.
The story remains open for a coherent, person-confirmed device run with evidence for the title, tap, rotation and save.

## What is built

1. **`packages/runner-mobile/capacitor.config.json`** — `appId com.tkreawakened.player`, `appName TK Reawakened`,
   `webDir dist` (the page the build writes there).
2. **`packages/runner-mobile/src/storage.ts`** — the wrapper's whole platform surface: the same four calls the desktop
   preload exposes (`openPackage`, `readBlob`, `writeBlob`, `listBlobs`), over an injectable filesystem. AD-17's keys
   (`saves/<gameId>/…`, `files/<gameId>/…`), an escaping path refused before the platform sees it, and a base64 read
   decoded because Capacitor returns text for a binary file.
3. **`packages/runner-web/src/live-session.ts`** — the shared live session used by the browser, desktop and mobile pages.
4. **`packages/runner-mobile/app/player.ts`** — the mobile page creates a `createLiveSession` against the mobile host,
   with the package the app carries at `public/demo.tpk`. `bootPlayerPage` is the separate measurement path.
5. **`tools/mobile/build.mjs`** — the page bundle, the Capacitor `webDir` (`index.html`, `apps/`, the bundled-asset list)
   and its own bundled list, so the mobile build depends on no other build.

## Provably green today

- `packages/runner-mobile/test/storage.test.ts` (5): the AD-17 save round trip, escaping paths refused, base64 decoding,
  recursive `listBlobs`, and an absent package as `null`.
- `tools/browser/tests/mobile.spec.ts` exercises a live session against a Capacitor-shaped `Filesystem` stub: board
  entry, input and save writes, plus viewport resizing. It does not assert a fixed tick-120 hash.

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

The recorded summary identifies an Android 15 x86_64 emulator, not a Pixel 3a API 33. These captures use a modified
no-startup-program package and report live ticks and hashes; they do not show a tick-120 golden or the demo title.

Initial owner observations (same emulator session) are preserved because they are the most credible acceptance evidence
in this repo today:

- **Board visible but cropped in portrait** — the 640×480 logical frame was overflowing a narrow CSS viewport; the canvas
  is now centred and letterboxed, never overflowing.
- **Click/tap landing a tile low** — the owner reported this; the shared pointer helper maps through the canvas
  bounding rectangle and clamps to the logical frame. The captures below do not establish the targeted tile.
- **Rotation unhandled** — the page now listens to `resize`, recomputes the letterbox, and keeps the live session and
  engine state; ticks continue across rotation.

Evidence files:

- `evidence/emulator-board-entry.png` — `boards/start.brd` at tick 6492, player at 213,146, save `slot-1.json` written;
  no title screen is shown.
- `evidence/emulator-touch-move.png` — after an `adb shell input tap 700 800`, the player moved to 254,266 (`moved: yes`).
- `evidence/emulator-key-move.png` — after d-pad arrow keys, the player moved to 304,127 (`moved: yes`).
- `evidence/emulator-save-survives-restart.png` — after `adb shell am force-stop com.tkreawakened.player` and a fresh
  launch, the save was read back (`save slot-1.json: restored+written`) and the player is at 305,178.
- `evidence/emulator-portrait-fit-after-fix.png` — portrait board fully visible and centred; tick 1528, player 213,146.
- `evidence/emulator-landscape-rotation.png` — tick 7361, status reports player 341,210 and the player square is visible.
- `evidence/emulator-landscape-tap.png` — after a landscape tap, tick 10614, status reports player 400,319; the player
  square is not visible, so the image does not prove a correct landing or rule out a rendering defect.
- `evidence/emulator-portrait-after-rotation.png` — tick 13758 after rotation and a tap, status reports player 400,319;
  the player square is not visible, so the image does not establish where the tap landed.
- `evidence/emulator-run-summary.json` — the key numbers from the runs.

## An emulator in CI

Probably possible (GitHub's ubuntu runners can run the Android emulator when `/dev/kvm` is exposed) but **unverified here**,
and it would need a workflow change, which this account cannot push. It is not claimed.

## Out of scope

Store submission, signing, icons, splash screens and per-platform chrome; and any fork of the renderer, input path or
asset source.
