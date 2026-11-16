# Player performance branch integration — 2026-11-15

The original branch `origin/claude/serene-wright-75lg8s` ends at `4194cae0b`.
It is integrated with main `3e61f3c2a` on `feat/1890-player-performance-integration`.
The spec is `docs/spec/engine/runners.md#state-hash-cadence` and `#diagnostics-mode`.
The performance-budget ADR is still a proposal; it was renumbered to 0036 because main had already used 0035.

## Corrections found during integration and independent review

- #2785: duplicate ADR number; renamed the proposal and its references.
- #2786: migrated hash fixtures to current `vm.programs`/`vm.defOwners` representation.
- #2787: default-mode overload no longer accepts a runtime-selected on-request mode as a guaranteed hash report.
- #2788: web, mobile and generated VS Code diagnostics use overlays that preserve game geometry.
- #2789: disabling mobile diagnostics restores the ordinary game title.
- #2790: enabled web diagnostics capture each frame hash before throttling report text.
- #2791: queued and in-progress advances cannot issue readers that later attach a future hash to an earlier tick.
- #2792: on-request coverage checks work performed, detecting a compute-then-omit regression.
- #2793: non-ASCII parity coverage now reuses cache lanes with different prefixes, detecting a wrong multiplier.
- #2794: the profiler passes the demo title screen before measuring walking gameplay.

Issue #1890 also requires the battle/menu test rigs to use on-request mode; those rigs and their report types were
updated. Golden and closing runners retain the default mode. No golden expectations are changed by this integration.

## Deliberate failing/passing checks

Each mutation below was applied temporarily, tested, and restored. Production code is restored after every check.
Browser runs use one worker, different local ports and settling pauses; bundles are rebuilt before each red/green run.
Ordinary new unit cases complete below one second individually. Browser proofs exercise the actual player or actual
HTML template, so their boot/layout time is not an ordinary unit-test duration.

| Evidence | Temporary fault | Expected failing result, then restored result |
|---|---|---|
| `fnv1a-transition.test.ts` | Drop the first UTF-8 byte in byte transitions | Hash mismatch; restored pass |
| `perf-budget-state-hash.test.ts` | Bypass non-ASCII segment caching | 128053 scanned bytes exceed unchanged 65536 budget; restored pass |
| `surface-hash.test.ts`, non-ASCII owner case | Construct byte transition using string length | Cached/reference hash mismatch; restored pass |
| `state-hash-on-request.test.ts` | Compute full state hash before omitting report field | On-request scan budget fails; restored pass |
| Compile-time cases in the same file | Restore unsafe `EngineInit -> Engine` overload | TS2578: expected rejection disappears; safe overload compiles |
| `diagnostics-mode.test.ts`, default flag | Default missing flag to true | Default-off assertion fails; restored pass |
| Same file, keyboard toggle | Treat F2 as the toggle | F3 assertion fails; restored pass |
| Same file, listeners | Make unsubscribe a no-op | Listener sequence differs; restored pass |
| Same file, tooling hook | Ignore false passed to the hook | Toggle-off assertion fails; restored pass |
| `diagnostics-mode.spec.ts`, live web player | Restore in-flow report | Stage bounding box changes; overlay restored pass |
| Same browser case | Remove per-frame diagnostic hash capture | Retained report hashes are empty; restored pass |
| Same browser case | Allow pending readers and omit pump invalidation | Between-advance reader returns future hash; restored pass |
| `mobile.spec.ts`, board/input/save case | Remove title restoration | Diagnostic title remains after F3; restored pass |
| Same mobile case | Restore in-flow report | Viewport bounding box changes; overlay restored pass |
| `diagnostics-mode.spec.ts`, VS Code template | Restore in-flow generated report | Stage bounding box changes; overlay restored pass |

Representative commands:

```sh
node --test packages/core/test/fnv1a-transition.test.ts
node --test packages/core/test/perf-budget-state-hash.test.ts
node --test --test-name-pattern="non-ASCII owner" packages/core/test/surface-hash.test.ts
node --test packages/core/test/state-hash-on-request.test.ts
pnpm exec tsc -p packages/core/tsconfig.test.json
node --test packages/runner-web/test/diagnostics-mode.test.ts
pnpm build
PLAYWRIGHT_PORT=4292 pnpm exec playwright test tools/browser/tests/diagnostics-mode.spec.ts --workers=1
PLAYWRIGHT_PORT=4292 pnpm exec playwright test tools/browser/tests/mobile.spec.ts --grep 'reaches a board' --workers=1
```

The generated VS Code template proof uses Chromium layout and does not claim an installed VS Code launch.
The mobile browser proof uses the existing filesystem host stub and does not claim an Android emulator/device run.

## Gameplay profile

See `tools/perf/README.md` for the machine, exact active board and before/after measurements. Corrected actual-board
profiles measured 25.9 fps on main and 39.0 fps after integration, with long tasks reduced from 54 to 4. These are
advisory single runs. Remaining rendering/surface-encoding work is tracked in #2795; it is not fixed here.

## CI follow-up: desktop audio failures (#2797)

The first PR CI run (`43798902008`) passed the unit, checks, golden, Bun and browser lanes. All three desktop input
lanes failed the existing worklet-rejection assertion: diagnostics-off mode left the audio failure invisible.
`docs/spec/engine/runners.md#diagnostics-mode` was clarified in its own commit, preserving the owner's automatic-error
visibility rule. The desktop now displays an audio-only error with diagnostics off, including after toggling F3.
The real Electron probe also counts state-hash reads while rejecting its worklet decoder and requires zero reads.

A separate local `closing:suite` run passed Node and Chromium but timed out in desktop measurement after 120 seconds,
with only a native window-move warning. This local timeout is tracked separately in #2799 and is not claimed fixed
here. CI's desktop measurement steps passed before reaching the separate audio visibility regression.
