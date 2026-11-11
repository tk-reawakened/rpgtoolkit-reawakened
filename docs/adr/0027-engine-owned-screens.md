# ADR 0027 — The screens are engine-owned; the presented frame is rebuilt, not saved

* **Status:** Proposed (2026-11-11). The owner gave the direction in discussion on 2026-11-11 (move the screens out of `GameState`; changing the save format before the first public release is acceptable). The owner has not yet approved this text. No code follows from it until the owner does.
* **Date:** 2026-11-11
* **Amends, once accepted:** [docs/spec/engine/runners.md#surface-read-and-state-hash](../spec/engine/runners.md#surface-read-and-state-hash), [docs/spec/formats/save-game.md#state-hash-surface-projection](../spec/formats/save-game.md#state-hash-surface-projection); closes the "save, restore and replay — unresolved" item of [ADR 0018](0018-core-composed-program-starting-frame.md) section 5
* **Context documents:** [ADR 0018](0018-core-composed-program-starting-frame.md), [ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) (pre-release contracts may change), [ADR 0005](0005-independent-product-v1-and-native-format.md), [guardrails.md](../guardrails.md), AD-10/AD-11 (canonical state), AD-27 (`engine.surfacePixels`)
* **Tickets:** [#1870](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1870) (encoding cost), [#1880](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1880) (held frame lost on restore)

## In plain terms

1. **What the player sees is not saved progress.** The engine keeps the picture on the screen (surface 0) to itself, as plain bytes. It is not part of the game state, it is never written into a save, and loading a save draws it again.
2. **What a script drew on the screen is kept, but stored outside the game state.** The script-screen layer (surface -1) has to survive a save, because a program's drawing must still be there after loading. The game state records only that the layer exists and its size and revision. The engine holds the pixels, and they are written once, when a save is taken.
3. **When the screen depends on the past, the save says so.** For a short time after a program ends, the screen shows that program's last picture, not the board. The game state records that this is happening, and the save carries that one picture. This is what [#1880](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1880) needs.
4. **Old saves stop loading.** This is a save-format change made before the first public release, which ADR 0023 allows. A save in the old format is refused with a clear error, not migrated.

## Context

**Cost.** At the end of every `advance` the engine rasterises the frame and base64-encodes the whole of it into `state.surfaces.entries["0"].bitmap.b64`, and it re-encodes surface -1 whenever a batch of script drawing ends. Measured in #1870 (Node 22, 640×480): about 70 ms per changed frame with the current encoder, and about 9.5 ms with a faster one, against a 16.7 ms frame budget. The encoded text is needed only when a save is written.

**The state hash already ignores both.** Since the 2026-11-01 and 2026-11-02 rulings, surface 0 is a derived presentation cache, excluded from the hash and rebuilt on restore before any script read. Surface -1 is hash-neutral too. Keeping them as base64 inside `GameState` buys nothing, and the hash projection needs special cases (`SCREEN_ENTRY_KEYS`) to skip them.

**But rebuilding is not exact today** ([#1880](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1880)). After an outermost program ends, the engine holds its final screen (ADR 0018 R3, W4). It does this with engine-local variables (`holdProgramFrame`, `endedProgramThisTick`, `frameHash`) that are not in `GameState`, and while held the draw list blits surface 0 into itself. Restoring a save taken during the hold therefore draws the live board, and a program started next copies the board instead of the previous program's screen. In the reproduction, `getpixel` reads `200,100,50` uninterrupted and `10,20,30` after save and load. Those values go into hashed globals, so this breaks continuation determinism (G3).

So surface 0 can leave the save only if the frame is first made a pure function of saved data. This ADR does both.

## Decision

### D1. Surface 0 is engine-owned and never saved

* The engine holds the presented frame as `{ rev, w, h, rgba }` in a screen store owned by the engine. It is not in `GameState.surfaces.entries`.
* `getpixel`, `canvasgetscreen`, `savescreen`, a canvas draw whose source is the screen, and the program-start copy (ADR 0018 R5) read the store. `engine.surfacePixels(0, rev)` reads it too and stays observationally read-only. It never rebuilds or encodes.
* Its revision counter is engine-local. That is safe because, after D3, no draw list names surface 0. A runner learns surface 0's revision only from `surfacePixels`, which is presentation.
* On restore, the engine rebuilds surface 0 from the restored state before any script runs, as the 2026-11-01 ruling already requires.

### D2. Surface -1 keeps its identity in `GameState`, but its pixels live in the engine

* `GameState.surfaces.entries["-1"]` keeps `{ id, rev, w, h }`, with no `bitmap.b64`. The draw list names the layer by id and revision, and `drawList()` must stay a pure function of state (G4, AD-1), so that metadata has to stay in state.
* The engine holds the layer's bytes. Script drawing writes them directly, with no encode at the end of a batch.
* A save writes the bytes once, at save time, into the new screens section (D4).

### D3. A held frame is state

* `GameState` gains a presentation record: `{ hold: "programEnd" | "boot" | null }`. It replaces `holdProgramFrame`, `endedProgramThisTick`, and the `frameHash !== null` test in the boot-interval rule. Restore no longer resets it.
* While a hold is active, the held picture lives in a reserved engine-owned surface, the **held frame**, with its id, revision and size in `GameState` like surface -1. The draw list blits the held frame, never surface 0, so the draw list no longer refers to the frame it is building.
* The save carries the held frame's pixels only while a hold is active. It is captured at the moment ADR 0018 R3 commits the final program screen, and released when the hold ends.

**Why carry pixels instead of describing the held frame.** The held picture is "layer -1 plus the message window as it stood when the program ended". Both are in the saved state, so in principle the picture could be redrawn from them. It would come out wrong whenever something changes either one during the hold: a board thread drawing to the screen, or a script writing the message window. The uninterrupted run keeps showing the frozen picture; a rebuild would show the change. Carrying the pixels is exact, and it costs one picture in a save only during a short window. This ADR therefore rules option B, carrying the pixels. Option A, describing the frame, is recorded under Alternatives.

### D4. The save format

* The `surfaces` section schema goes from version 1 to version 2: no entry `"0"`, and no `bitmap` on entry `"-1"` or on the held frame.
* A new top-level save section, `screens`, holds the encoded pixels of surface -1 and, while a hold is active, of the held frame. Each uses the existing `rgba` snapshot shape (`{ t, w, h, b64 }`), keyed by surface id. The engine writes it from its screen store when it writes a save, a recovery candidate, or an internal restore clone.
* A version-1 surfaces section has no migration, so it is refused with `restore.shape` ([save-game.md](../spec/formats/save-game.md), section versions table). This is allowed because no save format has been published (ADR 0023 rule 2).
* The state hash does not change. It already ignores entries `"0"` and `"-1"`, and the `screens` section is outside the hashed projection. `SCREEN_ENTRY_KEYS` loses `"0"`, because that entry no longer exists.

### D5. Captures in the middle of a tick

* The pre-battle recovery candidate is captured inside an open tick. At that point the state is part-way through the tick while the presented frame is still the one from the last tick boundary, so a rebuild from that state can differ.
* Ruling: a capture in the middle of a tick also carries surface 0's pixels in `screens`, and restoring it installs them instead of rebuilding.
* Ordinary saves are written at the end of `advance`, before the end-of-advance refresh. A rebuild from that state equals the frame the uninterrupted run commits next, so ordinary saves carry no surface 0.

### D6. Frames waiting on assets (to verify before implementation)

* `refreshFrame` keeps the old frame while the draw list's assets are not loaded.
* If ticks can run in that state, which frame a program copies depends on host load timing. That would be a G3 gap even without saves.
* Before implementation, confirm that ticks cannot advance while draw-list assets are missing. Otherwise, make that an explicit gate. The result is recorded in this ADR before it is accepted.

## Proof required

1. **[#1880](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1880)'s test.** A save taken during a program-end hold, and one taken during the boot hold, restore so that the next program's `getpixel` reads the same values as the uninterrupted run.
2. **Draw-list equality on restore.** At boundary ticks across the golden corpus, including the tick a program ends, the boot interval, and two programs starting in the same frame: the draw list from a restored clone equals the live engine's. Rasterising is pure, so equal draw lists mean equal frames. This compares draw-list hashes, not pixels.
3. **No encoding during play.** A multi-tick run with changing frames performs no base64 encode of any screen until a save is taken. The test counts calls; it does not assert wall-clock time.
4. **Round trip.** Save then load restores surface -1 and any held frame pixel-exact, and the state hashes are unchanged.
5. **Checks.** `pnpm golden`, `pnpm closing`, `pnpm oracle:check` and the save/load tests pass. Golden state hashes should not move. Save bytes change, and the PR explains why (G5).

## Guard-rails

* **G1:** `GameState` stays plain JSON. Bytes live only in engine-owned storage, and the save writer encodes them.
* **G2:** Unchanged. The screen store is core code that uses no host API.
* **G3:** D3 and D5 close the restore gap found in #1880. D6 is checked before implementation.
* **G4:** `drawList()` stays a pure function of `GameState`. The draw list no longer names surface 0.
* **G5:** Golden hashes are expected to stay the same. The save format changes deliberately (D4).
* **G6, G7:** Unchanged.

## Alternatives considered

* **Defer the encoding but keep both screens in `GameState`.** The screen entries would hold a placeholder until a save is taken. It fixes the cost without a format change, but it keeps a derived cache inside the canonical state, and the hash projection needs its special cases. Since changing the save format is acceptable before release, this ADR prefers the structural fix.
* **Describe the held frame instead of carrying its pixels (option A under D3).** It is smaller, but it is only exact if nothing writes layer -1 or the message window during a hold, and threads can. It could be revisited if a hold is ever proven to freeze both.
* **Drop surface -1 from saves as well.** Rejected: it holds what a program drew, which is history no state rebuild can produce.

## Implementation order

1. Fix [#1880](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1880) under D3, with surface 0 still saved. It stands alone and adds the proof-1 test.
2. Settle D6.
3. Edit the spec pages listed under "Amends", in their own commit (G7).
4. Add the engine screen store and the `screens` save section, move surface -1's pixels and the held frame there, and remove surface 0 from `GameState` (D1, D2, D4, D5). Proofs 2–5.
5. Close [#1870](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1870).
