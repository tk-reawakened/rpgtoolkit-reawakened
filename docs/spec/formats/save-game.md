# Saved game (`.sav`)

The legacy Toolkit format is binary. Legacy RPGCode `Save(name)` writes `Saved\<name>.sav` (relative to the Toolkit folder) and `Load(name)` reads it. The Reawakened runtime does not write this binary format; its canonical JSON `.sav` contract is described below. The legacy layout captures every script global, the party, inventory, equipment, position, the current board's items and threads (including each running script's full execution state), and a few display settings.

Legacy header text: `RPGTLKIT SAVE`. Toolkit 3.1.0 writes major **3**, minor **4**; readers handle minors below 4 (Toolkit 3.0) as noted.

**Counts here are exact counts** (not upper bounds), except the thread list.

**Our own save format — Reawakened rule (R-13).** A rebuild may use its own save format; this project's canonical Reawakened format is the save/load contract. Epic 8 implements that format only; legacy `.sav` import (E-122) is deferred. Restore a thread from its serialized execution state only when the save's compiler version matches the running compiler: a save made by a different compiler is refused whole with `restore.compiler-mismatch`, before any payload is used, and the current game is left unchanged (OWNER: Jensen, 2026-10-27). A thread whose saved *source* no longer matches the current source (`restore.source-changed`) is a separate, per-thread rule: that thread restarts from source rather than resuming an incompatible instruction position, and the rest of the save still loads. Restore still validates every saved callable and definition owner: if a changed or incompatible program leaves an unresolved callable reference, reject the save with the existing located restore error rather than repairing or silently dropping callable state (see [rpgcode-language.md](../engine/rpgcode-language.md), “Saving, loading and tidying up closures”). The split into separate lists — numeric globals, object-handle globals and string globals, then redirects, party, inventory, equipment and the miscellany — documents legacy import behavior only.

### Reawakened full-engine save and load

In the Reawakened runtime, `Save(name)` and `Load(name)` use the sandboxed
`saveBlob` and `loadBlob` host requests; the host owns storage and the engine
never accesses the filesystem. A board with `disableSaving` set does not issue a
save request.

Blob paths are prefixed with the AD-17 `GameId`, which core derives as
`fnv1a64(host game identity, fnv1a64(main-file bytes))`. The identity is a
required engine-init value: a boot-mode engine refuses to start without one, and
a scene engine (which has no main file) has none, so every save-area operation
there fails with a located `save.no-game-identity` error instead of writing into
a shared area. There is no fallback identity.

Core exports the canonical derivation for the host to use, so every runner
computes the same value from bytes it already holds:

- `derivePackageIdentity(files)` hashes a package's sorted `(path, bytes)`
  entries with length-prefixed fields. The *encoding* is unambiguous — no path
  or content can be re-split into another package's record (`["ab", "c"]` never
  encodes as `["a", "bc"]`), so two packages whose paths and main file match but
  whose other files differ are distinct inputs. A package game passes that result
  as the engine's game identity.
- `deriveGameId(mainBytes, gameIdentity)` folds the main file's actual bytes
  into that identity, so two games with a same-named main file but different
  bytes are distinct inputs too.

**Collision limit.** Both steps digest with `fnv1a64` — the project's one hash
(AD-11), 64 bits and non-cryptographic. Distinct inputs are *expected* to map to
distinct identities, but 64 bits cannot guarantee it: two packages meet the
birthday bound at roughly 2^32 distinct packages, so a collision is unlikely in
any real library and still possible in principle. This is save-slot separation in
a single-player runtime, not a security boundary. A host that needs collision
resistance supplies its own stronger identity (a SHA-256 of the archive, say) as
`gameIdentity`, which the derivation folds in unchanged.

**Identity validation.** `deriveGameId` rejects a missing, empty or non-string
identity with a `TypeError` (a programmer error), and boot reports a
`startup.no-game-identity` diagnostic when the init value is absent, empty or not
a string — a JavaScript caller passing `null` gets that located failure rather
than a crash.

The identity is stable across `reset()` and a `mainFile` reboot of the same
game. For a game folder the host chooses the identity (its project path is the
natural one); nothing in core makes that choice relocation-proof, so a host that
moves a folder and keeps its old identity keeps its saves, and one that changes
the identity starts a new save area.

`Save` captures the complete canonical game state only after its calling VM
thread has parked on the host request. The save records that thread as resumed
after a successful `Save`, so loading it continues the original script at its
next instruction. `Load` validates the full save and the current package/source
compatibility before replacing the live state; a missing or invalid save
returns failure to the calling thread without replacing the current game.
Successful restoration rebuilds package layers, hydrates saved actors and
verifies restored VM handles before continuing the saved thread set.

**In-flight requests.** A game save is serialized only once every other host
request it would capture has been answered: outstanding asset requests, deferred
image effects and other in-flight blob requests all settle first. A save
therefore never records a thread parked on a request the host has not answered,
which a restore would drop and strand.

### Compiler mismatch: refuse the whole save (owner ruling)

**Ruling (OWNER: Jensen, 2026-10-27).** A compiler version that differs from the
running compiler makes a saved instruction position meaningless, so the save is
refused as a whole and the live game is not changed. Two distinct rules follow
and must not be merged:

| Situation | Outcome |
|---|---|
| The save's `schema.compiler`, or any program reference inside it (every frame's `program`, every object record's `program`, every `vm.defOwners` entry), names a compiler other than the running one | The whole save is refused with `restore.compiler-mismatch`, located at the first offending field, before the `vm` payload is used. `Load` returns failure to the calling thread, raises the diagnostic, and replaces nothing. |
| The compiler matches but a file-backed program's current source no longer matches the saved `sourceHash` (`restore.source-changed`) | That one thread restarts from source on its next turn; the rest of the save loads. Callable and owner validation still rejects the save when a changed program leaves a saved callable unresolved. |

The compiler check is the first one a load makes: a save from another compiler
reports `restore.compiler-mismatch` even when other parts of it (its audio
projection, its sections) are also malformed. After it, a game load compiles every
program the save names, with or without callables, so a save whose thread names a
program file or include the game no longer has fails the load up front
(`program.missing`) and leaves the live game unchanged.
A thread whose file source changed (`restore.source-changed`) still restarts from
source, and the load proves that restart will work before it commits: the current
source is compiled together with the saved run-time include list, so a syntax error
in the new file, or a saved `include()` whose file was removed
(`program.include-missing`), refuses the load rather than throwing from a later
tick. A literal include of a file the game lacks is not an error (it is ignored
silently, R2-Q21), so it does not refuse a load. A refused load restores every
engine counter it touched, including the request-id counter, so the unchanged game
keeps issuing fresh request ids and keeps the same state hash. (The callable check
`verifyRestoredHandles` itself still compiles nothing for a state with no
callable, [rpgcode-language.md](../engine/rpgcode-language.md); the engine's load
adds this compile pass.)

This resolves the earlier disagreement between the whole-snapshot refusal
(`restoreGameState`; the hardening plan; `script-state.test.ts`) and the
per-thread clause that said "compiler or source mismatch restarts the thread":
the per-thread restart is for changed source only. There is no `restore.restarted`
diagnostic.

Audio game saves add only the playback projection defined in
[audio-media.md](../engine/audio-media.md#audio-save-load), not runtime audio
configuration or script volume settings. The saved cue is restored through
the current audio configuration.

### Reawakened canonical actor state

The Reawakened runtime uses its canonical state snapshot for its own save/load
surface. The legacy binary layout above remains an import specification. The
canonical state contains an `actors` section with schema version `2`, a
monotonic `nextId`, and an `actors` array. Each actor record stores only:

| Field | Type | Save rule |
|---|---|---|
| `id` | positive integer | Stable actor identity; never a VM object handle |
| `kind` | `party`, `enemy`, or `npc` | Actor source domain |
| `source` | asset reference string | Source asset, never a raw program path |
| `name` | string | Actor display name |
| `stats` | plain-data record | Current and maximum stats |
| `statuses` | string-to-integer record | Active status counters |
| `equipment` | plain-data record | Equipped references and derived bonuses |
| `progression` | plain-data record | Compatibility and policy values |
| `behaviour` | string or `null` | Package behaviour name only |
| `customEvents` | string array | Declared actor event names |

An actor record MUST NOT contain a callable, compiled program, host object,
emitter listener, closure, or raw `.prg` path. VM object records may retain a
host type name and ordinary plain-data members; their host methods are
re-hydrated from the installed packages after load.

Package startup runs in manifest order before actor hydration on boot and
restore. It rebuilds the session behaviour registry and host declarations from
the installed package code; neither registry is save data. Hydration resolves
each saved behaviour name against that rebuilt registry. A missing behaviour
keeps the actor data, uses core defaults, and emits one located
`behaviour.missing` diagnostic per missing name. Loading never refuses a save
for that condition. Reinstalling a package before loading resolves the same
saved name to the newly installed implementation; actor records do not carry a
package version.

The actor section schema version MUST be bumped, with a migration and a
previous-version restore fixture, whenever the persisted actor shape changes.

### Reawakened canonical party, inventory and menu state

The party, bag and open menu save as three owned sections of the same canonical
game state, not as a second store. Schema version **2** replaces each section's
version-1 empty placeholder. A version-1 section MUST be exactly `{}` and
migrates to the fresh version-2 value below; other old or future versions and
malformed current sections fail with `restore.shape` and an offending field
path. Migration changes no actor, VM, RNG or time data.

| Section | Version-2 fields | Fresh value |
| --- | --- | --- |
| `party` | `version`, `members` (ordered, distinct actor ids; at most five), `selected` (member id or `null`), `steps` (non-negative safe integer) | `{ version: 2, members: [], selected: null, steps: 0 }` |
| `inventory` | `version`, `nextId` (positive monotonic item identity), `items`, `equipment`, `gold` (non-negative safe integer) | `{ version: 2, nextId: 1, items: [], equipment: [], gold: 0 }` |
| `menu` | `version`, `screens` (ordered navigation stack), `graphic` (asset reference or `null`) | `{ version: 2, screens: [], graphic: null }` |

An inventory item is exactly `{ id, source, handle, quantity }`: a positive
safe integer identity below `nextId`, a non-empty item asset reference, its
display/compatibility handle string, and a non-negative safe integer quantity.
The `(source, handle)` pair is unique and identifies the item definition; `id`
(called `entryId` by inventory operations and events) identifies this particular
saved stack. `quantity` is the unequipped/available count. A zero-quantity stack
is retained while an equipment record references it and retired only when it
has neither available quantity nor equipment references. Equipment is an
ordered list of `{ actorId, slot, itemId }`, with a live actor id, a non-empty
slot name, an existing inventory identity and at most one entry per actor/slot.
This is the inventory owner's slot assignment; actor-owned `equipment` remains
the derived equipped-reference/bonus projection updated only through actor
operations. It is not another roster or another copy of actor stats.

Item identities never recycle during a run. An `items` action MUST NOT decrease
`nextId`, introduce an id below the previous `nextId` unless that id is still
present, or change an existing id's `(source, handle)` pair. Removing a stack
retires its id only after its available quantity and all equipment references
are absent; changing quantity preserves identity. Reset starts a new run with
`nextId: 1`, while restore resumes the saved counter. Equipment actor
references are derived, not saved: each `(actorId, slot, itemId)` tuple gets a
stable actor-scoped opaque reference, used as both catalog `id` and equipped
reference. Its deterministic encoding/disambiguation must avoid collisions
with any catalog `name` or other reference because actor resolution matches
`name` OR `id`. Thus multiple units from one stack can occupy distinct slots
without adding save fields, and the same references reconstruct after restore.

Every party member MUST name a live `party` actor and the roster MUST contain
at most five distinct actor ids. Roster order is the party slot order. A
non-empty party selects exactly one roster member by stable actor id; an empty
party selects `null`. Adding the first member selects it; later additions
preserve selection. Removing the selected member selects the member now at its
former index, or the last remaining member if that index is past the end;
removing the final member selects `null`. Reordering preserves selection by
actor id.
The party section stores membership, order, selection,
and steps only; actor stats, progression, statuses, and equipment-derived
state remain actor-owned. A roster operation validates its complete party and
actor references before committing; failure changes neither owner. Snapshot and
restore preserve the ordered ids and selected id, then restore the referenced
actor records through the actor section. Party operations that add, remove,
restore, select, or swap membership/order/selection emit only after the
successful commit, exactly once per committed mutation; refusals and no-ops
emit none (EMIT-13).

A menu screen is exactly `{ screen, actorId, selection }`: a non-empty
semantic screen name, a live actor id or `null`, and a non-negative safe
integer selection. Empty optional references are explicit `null`; no field is
omitted. Screen names and slot names are open identifiers, not legacy numeric
limits. Modal/input waits remain VM-owned; menu state contains no callable,
object handle or draw object.

**Owner ports (entry 8.2).** Core exposes an object-valued capability with
`party`, `inventory` and `menu` members. Each has `read()` (an immutable view)
and `apply(action)` returning exactly `{ ok, error }`, where `error` is `null`
on success or `{ path, message }` on failure. Validation happens before any
write; a failure changes nothing. The actions are:

| Owner | Plain-data action |
| --- | --- |
| `party` | `{ type: "roster", members, selected }` or `{ type: "steps", value }` |
| `inventory` | `{ type: "items", items, nextId }`, `{ type: "equipment", equipment }`, or `{ type: "gold", value }` |
| `menu` | `{ type: "navigation", screens }` or `{ type: "graphic", value }` |

These are core section-owner ports, not game-facing unrestricted bag editing.
Party/item/equipment operations add their semantic checks and events in their
own tickets before invoking these ports. Cross-section workflows invoke each
owner rather than mutating its records; an owner only commits its own section.
Input records are copied on successful commit, and read views are deeply
read-only. Existing ports keep resolving the current section after engine reset
or restore rather than retaining an obsolete section object.

The existing section-effect bus accepts the same one-record action in
`args[0]` for the namespaced command `menu.state`, recorded by the existing VM
as the unqualified effect name `state` (a manually posted `menu.state` effect
is also accepted). Its patch names exactly one of `party`, `inventory`, or
`menu`; that owner applies the action. Rejection is
the catchable `menu.state-invalid` error with the offending field path.
This makes authored script/native command adapters exercise the real owner
path without introducing a second dispatch or public legacy command alias.

**Capability design recommendation.** Prefer this object-valued, contextual
capability to a flat callback list. TypeScript calls `ports.party.apply(...)`;
an RPGCode-facing menu package can receive an OOP-12 hydrated capability object
with equivalent domain queries/actions, with no methods serialized in these
sections. The exact game-facing façade and calling syntax belong to entry 8.7;
entry 8.2 does not register global menu objects or decide EMIT-8/EMIT-13. No
emitter/event ruling is required for this data-only boundary.


## Layout (minor 4)

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT SAVE` |
| 2 | major, minor | short, short | 3, 4 |
| 3 | numeric globals: count; × (name, value) | int; (string, double) | script variables. On load a trailing `!` or `"` in the name is stripped. |
| 4 | object globals: count; × (name, value) | int; (string, double) | variables holding object handles |
| 5 | string globals: count; × (name, value) | int; (string, string) | on load `$` and `"` are stripped from the name |
| 6 | redirects: count; × (from, to) | int; (string, string) | active RPGCode `redirect`s |
| 7 | party size | int | minor < 4: always 5 slots |
| 8 | × party: name, file | string, string | character file relative to `Chrs\` (minor < 4: the path is stripped) |
| 9 | inventory count | **short** | |
| 10 | × item: file, name, quantity | string, string, int | `file` is stored **with the project path** (e.g. `Game\demo\Item\man.itm`); readers keep the part after `Item\` |
| 11 | equipment | 16 slots × party × (file, name) | slot-major: all members' slot 1, then slot 2, … |
| 12 | equipment bonuses | party × (int hp, int sm, int dp, int fp) | |
| 13 | (unused) | int | 0 |
| 14 | selected player | int | out of range → 0 |
| 15 | gold | int | |
| 16 | message window colour | colour | |
| 17 | message window background | string | |
| 18 | debug messages | int | non-zero = show script warnings |
| 19 | text colour | colour | |
| 20 | font name | string | |
| 21 | font size | int | |
| 22 | bold, underline, italic | int × 3 | |
| 23 | game time | int | seconds played |
| 24 | steps | int | steps taken, in tiles |
| 25 | main file | string | `.gam` name; reloaded from `Main\` (or the PAK root) |
| 26 | board | string | current board, relative to `Boards\` (minor < 4: path stripped); loaded **without** starting its threads (they come from field 37) |
| 27 | × party: x, y | double, double | **pixels** (minor < 4: tile coordinates) |
| 28 | × party: layer | int | |
| 29 | × party: active | int | minor ≥ 4 |
| 30 | × party: path vector, cycles, next node, attributes | int × 4 | minor ≥ 4; index of the waypoint vector the character follows (−1 = none) and its progress |
| 31 | × party: nextLevel, levelProgression | int, int | |
| 32 | other players | 26 × (string, string) | unused; written empty |
| 33 | menu graphic, fight menu graphic | string, string | |
| 34 | (unused) | int | 0 |
| 35 | selected player's replacement graphics | string | set by RPGCode `NewPlayer` |
| 36 | board items: count | int | minor ≥ 4 |
| 37 | × item: file | string | empty = empty slot, nothing more follows for it |
| 37a | prgActivate, prgMultitask, initialVar, initialValue, finalVar, finalValue | string × 6 | `loadingVar/Value` are not saved |
| 37b | activate, activationType | short × 2 | |
| 37c | x, y | double × 2 | pixels |
| 37d | layer, active | int × 2 | |
| 37e | path vector, cycles, next node, attributes | int × 4 | |
| 38 | thread UB | int | thread count − 1 |
| 39 | × thread: name | string | `Prg\` path or inline code |
| 40 | persistent | int | 0 = belongs to the board |
| 41 | (position) | int | minor < 4 only; ignored |
| 42 | isItemThread | int | minor ≥ 4 and persistent |
| 43 | item index | int | only if `isItemThread` |
| 44 | sleeping | int | |
| 45 | sleep remaining | double | milliseconds (minor < 4: seconds); 0 = not sleeping |
| 46 | program state | see below | minor ≥ 4 and name non-empty |
| 46′ | legacy local variables | heaps of (name, double) / (name, string) lists | minor < 4; ignored |
| 47 | movement size | double | 0.0 = pixel movement, 1.0 = tile movement |
| 48 | objects: count; × (handle, class) | int; (unsigned int, string) | minor ≥ 1 |
| 49 | game speed offset | int | minor ≥ 2 |

## Program state (inside each thread, field 46)

A running script's full state, so threads resume mid-program after loading. The program text itself is not stored; it is recompiled from the name.

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | stack index | int | −1 = nothing more follows |
| 2 | stack frame count | int | |
| 3 | × frame: item count | int | |
| 4 | × item: number, text, type flags | double, string, int | |
| 5 | local scope count | int | |
| 6 | × scope: variable count; × (name, number, text, type flags) | int; (string, double, string, int) | |
| 7 | call count | int | |
| 8 | × call: returns, return position, closing brace position, object, reference count | int, uint, uint, uint, int | |
| 9 | × reference: parameter index, frame (0 = global), variable name | uint, uint, string | |
| 10 | program position | int | index of the next instruction |
| 11 | scope mode | int | 0 = globals first, 1 = locals first |
| 12 | include count; × name | int; string | |

**Compatibility note:** "positions" are indices into the compiled instruction list of the *original* engine's compiler. A reimplementation with a different compiler cannot resume saved threads exactly; it should restart them, or map positions to source lines in a new save format.

Not saved: per-call error handlers.

## Behaviour notes

- Loading first destroys all globals, redirects and threads, then reads. A corrupt file leaves a half-loaded game.
- A missing file shows "File not found"; a wrong header shows "Invalid save file"; in both cases the game continues unchanged.
- When the game runs from a PAK or standalone EXE the original engine wrote saves into its temporary folder, which is deleted on exit (inferred), so saves did not survive the session.

## Example

[../examples/listings/slot1.sav.txt](../examples/listings/slot1.sav.txt) — a save with globals, one party member, one inventory item and no running threads.
