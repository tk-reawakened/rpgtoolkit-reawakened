---
title: "Cancelable beforePlay for script and engine-originated audio"
type: 'feature'
ticket: 4
created: '2026-10-22'
status: 'ready-for-dev'
baseline_revision: 'c339264d808b6964c504f3ec4c0588a6c782b96'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - 'docs/guardrails.md'
  - 'docs/spec/engine/audio-media.md#media-3'
  - 'docs/spec/engine/audio-media.md#audio-core-pins'
  - 'docs/spec/engine/audio-media.md#audio-cue-contract'
  - 'docs/spec/engine/audio-media.md#r-59-routing'
  - 'docs/spec/engine/rpgcode-modules-and-objects.md#emit-11'
  - 'docs/spec/engine/rpgcode-modules-and-objects.md#emit-13'
  - 'docs/spec/engine/rpgcode-modules-and-objects.md#emit-16'
  - 'docs/spec/engine/rpgcode-errors-and-threads.md#err-2'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/discovery/step-budget-spike.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem.** MEDIA-3 (owner-approved, `audio-media.md#media-3`) rules one cancelable `beforePlay` on `media` in front of *every* attempted voice start, with `source` one of `script`, `board`, `animation`, `battle`, `menu`, `video`, and with `file`, `volume` and `loop` mutable. Nothing implements it. The audio applier (`audio/runtime.ts::applyEffect`) starts a voice the moment an effect record reaches it, and three engine producers plus the script pack all reach that applier. The Epic 21 draft of this ticket assumed one dispatch "inside the audio phase (Assumption A-3)"; that is wrong in two ways found in review: the audio phase is not where all starts apply (`EffectBus.dispatchRecorded` calls the applier synchronously from the producing phase, `engine/effects.ts`), and the engine already has a non-parking engine-phase cancelable dispatcher (`events/dispatch.ts::runEngineCancelableEvent`, EMIT-11) whose failure path is a *diagnostic plus a killed listener*, not the catchable runtime error MEDIA-3 requires.

**Approach.** Put one gate in front of the applier's start path, used by both producer routes (`media.play` for script and legacy aliases, `music.play`/`sfx.play` for board, animation, battle, video and menu). The gate maps the producer's effect to the ruled `source` enum, builds the ruled detail, and decides:

1. **No `beforePlay` listener** — return the request unchanged and create *nothing*: no event object, no emitter registration, no handle, no new state field. The cue stream, the effect log, the state hash and every Epic 6 golden are then byte-identical.
2. **Engine-originated start** (the applier was called from an engine phase, so `ctx.thread === null` and no dispatch is in progress) — dispatch **inside the originating phase**, with the existing `runEngineCancelableEvent` machinery extended to report the mutated detail and a discriminated result. A listener that waits is a catchable runtime error raised into that listener's thread (ERR-2), the dispatch continues with the next listener in registration order, and the operation's outcome is decided by the rules below.
3. **Ordinary script-thread start** — queue the event in the one `events` queue (`queueNativeEvent(..., cancelable = true)`), record a saveable pending-start row, and park the calling thread on a new `media.beforePlay` wait. The applier applies the start from the row once the dispatch completes; the caller then receives the authoritative voice identity, or `null` when a listener cancelled. Accepted mutations are used by that start.

Every start still applies through the applier (`runtime.startVoice`), so no route can bypass the gate, and no second dispatch mechanism appears: queued delivery is the existing `events` phase, inline delivery is the existing EMIT-11 helper.

**Order of work.** Docs-first, in its own commit before any code (G7 rule 4): amend `audio-media.md#media-3` with the provisional-identity clarification, the source-provenance table, the same-file no-op rule and the catchable-error wording; add the `beforePlay` row to `rpgcode-modules-and-objects.md#emit-13` (EMIT-13 requires the row). Then the gate, the applier integration, the wait/continuation seam, the engine wiring, the tests and the budget measurement.

## Boundaries & Constraints

**Always:** G1–G7. Dispatch state and every pending record are plain JSON with explicit `null`, no `undefined` (`AssertPlainData`); all timing is the fixed 60 Hz tick (`audio-time-model`); core owns the decision, the runner never reports one; the one bus, one listener table, one queue and one dispatch cursor (EMIT-7, EMIT-10, EMIT-15) are reused; listener order is registration order and delivery order is queue order; the docs-first commit lands before code; every changed behaviour cites the `docs/` section it implements.

**Never:** Add a second emitter, queue, dispatcher or cursor; park an engine phase; run a listener synchronously from inside a producer (EMIT-7/EMIT-16); register the `media` emitter or create an event object when no `beforePlay` listener exists (it would move every audio state hash); change the recorded shape of `music.play`/`sfx.play`/`media.play` effect args for existing producers; change cue kinds, cue order, cue ids, phase order or wake ticks for any world without a `beforePlay` listener; add a second audio state section or change `AudioStateV2`; implement 21.5 (voice objects) or 21.6 (retirement) here; touch `docs/spec` in *this* plan commit (the docs-first edit is the implementation pass's first commit, after #484 merges, to avoid conflicting edits to `audio-media.md`); open `../rpgtoolkit` or translate GPL source.

**Seams that must exist before this ticket builds:** #484/21.5's `media.play` path must be the one that posts the effect and reads the applier's synchronous outcome (its `MediaScriptService.play` → `bus.postEffect` → `AudioPlayResult`, per that plan's Design Notes). Both `after` dependencies are merged (`464d0aa3` 21.3, `0a31bd59` 19.11). If 21.5's service is not yet in the tree, the same seam is reached through `script/packs/media.ts`'s effect list plus a VM control action; the ticket is not buildable without one of the two, and this is recorded as a build precondition, not a scope cut.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| No listener | Any start, `events.listeners` has no `media`/`beforePlay` entry | Request used unchanged; no event object, no emitter registration, no pending row, no extra VM steps; cue stream and state hash identical to `c339264d` | No error |
| Board music cancelled | `postBoardMusic` posts `music.play`, listener calls `cancel()` | No voice, no `media.play` cue, `audio.cueId` unchanged, previous music keeps playing and is not displaced | No error |
| Frame sound volume | `sfx.play` source `frame`; listener sets `detail.volume = 50` | Voice starts with `volume` 50; `media.play` cue carries `volume: 50`; `started` notification reports the same voice | No error |
| Battle track replaced | `music.play` source `battle`; listener sets `detail.file` | The replaced file's length is looked up and the voice starts on `music` with the new key | `asset.missing` / `media.asset-format` as today, never a crash |
| Menu cue | `sfx.play` source `ui` | `source` is `menu`; starts on `ui`; script-thread caller parks, engine caller dispatches inline | No error |
| Video music change | `music.play` source `video` (posted in `waits`) | `source` is `video`; dispatch runs in `waits`; accepted mutations apply before the restart | No error |
| Script start, allowed | `mediaplay`/`mediaPlay` with a listener that mutates `volume` | Caller parks on `media.beforePlay`, wakes next tick with the voice object (21.5) or `null` today; start used the mutation | No error |
| Script start, cancelled | Listener calls `cancel()` | `mediaPlay` returns `null`; no start, no cue, no `cueId` consumed; legacy `tkMD_WAIT` never parks on `audio.track` | No error |
| Same-file no-op | `music` playing `x`; script asks for `x` on `music` | No `beforePlay` (no voice start is attempted); today's carry-on/ignore note and cue stream | No error |
| Explicit restart | Same file with `restart`/`tkMD_RESTART` | `beforePlay` is emitted; a cancel leaves the running voice untouched | No error |
| Slot steal | Every slot active, lowest-priority victim | `beforePlay` runs *before* any stop; on allow the victim is stolen at application; on cancel nothing is displaced | No error |
| Invalid mutation | `detail.volume = 140`, `detail.file = 7`, `detail.loop = "yes"` | One located `media.beforeplay-value` naming the field; that field keeps its pre-dispatch value; the start still applies | Diagnostic, no throw to the script |
| Asset unknown after mutation | Listener replaces `file` with a name not in the index | Requested value is used only if it resolves; otherwise `media.beforeplay-value` and the pre-dispatch file | Diagnostic |
| Asset pending | Accepted file's length unknown | Effect held in `engine.pendingEffects.audio` (existing order); the decision is **not** re-dispatched; `need` asks for the bytes | `asset.missing` / `media.asset-format` as today |
| Engine listener waits | Listener yields any wait during an engine-phase dispatch | Catchable `media.beforeplay-wait` raised into that listener's frame (ERR-2: handler may take it; otherwise reported and the thread ends); dispatch continues with the next listener; the start applies unmutated and one located diagnostic records the refusal | Catchable error |
| Engine listener overruns | Listener still running when the dispatch budget is spent | Catchable `media.beforeplay-budget`, same path; dispatch continues | Catchable error |
| Another dispatch active | `events.dispatch !== null` when an engine start reaches the applier | Start held (`defer`); a second diagnostic-free retry dispatches it inline at the next `events`/`audio` retry; no event is lost, no order is changed | No error |
| Listener starts audio (own event) | A `beforePlay` listener calls `mediaPlay` | Catchable `media.beforeplay-reentrant`; that call starts nothing; the listener's own delivery is unaffected | Catchable error |
| Listener starts audio (another event) | A listener of `entered`, `talked`, etc. calls `mediaPlay` | `beforePlay` is queued and the start is held; the listener does not park and receives the unbound voice object; the start commits after its own dispatch settles | No error |
| Save mid-dispatch | Snapshot between two listeners, or while the caller waits | Restore finishes the same dispatch, applies the same start, produces the same cues and the same voice identity | No refused load |
| Emitter never used | World never registers `media` | No `events.emitters`, no `beforePlay` row, no `nativeDetails`, identical hash | No error |

</frozen-after-approval>

## Code Map

**Docs (own commit, before code).**

- `docs/spec/engine/audio-media.md#media-3` — append one marked block: `Proposed clarification (pending owner review; MEDIA-3; provisional identity, provenance and refusals)`. It states (a) `slot` is the allocation *candidate* and `cueId` is the then-current next-unused counter value, a proposal snapshot that is neither reserved nor consumed, revalidated at application, with `started` authoritative; (b) the producer→`source` table below; (c) a same-file carry-on/ignore is not an "attempted voice start", so no event; (d) a dispatch that cannot complete inside the engine phase leaves the start unmutated and one located diagnostic; a listener that waits or overruns is the named catchable error; (e) a `beforePlay` listener may not start audio on that event; (f) a script start parks on a new `media.beforePlay` wait until its start is applied, and the request's own `wait` option then uses the existing `audio.track` wait. Keep the approved ruling text unchanged.
- `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13` — add the standard-event row: `beforePlay` | `media` | yes | `source`, `track`, `slot`, `cueId`, `file`, `volume`, `loop` | 21.4, citing `audio-media.md#media-3`.
- No edit to `rpgcode-errors-and-threads.md`: ERR-2's table is category-level and the new codes are defined at the rule site, like every existing `media.*` code.

**Core, new.**

- `packages/core/src/audio/beforeplay.ts` — the gate and its plain-data types:
  - `BeforePlaySource = "script" | "board" | "animation" | "battle" | "menu" | "video"`.
  - `BeforePlayRequest = { source, track, slot, cueId, file: AssetKey, volume: integer, loop: boolean }`.
  - `BeforePlayOutcome = { kind: "allow", file, volume, loop } | { kind: "cancel" } | { kind: "defer", seq } | { kind: "refuse", code }`.
  - `sourceOf(effectName, producerTag)` — the mapping table (Design Notes 2), total for the five existing producers.
  - `hasBeforePlayListener(state)` — `state.events.listeners.some((l) => l.emitter === MEDIA_EMITTER && l.type === "beforePlay")` (uses `listenerCoversEmitter` so a future prefixed key cannot be missed).
  - `dispatchBeforePlay(state, services, request, ctx)` — engine/inline route and script/queue route (Design Notes 3).
  - `readDecision(state, event)` — reads `canceled` and the `detail` members **directly** (`findObject` + `readMember`), never `readEvent`, and validates `file`/`volume`/`loop`.
  - `BeforePlayPending` (the row type of Design Notes 5) and its helpers `addPending`, `findPending(seq)`, `settlePending` (dispatches or reads a completed dispatch and validates the mutations), `prunePending`; the `engine.beforePlay` list accessor. One file, so the gate, the row and its validation cannot drift.

**Core, changed.**

- `packages/core/src/audio/runtime.ts` — `AudioRuntimeOptions` gains `beforePlay?: (request, ctx) => BeforePlayOutcome`; `StartOptions` gains `volume` and `source`; `startVoice` (line ~333) writes `voice.volume` and the `media.play` cue's `volume` from `StartOptions` instead of the hard-coded `100`, and takes the decide-then-start path; `allocate` (line ~318) gains a pure sibling `peekAllocation(track)` returning the slot a start *would* take without mutating; `applyEffect` (line ~411) gains the gate call in exactly two places — the `media.play` branch and the `music.play`/`sfx.play` branch — with the same-file/`asset === null` short-circuits before the gate; `retry` (line ~553) settles pending rows before re-applying; `phase` (line ~633) settles and prunes at its head; `AudioPlayResult` gains a `beforeplay` variant carrying `seq`.
- `packages/core/src/engine/engine.ts` — build the gate and pass it to `createAudioRuntime` (line ~268); call `audio.retry()` after `runEventsPhase` in the `events` phase (line ~1340); add the pending row's event handles to the `time` phase's `collectStateGarbage` extra roots (line ~1345); expose the pending projection in `phaseView()` (line ~1225); map `board.key`/`frame`/`video`/`battle`/`ui` tags where the producers are (`postBoardMusic` line ~841, `runAnimationPhase` line ~1285, the video restart line ~1329).
- `packages/core/src/events/dispatch.ts` — split `runEngineCancelableEvent` (line ~135) into `runEngineCancelableEventDetail(...) : { kind: "allowed" | "canceled" | "busy" | "refused"; code?; detail?; steps }` plus the existing boolean wrapper, so `beforeEnter`'s behaviour and diagnostics are byte-identical; the `wait`/budget branches call the new catchable-error path instead of `killThread` alone; `runEventsPhase` and the detail helper return the VM steps they consumed (`budget - remaining`, a number already computed today) so a test can measure a dispatch without instrumenting the VM; add a `BEFORE_PLAY_STEP_BUDGET` constant (measured, default `STEP_BUDGET`).
- `packages/core/src/script/vm.ts` — extract `handleFailure`'s (line ~1044) frame-application body into `applyFailure(thread, vm, services, frame, program, statementIp, error)`; add `raiseIntoThread(thread, vm, services, error)` that clears `thread.wait`, sets `status = "ready"` and applies the error at the call's statement, reporting and emitting the `game` `error` event exactly as ERR-2/EMIT-9 rule; `resolveWait` (line ~399) honours `then` for **named** waits as it already does for `request`/`blob`.
- `packages/core/src/script/waits.ts` — `pollMediaBeforePlay(view, wait)` added to `WAIT_KIND_RESOLVERS` (line ~186): payload `[seq]`; resolves when the row exists with `decision` `allowed`/`canceled` **and** `applied === true`; value is the bound voice handle or `0`.
- `packages/core/src/ports/wait.ts` — `NamedWaitKind` gains `"media.beforePlay"`; `NamedWait` gains `then?: WaitContinuation | null` (present only when chained, like `InputKeyWait.parkSeq`); `WaitView` gains `beforePlay?: readonly BeforePlayView[]`.
- `packages/core/src/script/packs/media.ts` — `mediaplay` and 21.5's `mediaPlay` return the `media.beforePlay` wait with `then: { command: "mediaplaydecide", args: [seq] }`; add the internal `mediaplaydecide` command (`doc.access: "internal"`, the 21.5 convention) that returns the voice value, or the `audio.track` named wait when the request asked to wait, and never resolves to an audio start by itself.
- `packages/core/src/save/sections/engine.ts` — `beforePlay?: BeforePlayPending[]` on `EngineSection`, absent when empty (the `pendingEffects`/`video` precedent), so `AudioStateV2` and the audio hash are untouched.
- `packages/core/src/save/snapshot.ts` — validate the new field and the new wait kind: row `seq` a positive integer, `event` a live object handle, `thread` a live thread id in a `media.beforePlay` wait, `decision` in the allowed set, `slot`/`cueId` non-negative integers or `null`, `file` a string, `volume` 0–100, `loop` a boolean.
- `packages/core/src/audio/events.ts` — no change expected; `queueAudioEvent` remains the only `started` producer, and it is now called only from a committed start.

**Tests.**

- `packages/core/test/beforeplay-gate.test.ts` — mapping table, fast path, mutations, validation, cancellation, same-file and `asset === null` short-circuits.
- `packages/core/test/beforeplay-engine.test.ts` — board, animation, video, battle and menu sources; inline dispatch in the originating phase; `busy` defer; wait and budget refusals as catchable errors; `beforeplay-reentrant`.
- `packages/core/test/beforeplay-script.test.ts` — park/wake, cancel→`null`, mutation→cues, `tkMD_WAIT` chaining, `mediaPlay` voice identity.
- `packages/core/test/beforeplay-replay.test.ts` — a `media.beforePlay` listener must not change the ruling's cues, so the suite pins cue streams with and without listeners, plus snapshot/restore at every tick (between listeners, during the wait, after a defer, after an asset stall) with hash and event-history equality.
- `packages/core/test/beforeplay-budget.test.ts` — the measurement task (Design Notes 9).
- Existing suites that must stay green unchanged: `audio-runtime`, `audio-engine`, `audio-events`, `audio-lifecycle-{runtime,engine,replay}`, `audio-restore`, `audio-scenes`, `events-{emitter,cancelable,game}`, `engine-edges` (its `runEngineCancelableEvent` assertions), `golden/audio/cues.json`, `golden/scenes/**`, `golden/closing`.

## Tasks & Acceptance

**Execution.**

- [ ] Docs-first commit: `audio-media.md#media-3` clarification block and the `#emit-13` `beforePlay` row (Code Map). `git log` must show it before the first code commit.
- [ ] `audio/beforeplay.ts` — source mapping, listener probe, detail construction (folded keys), decision reading and validation, `BeforePlayPending` helpers.
- [ ] `audio/runtime.ts` — gate calls at the two start branches, `peekAllocation`, `volume`/`source` through `StartOptions` into the voice and the `media.play` cue, `beforeplay` play result, settle/prune hooks.
- [ ] `events/dispatch.ts` + `script/vm.ts` — `runEngineCancelableEventDetail`, the `busy`/`refused` split, `raiseIntoThread`/`applyFailure`, named-wait `then`.
- [ ] `ports/wait.ts`, `script/waits.ts`, `save/sections/engine.ts`, `save/snapshot.ts` — the wait kind, the resolver, the row and its validation.
- [ ] `script/packs/media.ts` — `media.beforePlay` wait with the `mediaplaydecide` continuation; internal command registration.
- [ ] `engine/engine.ts` — gate wiring, `retry` after `events`, GC roots, `phaseView` projection.
- [ ] Tests and the budget measurement; then `pnpm golden`, `pnpm golden:bun` and `pnpm closing` to prove no golden moved.

**Acceptance Criteria.**

- Given a world with no `beforePlay` listener, when any script, board, animation, video, battle or menu start runs, then the cue stream, the effect log, the state hash after every tick and every Epic 6 golden are identical to `c339264d`, and the gate adds no object, no listener, no pending row and no VM steps.
- Given a listener that cancels board music, when the board arrives, then no voice starts on `music`, no `media.play` cue is emitted, `audio.cueId` is unchanged, the previous track state is untouched, and no `started` notification is emitted (MEDIA-2 emits notifications only for an applied start).
- Given a listener that halves a frame sound's volume, when an `.anm` frame with a sound becomes visible, then the `sfx` voice stores `volume: 50`, the `media.play` cue carries `volume: 50`, and the `started` detail names the same slot and cue id as the cue.
- Given a listener that replaces a battle track's file, when the battle posts `music.play`, then the replacement is resolved and started on `music`, and a replacement that does not resolve leaves the original file with one `media.beforeplay-value`.
- Given a script call and an engine call, when both reach the same listener, then the listener runs in registration order within its own dispatch, an engine start's dispatch happens inside its originating phase (`engine.phase` is the producer's phase throughout), and a script start's caller resumes with the authoritative voice or `null`.
- Given a listener that waits during an engine-originated dispatch, when the wait is entered, then the listener's own `setErrorHandler` label can take `media.beforeplay-wait`, the dispatch continues, the start applies unmutated, and the phase did not park.
- Given a save at every tick, including between two listeners and while the caller waits, when the save is restored, then the dispatch finishes, the same start applies, the cue stream, the voice identity and every later state hash match the unsaved run.
- Given eight one-statement listeners, when the measurement runs on both routes, then the recorded dispatch cost is inside the 19.2 headroom and no start costs two dispatches (Design Notes 9 lists the bounds the test asserts).
- Given every `after` dependency and the docs-first commit, when the gates run, then typecheck, lint, golden, Bun golden, closing, graph, licence, provenance, catalogue and command-docs pass with no golden file changed by this ticket.

**Ticket-verify coverage.** The store's `verify` string is satisfied clause by clause: *cancel board music / halve a frame sound / replace a battle track with the ruled cues* → acceptance 2–4; *a script call and an engine call reach the same listener in registration order* → acceptance 5; *dispatch cost within the 19.2 headroom* → acceptance 8; *a save mid-dispatch restores and finishes with the same hash* → acceptance 7; *with no listener the cue stream and every Epic 6 golden are unchanged* → acceptance 1 and the golden commands. Nothing is narrowed.

## Design Notes

### 1. Provisional identity (director decision, adopted)

**Proposed ruling (pending owner review; MEDIA-3 detail identity).** In `beforePlay`'s detail, `slot` is the allocation candidate at dispatch creation — the slot the start *would* take, computed by a pure `peekAllocation(track)`: the lowest free index, else the steal victim's index by `(priority, startTick, index)` — and `cueId` is the then-current value of `audio.cueId`, the next unused counter. Both are a **proposal snapshot**: neither is reserved, neither is consumed, and a listener may not rely on them as the future voice's identity. After the dispatch, the applier revalidates allocation against the current state (a listener's own nested start or another effect may have taken the slot) and assigns the real identity at application: `startVoice` allocates and `emit("media.play", …)` takes the counter. The `started` notification carries the authoritative `slot`/`cueId`. Cancellation leaves existing playback and the counter untouched; a cancelled start consumes no cue id. *Evidence:* MEDIA-3 rules the field list and cancellation semantics but not the identity timing; `allocate` (`audio/runtime.ts:318`) mutates by stopping a victim, so a pre-dispatch call would displace on a cancel; `emit` (`runtime.ts:241`) increments the counter as a side effect; MEDIA-2's `started` detail exists precisely to carry the applied identity. *Rejected alternatives:* (a) committing the identity at dispatch creation, which requires a reservation policy or serializing starts against listeners — a policy the owner has not ruled and a second source of truth for `cueId`; (b) dropping `slot`/`cueId` from `beforePlay` and keeping them only in `started`, which removes ruled fields and makes "which voice will this be" unanswerable to a listener that wants to preload or pre-mix.

### 2. Producer → `source`, and provenance through retries

| Producer (file, function) | Effect | Tag today | `beforePlay` `source` | Track |
|---|---|---|---|---|
| `engine.ts::postBoardMusic` | `music.play` | `board.key` | `board` | `music` |
| `engine.ts::runAnimationPhase` | `sfx.play` | `"frame"` | `animation` | `sfx` |
| video restart (`engine.ts` `waits` branch) | `music.play` | `"video"` | `video` | `music` |
| Epic 7 battle producer (unbuilt) | `music.play` | `"battle"` | `battle` | `music` |
| Epic 8 menu / battle-menu (unbuilt) | `sfx.play` | `"ui"` | `menu` | `ui` |
| `script/packs/media.ts` + legacy aliases (`mediaplay`, `midiplay`, `playmidi`, `wav`, `mp3`, `mp3pause`) | `media.play` | — | `script` | named track |

The mapping is a total function on the tags that exist (`audio-media.md#r-59-routing`'s routing table is its evidence), it needs **no producer change** and therefore no effect-log or hash churn: `music.play` maps `"video"`→`video`, `"battle"`→`battle`, every other string→`board` (the tag *is* the board key); `sfx.play` maps `"ui"`→`menu`, `"frame"`→`animation`; `media.play` always maps `script`. An `sfx.play` tag outside that set — which no producer emits — is `audio.effect` `{ reason: "unknown source tag" }` and the start is skipped, matching how every other malformed audio effect is handled. The `source` value is decided once, when the request is built, and stored in the pending row, so a retry (dispatch defer, asset stall, restore) re-emits exactly the same `source` and never re-derives it from a mutated field.

### 3. Dispatch composition (three contexts, one decision)

`ctx` is `{ thread: number | null, inDispatch: boolean }`, supplied by the caller: `null`/`false` from the applier when no VM step is running (engine phase), the calling thread's id from the script route, and `inDispatch: true` when `ctx.thread === state.events.dispatch?.thread` (the start was made by a listener thread).

- **Engine phase (`thread === null`)**: `registerEmitter(vm, events, MEDIA_EMITTER)` — idempotent, and a `beforePlay` listener under that key implies the object already exists because `on` had to be called on it (21.3 registers it on the first transition, 21.5 on first access) — then `runEngineCancelableEventDetail(state, services, "media", "beforePlay", detail, BEFORE_PLAY_STEP_BUDGET)`. `allowed`→read and validate the mutated detail → `allow`; `canceled`→`cancel`; `busy`→`defer`; `refused`→`refuse`.
- **Ordinary script thread**: register the emitter if needed, `queueNativeEvent(..., "beforePlay", detail, true)`, create the pending row (request values, `decision: "dispatching"`, `thread` = the caller), return `defer`. The applier then returns `pending` and holds the effect; the queue delivers the event in this tick's `events` phase when the start came from `input`/`waits`/`threads` (EMIT-14), otherwise in the next tick's. `audio.retry()` at the `events` phase tail settles the row (reads the detail, stores the decision) and re-applies the held effect, which starts the voice and binds the voice identity; the caller wakes at the next `waits` phase — EMIT-16's one-tick latency, unchanged.
- **From a listener thread (`inDispatch`)**: the same queue-and-defer as the script route, but `thread: null` — the listener must not park (its own delivery waits for it: EMIT-18's deadlock, and waiting inside any delivery is what `media.beforeplay-wait` already forbids on the engine route). The call returns the unbound voice object, the shape 21.5 already defines for a start whose length or asset is not yet known, and the start commits when the row settles. The inline helper is never entered with the cursor busy, so no second cursor and no nested dispatch exist.
- A start **from a listener of a `beforePlay` event** is `media.beforeplay-reentrant`: it would queue an event whose listener starts audio again, an unbounded queue growth the budget cannot stop. This mirrors EMIT-18's reasoning for `emitCancelable` inside a listener and keeps the cursor single (EMIT-15's shape is untouched).

`defer` is therefore the only case that stores a row outside an outright cancellation, and it is entered exactly when a dispatch or a listener's own delivery makes an inline decision impossible: waiting is the only order-preserving answer, and no event is dropped.

### 4. Refusals: catchable, not fatal, and fail-open for the start

MEDIA-3 requires "a catchable runtime error" for a listener that would wait; today `runEngineCancelableEvent` reports `event.wait-forbidden` / `event.budget-exceeded` and kills the listener, which is not catchable. The split: those two branches call `raiseIntoThread(thread, …)` with `media.beforeplay-wait` / `media.beforeplay-budget`, so ERR-2 runs — the failing frame's label handler may take it, otherwise the failure is reported, the `game` `error` event is queued with `handled: 0`, and the thread ends; the dispatcher continues in registration order. The gate then reports `refuse`, and the applier **applies the start as requested** (unmutated) plus one located diagnostic. *Why fail-open:* cancellation is the only mechanism MEDIA-3 grants a listener for suppressing a start, and a listener that could not finish has not cancelled; `beforeEnter`'s fail-closed answer is right for a world step but would let one broken listener silence the whole game's audio. *Rejected alternatives:* fail-closed (a listener bug becomes total audio loss); honouring partial results from a refused dispatch (a cancel that could not be validated, and non-deterministic depending on where the budget fell); keeping the silent kill (violates the ruled catchable error and hides the bug from the script that wrote the listener).

### 5. Saveable pending start and result

`EngineSection.beforePlay?: BeforePlayPending[]`, absent when empty, appended in creation order:

```
BeforePlayPending = {
  seq: integer,            // the held effect's EffectRecord.seq, its identity for retries
  thread: integer | null,  // the parked script caller; null when nothing parks (engine phase, listener thread)
  source: string,          // fixed at request time (Design Notes 2)
  track: string,
  file: AssetKey,
  volume: integer,
  loop: boolean,
  event: integer | null,   // the cancelable event object while dispatching/decided
  decision: "dispatching" | "allowed" | "canceled",
  applied: boolean,        // the start ran (allowed) and its identity is in slot/cueId
  slot: integer | null,
  cueId: integer | null
}
```

It lives in the engine section, not `AudioStateV2`, because the existing asset-held effects already live there ("the applier's pending queue lives in the engine section so a snapshot keeps them", `audio-core-pins` pin 4) and the audio state shape must not grow. Its identity is the held `EffectRecord.seq`, which is monotonic and never reset (`script/effects.ts` header, `vm.effectSeq`), so a restore can never confuse two starts. It is `PlainData` with explicit `null`s, saved and restored with the section. The event object stays alive because the engine passes every row's `event` handle to `collectStateGarbage`'s `extra` roots in the `time` phase; `forgetNativeDetail` has already dropped the *native* copy, which is why the decision is read from the script members (Design Notes 7). Rows are pruned in the `audio` phase once `applied`/`canceled` and no thread waits on their `seq`, so a world that used the event and moved on leaves no residue. Restore needs no rebuild step: the row, the held effect, the queue entry or cursor, the listener threads and the `media.beforePlay` wait are all in the three existing sections.

### 6. Asset retry ordering

The gate runs **before** the asset lookup, because a listener may replace `file`. The held effect therefore carries the original args while the row carries the decided `file`, `volume` and `loop`; `applyEffect` consults the row first and, when it finds `decision: "allowed"`, skips the gate entirely and looks up the row's file. That is what makes "the decision is never taken twice" true across an asset stall, a defer and a restore. Ordering inside the pending queue is unchanged: a beforePlay-held effect still holds every later audio effect behind it, in post order.

A row has two reachable "not decided yet" shapes, and settling distinguishes them: `event === null` means the event was never dispatched (the engine route found the cursor busy, so it deferred before queueing); settling dispatches it inline once `events.dispatch === null`. `event !== null` with `decision: "dispatching"` means the event is queued or in the cursor; settling waits for the queue and the cursor to release it and then reads the detail. Neither shape is created twice for one `seq`, so a restore mid-defer completes exactly as the unsaved run does.

### 7. Detail casing and reading mutations

Script identifiers are ASCII-folded at lex time (`script/lex.ts:326`, LEX-10), and object members are matched exactly (`readMember`, `script/objects.ts:134`). The engine must therefore write the member keys **folded** — `source`, `track`, `slot`, `cueid`, `file`, `volume`, `loop` — so `event.detail.cueId` in a script reaches the `cueid` member; the documented name stays `cueId` (MEDIA-3) and the TypeScript view already maps it back (`events/native.ts::publicDetailName`). Mutations are read from the `detail` dictionary's members directly. `readEvent` cannot be used for the decision: it prefers `events.nativeDetails` ("Original native detail values … preserving booleans and null", `events/model.ts:69`) over the script copy, so a listener's `detail.volume = 50` would read back as the pre-dispatch value, and `forgetNativeDetail` drops that copy when the dispatch completes. *Observation for a follow-up, not this ticket:* MEDIA-2's native detail writes `cueId` unfolded, so a script cannot read `event.detail.cueId` on a lifecycle event today; this ticket neither widens nor fixes that, and the docs-first block records the folded-key rule for `beforePlay` only.

### 8. Why no cues, ticks or goldens move without a listener

The fast path returns before touching the VM, the events section or the emitter, so no object handle is consumed and `hashGameState` is unchanged. Cue fields are unchanged for engine producers: `volume` is `100` there, `source` is not a cue field, and the `media.play` cue still carries the value the start used. For a script start with a listener the cue's `tick` is the tick the applier applied it, which is the same tick as today for a `threads`-phase call (the `events` phase and the `audio` retry both fall inside the same tick); `audio-core-pins` pin 2 already rules that a held transition carries the later tick.

### 9. Budget measurement (the 19.2 spike excluded this path)

`step-budget-spike.md` measured the *script* dispatcher and says outright that "engine-phase dispatch (EMIT-11)" is not covered. `beforeplay-budget.test.ts` drives the real engine (`advanceScriptTick`, real `effectAppliers`, authored 1-second WAV fixtures so the asset path is exercised) with 0, 1, 3 and 8 one-statement listeners on `media`/`beforePlay`, on both routes, and records `stepThread` consumption per listener plus the per-tick total from `openTick.stepsUsed`/its own counter. `BEFORE_PLAY_SPIKE_REPORT=1` prints the table. The step counts come from the value `runEventsPhase`/`runEngineCancelableEventDetail` now return (the `budget - remaining` the dispatcher already computes) — no instrumentation, no wall clock, and the script route's own `events`-phase call reports the same number. Asserted bounds, derived from EMIT-16's measured cost (14–15 steps for a one-statement listener, ~2 per detail field): 0 listeners adds **0** steps; 8 listeners cost **≤ 400** steps for the whole dispatch on either route; no start runs a dispatch more than once. `BEFORE_PLAY_STEP_BUDGET` is then set to `STEP_BUDGET` (1000) with that measurement as the margin record, and the PR records the measured numbers beside the 19.2 table.

## Open Questions

1. **Refusal outcome (recommendation: fail-open).** A dispatch that cannot complete leaves the start unmutated plus one diagnostic. Rejected: fail-closed (matches `beforeEnter`, but one listener bug silences the game); honouring partial mutations (a cancel that was never reached).
2. **Same-file no-op (recommendation: no event).** MEDIA-3 says "every attempted voice start"; a carry-on starts nothing, so no event, and a listener cannot convert a carry-on into a restart. Rejected: emitting for carry-ons (a second event per repeated board arrival, and a "started" notification with no start); letting a listener turn a carry-on into a restart (it would need the restart flag as a mutable field, which MEDIA-3 does not list).
3. **Re-entrant start inside a `beforePlay` listener (recommendation: catchable `media.beforeplay-reentrant`).** Rejected: silent suppression (a listener's `mediaPlay` would appear to succeed and do nothing); allowing it (unbounded queue growth by construction).
4. **`source` for an engine start whose tag is outside the table (recommendation: `audio.effect` diagnostic + no start).** No producer emits one today; the alternative is guessing a source for a record the engine did not write.
5. **`volume` on engine-originated effects (recommendation: not added).** `music.play`/`sfx.play` keep `[asset, loop, restart, source]` and a listener mutation is carried in the pending row; adding a fifth arg would move the effect log and hashes for producers that have no volume to express.
6. **`BEFORE_PLAY_STEP_BUDGET` value (recommendation: `STEP_BUDGET`).** Rejected: a smaller per-dispatch slice, which would refuse legitimate listeners on a busy tick without changing the tick's total cost.

## Verification

**Commands (after the docs-first commit, in this order):**

- `pnpm fixtures:fetch` — authored/fetched fixtures available for the engine and golden suites.
- `pnpm typecheck` — the new `PlainData` records, `WaitView` projection and wait-kind union compile.
- `pnpm lint` — G1–G3 bans hold (no generator/async/`Promise` in `script/**`, no `Math.random`/`Date`, no host imports in `core`).
- `node --test packages/core/test/beforeplay-gate.test.ts packages/core/test/beforeplay-engine.test.ts packages/core/test/beforeplay-script.test.ts packages/core/test/beforeplay-replay.test.ts packages/core/test/beforeplay-budget.test.ts` — the new coverage, with `BEFORE_PLAY_SPIKE_REPORT=1` for the measurement table.
- `node --test packages/core/test/audio-runtime.test.ts packages/core/test/audio-engine.test.ts packages/core/test/audio-events.test.ts packages/core/test/audio-lifecycle-runtime.test.ts packages/core/test/audio-lifecycle-engine.test.ts packages/core/test/audio-lifecycle-replay.test.ts packages/core/test/audio-restore.test.ts packages/core/test/audio-scenes.test.ts packages/core/test/events-emitter.test.ts packages/core/test/events-cancelable.test.ts packages/core/test/events-game.test.ts packages/core/test/engine-edges.test.ts` — no behaviour moved.
- `pnpm golden` and `pnpm golden:bun` — `golden/audio/cues.json`, `golden/scenes/**` and the sample-game cue streams unchanged; this ticket authorizes **no** golden update.
- `pnpm closing` — the eight baselines unchanged.
- `pnpm test` and `pnpm test:strict` — full suites, no skips.
- `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm fixtures:check`, `pnpm audit --prod` — package direction, clean-room markers, and the internal command staying out of the public catalogue/docs.
- `git diff --check` and a read of `git log --oneline` — the docs-first commit precedes the first code commit.

## Plan Change Log

- 2026-10-22 — Rebuilt the 1.1 KB draft into a ready-for-dev plan from `origin/main c339264d`. The draft's Assumption A-3 ("listeners run inside the audio phase") is withdrawn: starts apply where the producing phase calls the applier, and the engine already dispatches engine-originated cancelable events through `runEngineCancelableEvent` (EMIT-11). Added the provisional-identity ruling, the producer→`source` table, the three dispatch contexts, the catchable-error path for listeners that wait or overrun, the saveable pending-start row, the asset-retry ordering, the folded-detail-key rule, the no-listener fast path and the budget measurement the 19.2 spike excluded.
