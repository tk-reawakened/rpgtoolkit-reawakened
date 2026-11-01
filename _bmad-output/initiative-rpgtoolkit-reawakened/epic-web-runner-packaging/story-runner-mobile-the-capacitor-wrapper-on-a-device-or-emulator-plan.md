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

The implementation is incomplete. The current shared page is a closing-suite measurement: it advances a scripted
run to tick 120 and renders into a detached canvas. It does not provide a visible, interactive game loop. A passing
browser stub is not native-device evidence; this ticket remains in progress and its PR remains draft.

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
   with the package the app carries at `public/game.tpk`.
5. **`tools/mobile/build.mjs`** — the page bundle, the Capacitor `webDir` (`index.html`, `apps/`, the bundled-asset list)
   and its own bundled list, so the mobile build depends on no other build.

## Provably green today

- `packages/runner-mobile/test/storage.test.ts` (4): the AD-17 save round trip, an escaping path refused (`..`, absolute,
  drive letter), a base64 read decoded, and an absent package as `null` rather than a crash.
- `tools/browser/tests/mobile.spec.ts`: the mobile page, against a Capacitor-shaped `Filesystem` stub, boots the package to
  **tick 120, state `bff947dce3a11b4f`, draw `9a40be8a0b5ca816`**, 128 commands, blend worst 0, frame worst 0, and writes
  its save through the same four-call host.
- The desktop and web lanes still pass after the shared-page extraction (8 browser tests).

## The hang, and what settled it

The first `mobile.spec.ts` run timed out with `window.__mobile` unset and no page error. Instrumentation first: the spec
now records `console`, `pageerror`, `requestfailed` and any `http >= 400` and dumps them on timeout, and a probe outside
the spec showed **`HTTP 404` for the page itself** — the static host's `ROOTS` did not include
`packages/runner-mobile/app`, so the page never loaded and nothing ever ran. It was not a `deviceready` race, a double
`await` or a base64 decode: the bundle was never requested. Adding the root to the host fixed it.

## Device proof

The previous device recipe was not verified and is withdrawn. A clean checkout must first fetch the sample fixtures
with `pnpm fixtures:fetch`; `pnpm mobile:build` creates `dist/public` for the package. Native packaging and a real,
visible demo run still need to be exercised before a device recipe can be presented as a working acceptance procedure.
Acceptance requires a person to confirm the demo reaches the board on a device or emulator and the tick-120 state hash
matches `bff947dce3a11b4f` (issue #940).

## An emulator in CI

Probably possible (GitHub's ubuntu runners can run the Android emulator when `/dev/kvm` is exposed) but **unverified here**,
and it would need a workflow change, which this account cannot push. It is not claimed.

## Out of scope

Store submission, signing, icons, splash screens and per-platform chrome; and any fork of the renderer, input path or
asset source.
