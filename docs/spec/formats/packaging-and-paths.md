# Project layout, path resolution, PAK archives and standalone EXEs

How a game is laid out on disk, how names inside files are turned into paths, and the two single-file distribution forms.

## The Toolkit folder and a project

```
<Toolkit folder>\              the engine and editor run from here (it is the working directory)
    Main\<name>.gam            main files of every project (outside the projects)
    Saved\                     saved games, created by the engine at start-up
    Game\<Title>\              one project ("projectPath", stored inside the .gam)
        Tiles\  Boards\  Chrs\  SpcMove\  Bkrounds\  Media\  Prg\
        Font\   Item\    Enemy\ Bitmap\   StatusE\   Misc\   Plugin\
```

| Folder | Holds |
|---|---|
| `Tiles\` | `.tst`, `.iso`, `.gph`, `.tan` |
| `Boards\` | `.brd` |
| `Chrs\` | `.tem` |
| `SpcMove\` | `.spc` |
| `Bkrounds\` | `.bkg` |
| `Media\` | music and sound effects |
| `Prg\` | `.prg` |
| `Font\` | `.ttf` fonts; every `*.ttf` here is installed temporarily while the game runs |
| `Item\` | `.itm` |
| `Enemy\` | `.ene` |
| `Bitmap\` | images and `.tbm` |
| `StatusE\` | `.ste` |
| `Misc\` | `.anm` animations |
| `Plugin\` | plugin DLLs (menu, battle, script commands) |

The editor creates all 14 folders for a new project. The project folder name is the game title with `\`, `/`, `:`, space and `.` removed. A new project made from the template gets `startupPrg = start.prg`, `initBoard = start.brd`, `initChar = start.tem`, `menuPlugin = tk3menu.dll`, `fightPlugin = tk3fight.dll` and `menuKey = 13`.

## Resolving names

| Name stored in | Resolved as |
|---|---|
| any asset file (board, character, item, animation …) | `projectPath + <type folder> + name`, e.g. `Game\demo\` + `Boards\` + `town\inn.brd` |
| main file name (command line, save game) | `Main\<name>`, relative to the Toolkit folder, **not** the project |
| save game name | `Saved\<name>.sav`, relative to the Toolkit folder |
| tile reference | see [README.md](README.md#tile-references) |

Paths use `\`. Sub-folders below a type folder are preserved in stored names. File names are case-insensitive (Windows), folded by the ASCII rule in [README.md](README.md#paths-inside-files).

**Separators — Reawakened rule (R-08).** A reader accepts **both** `\` and `/` in a stored or packaged name (it rewrites `\` to `/` before matching, [README.md](README.md#paths-inside-files)). Our own **distribution package writes `/`**, normalising every entry name, so the archive this project emits is unambiguous and byte-stable. *Reason:* the legacy pak used `\`, but `/` is the ZIP convention and both forms fold to the same path; the reader's tolerance means a legacy pak and ours load identically. The writer's normalisation is `packages/core/src/formats/package/write.ts:171`.

## PAK archive (`.tpk`)

A whole game in one file: a standard **ZIP** archive.

| Rule | Value |
|---|---|
| Main file | stored under the fixed name `main.gam` at the archive root |
| Everything else | every file under the project folder, stored under its **project-relative path with `\` separators**, e.g. `Boards\town.brd`, `Misc\start\start_s.anm` |
| Directories | no entries |
| Not included | `Saved\`, other projects' main files, anything outside the project folder |
| Compression | deflate (method 8), no encryption, no comments, DOS date and time fields 0 |
| Lookup | names are matched case-insensitively; a reader accepts both `\` and `/` (R-08) |

**The archive root is the project folder — Reawakened rule.** A pak holds the **project folder's contents at the archive root** — the 14 type folders sit at the root, their contents not wrapped in a folder named after the project — and the main file is the legacy pak's root `main.gam`. The stored `projectPath` is ignored when playing from a pak (the root *is* the project folder). <!-- OWNER: chose "project folder's contents at the archive root" over "the project folder nested under its own name" because the package resolver keys a reference at the package root (the project folder is the root, AD-5), §1.5 already says a pak embeds `main.gam` inside it, and this project's own writer emits the flat form; §13's one sentence fits both readings and no sample package pins it. -->

When a game runs from a PAK:
- the main file is `main.gam` at the root, and its stored `projectPath` is ignored (treated as empty);
- each file is extracted on first use into a temporary folder (`%TEMP%\TKTemp\…`) that mirrors the 14 project folders, and the folder is deleted when the game exits;
- saves go to the same temporary tree and were lost on exit in the original engine (inferred).

## Loose folder

A directory whose **own root is the package root**: the project folder's contents (the 14 type folders, [README.md](README.md#index)) sit directly in it, together with the main file, **not** nested under `Game/<project>/`. The core performs no I/O, so the host lists the folder's entries; each is a **file**, a **directory** (counted toward the entry limit but never served) or a **link** (**refused**, L23). The stored `projectPath` is ignored just as for a `.tpk` — a package's root *is* the project folder. The folder form is subject to the same limits and path rules as an archive (L22–L26), so a game behaves identically whichever form it arrived in.

## Setup ZIP

A plain ZIP of the `Main/` and `Game/` folders (as the original installer shipped a game), as distinct from a `.tpk` whose root is the project folder. A loader treats it as an archive and finds the main file under `Main/`.

## Standalone EXE

**This project reads this form and never writes it.** It is an *input* format: importing an appended-ZIP legacy game is the only way some of those games load at all, so dropping the producing side is not dropping support. The legacy editor's "Make EXE" copied the engine executable and appended a PAK and a 12-byte trailer:

| Part | Size | Content |
|---|---|---|
| engine | *E* bytes | an unmodified copy of the engine executable (icons may then be patched in place) |
| PAK | *Z* bytes | the ZIP described above |
| trailer: magic | 4 | ASCII `CMP1` |
| trailer: engine length | int | *E* = byte offset where the ZIP starts |
| trailer: ZIP length | int | *Z* |

At start-up the engine reads the last 12 bytes of its own file. If they begin with `CMP1` it copies *Z* bytes from offset *E* to `%TEMP%\temp.tpk` and runs that PAK. The file size is always `E + Z + 12`. There is no checksum or version beyond the magic. If extraction fails the engine shows "This application is corrupt." and continues with normal start-up.

**Trailer rules — Reawakened rule (R-27).** `offsetOfZip` and `zipLength` are little-endian 32-bit integers; a loader requires `offsetOfZip ≥ 0`, `zipLength ≥ 0` and `offsetOfZip + zipLength ≤ fileLength − 12` (L20). Extracting `[offsetOfZip, offsetOfZip + zipLength)` must yield the clean game ZIP. The loader keeps the legacy **leniency**: an appended ZIP that ends **before** the trailer (there are bytes between the end of the ZIP and the trailer) is still accepted, because the original engine only ever read the two lengths. It also handles a self-extracting installer whose ZIP starts partway into the file when a `CMP1` trailer records the offset.

**Toolkit 2 Professional EXEs are refused — Reawakened rule (R-27, L21).** A game exported from Toolkit 2 Professional as one EXE is a small launcher with a compressed payload in a private format: it has no `CMP1` trailer and its data is not a plain appended ZIP, and a self-extracting installer such as `zip.exe` has no trailer either (its ZIP starts behind the launcher at an offset no trailer records). The loader refuses all of these with the "missing `CMP1` trailer" rule (**L21**), and its message tells the player to extract the assets themselves from the original project folder, its Setup ZIP or its `.tpk`. <!-- OWNER: chose to decline importing Toolkit 2 standalone EXEs rather than reverse-engineer their packer, because the same games are reachable through the Setup ZIP, `.tpk` and loose-folder forms and a private compressed payload would be guesswork. --> The evidence is five archived samples (`AMU_Aftermath`, `axeofyulon`, `Firesword13`, `GrandDragonElite`, `LegendofStorm`), none of which ends in `CMP1`, and one archived `zip.exe` whose ZIP starts at offset 24,054; a crawl of the whole archive found no EXE carrying `CMP1`.

## Distribution package (this project's own)

The editor's **"Make package"** (T-70) **writes a distribution package** — a `.tpk`-compatible ZIP, the project folder at the archive root exactly as for a `.tpk`, that differs from a legacy pak in two ways: the main file is kept at its [README.md](README.md#paths-inside-files) path `Main/<game>.gam` rather than the legacy root `main.gam`, and the archive also holds a **`manifest.json`** at the root, next to the game files. <!-- OWNER: chose to keep our main file at its §1.5 path `Main/<game>.gam` (and name it in the manifest) rather than the legacy pak's root `main.gam`, because a legacy pak's embedded main is found by the engine and our package names it in `manifest.json`; a reader that accepts both forms ignores the difference. -->

The manifest is UTF-8 JSON with **exactly three fields**:

| Field | Meaning |
|---|---|
| `schema` | a non-negative integer: the project schema version |
| `main` | the in-package path of the main file, e.g. `Main/demo.gam`; it must name a game file in the archive and must not be `manifest.json` itself |
| `index` | the in-package path of every game file except `manifest.json`, each listed once, in code-unit order |

The `index` order is the **writer's**, so two writes of one asset tree are byte-identical (guard-rail G3); the caller's array order never reaches the file. A reader accepts the entries in any order, comparing them as a set with `main`, and checks that `main` and every `index` entry name a file in the archive and that no game file is missing from `index`; it refuses a manifest with any other field. A legacy package has no manifest and loads without one; only packages this project writes must carry it. The code is `packages/core/src/formats/package/manifest.ts:1-90` and `package/write.ts:281-430`.

<a id="install-descriptor"></a>
## Install descriptor

A package is what a game *is*; the descriptor is what a host needs to **register** it. The exporter writes it beside the
package as `<package>.tpk.json`, a sibling file, because the package's own manifest keeps exactly `schema`, `main` and
`index` and a reader refuses any other field (AD-6). It is data about the package, not part of it: two exports of one
asset tree stay byte-identical, and no reader or writer contract changes.

The descriptor is **UTF-8 JSON with exactly seven fields**:

| Field | Meaning |
|---|---|
| `schema` | a non-negative integer: the descriptor's own schema version, independent of the package's `manifest.schema` |
| `file` | the package's file name, as written, with no directory part |
| `sha256` | the lower-case hex SHA-256 of the package's bytes — the same hash the runner uses as a cache key |
| `size` | the package's byte length, a non-negative integer |
| `gameId` | the identity a library row and that game's settings are keyed by (the `GameId` AD-17 derives in core) |
| `title` | the game's display name, a non-empty string |
| `version` | the game's own version string, as the author wrote it |

A host that registers a package validates the descriptor against the file it names — the SHA-256 and the size must
match, or the install is refused with the reason — and stores the six fields in its library registry. **Installing is
registering**: no per-game stub, no executable wrapper and no file association are involved, and an install is not a
save (AD-17's blob areas are untouched).

**Every descriptor value is a proposal of the same standing as the limits below.** No sample game ships a package, so
the field set has no corpus evidence; it is fixed here because a library row needs a shape to key, and it changes only
with this section.

## Untrusted-package limits (L1–L26)

Every package form is **untrusted input**, so a loader bounds what a package can make it spend — bytes in, entry count, declared and actual sizes, compression ratio, path shape and the appended-EXE trailer — before it allocates or parses anything, and treats a nested archive as an ordinary file (L14). Every rejection **names the rule it hit**, so a failure, a code comment or a review finding can cite one row. The loose-folder rows (L22–L26) restate the archive rows rather than widening them, so both forms accept and reject the same games. The limits are enforced in `packages/core/src/formats/package/limits.ts:1-40`.

**Every value is a proposal — Reawakened rule.** The numbers come from a 134-file, 6.3 MB corpus of two sample games plus `fflate`'s documented behaviour; no sample ships a package, so the package numbers have no corpus evidence at all (the corpus only bounds the assets inside a package: largest file 430,086 bytes, max path depth 4 segments, max relative path 59 characters, max basename 47 characters). Change a value and its row together. <!-- OWNER: chose to make the discovery report's proposal values the spec's normative L1–L26 table because the code already enforces exactly these numbers under these ids, no sample package exists to measure them, and giving them ids is what lets a failure, a comment and a review finding cite one row; if you want a different value, it is a one-line change here and in `limits.ts`. -->

| # | Rule | Value |
|---|---|---|
| L1 | Max compressed input (the whole file, before parsing) | 256 MiB (268,435,456 bytes) |
| L2 | Max entries (files + directories) | 10,000 |
| L3 | Max single entry uncompressed size, checked before inflating | 64 MiB (67,108,864 bytes) |
| L4 | Max total uncompressed size (sum of declared sizes) | 512 MiB (536,870,912 bytes) |
| L5 | Max per-entry compression ratio (uncompressed ÷ compressed) | 100:1 (zip-bomb guard) |
| L6 | Max path length, UTF-8 bytes with `\` normalised to `/` | 256 |
| L7 | Max path depth (segments) | 16 |
| L8 | Max basename length (UTF-8 bytes) | 128 |
| L9 | Path escape (zip-slip) | reject an absolute path, a drive letter (`X:`), a `..` segment, a NUL, or a path that names nothing |
| L10 | Case-insensitive duplicates | reject two entries that differ only by case or separator |
| L11 | Encrypted entries (general-purpose flag bit 0) | reject |
| L12 | Compression methods | only 0 (stored) and 8 (deflate) |
| L13 | ZIP64 records (EOCD64 locator or `0xFFFFFFFF` sentinel) | reject |
| L14 | Nested archives | opaque: a nested `.zip`/`.tpk` is a file, never opened (nesting depth 0) |
| L15 | End-of-central-directory search window | last 65,557 bytes (22-byte record + 65,535-byte comment) |
| L16 | Declared size, before inflate | reject a declaration above L3 (defence in depth: L3 already refuses every entry that would reach it) |
| L17 | Declared vs actual size, after inflate | reject when the inflated length differs from the declared size |
| L18 | CRC-32 | verify the decoded bytes against the header's CRC-32 |
| L19 | Local-header / central-directory consistency | reject when name, method, compressed size or uncompressed size disagree; the same rule covers a corrupt central directory or end-of-central-directory record |
| L20 | Appended-EXE trailer validity | require `offsetOfZip ≥ 0`, `zipLength ≥ 0` and `offsetOfZip + zipLength ≤ fileLength − 12` |
| L21 | Appended-EXE trailer present | the last 12 bytes must start with `CMP1` |
| L22 | Loose folder: entry count | same as L2 |
| L23 | Loose folder: symlinks and reparse points | reject |
| L24 | Loose folder: total size | same as L4 |
| L25 | Loose folder: per-file size | same as L3 |
| L26 | Loose folder: path rules | same as L6–L10 |

## Example

[../examples/files/example_game.tpk](../examples/files/example_game.tpk) is a PAK of the complete example game; [../examples/listings/standalone_trailer.txt](../examples/listings/standalone_trailer.txt) shows the trailer of [../examples/files/standalone_layout.exe.bin](../examples/files/standalone_layout.exe.bin), which uses placeholder bytes instead of a real engine.
