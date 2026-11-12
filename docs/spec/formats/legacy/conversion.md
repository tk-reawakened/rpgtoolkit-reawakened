# Converting legacy files

Toolkit 2 sprites were built from fixed grids of tiles; Toolkit 3 uses animations (`.anm`) whose frames are tile bitmaps (`.tbm`). When the original programs meet a legacy character, item, enemy or fight background they generate those files **on disk, at load time**, before the author saves anything. This page specifies the generated files so a new importer produces the same project.

## Naming

All generated names start from the legacy file's own name with `.` replaced by `_`. For a character `hero.tem` the prefix is `hero_tem`. Tile bitmaps go to the project's `Bitmap\` folder and animations to `Misc\`; the converted asset refers to them by bare file name.

All generated animations use **transparent colour white** `(255, 255, 255)`. Generated tile bitmaps use zero tint.

## Characters

Applies to text characters and binary characters before minor 5 (editor only; the original engine refuses these files).

| Generated | Size | Content | Used as |
|---|---|---|---|
| `<p>_walk_0.tbm` … `<p>_walk_15.tbm` | 1 × 2 tiles | walking frame *n*: (upper, lower) tile | frames of the walk animations |
| `<p>_walk_S_.anm`, `<p>_walk_E_.anm`, `<p>_walk_N_.anm`, `<p>_walk_W_.anm` | 32 × 64 px, 0.167 s | frames 0-3, 4-7, 8-11, 12-15 | walk S, E, N, W |
| `<p>_fight_0..3.tbm`, `<p>_defense_0..3.tbm`, `<p>_spc_0..3.tbm`, `<p>_death_0..3.tbm` | 2 × 2 tiles | battle frames | |
| `<p>_fight.anm`, `<p>_defense.anm`, `<p>_spc.anm`, `<p>_death.anm` | 64 × 64 px, 0.167 s, 4 frames | | FIGHT, DEFEND, SPECIAL MOVE, DIE; frame 0 plays the old swipe / defend / special / death sound |
| `<p>_rest.tbm`, `<p>_rest.anm` | 2 × 2 tiles; 64 × 64 px | battle rest | REST |
| `<p>_custom_<n>.tbm`, `<p>_custom_<n>.anm` | 1 × 2 tiles; 32 × 64 px | custom graphic *n* = 0..9, only if non-empty | custom stance named `Custom <n>` |

The size type becomes 1, and the old sound file names are dropped from the character after being attached to the battle animations.

<a id="reawakened-legacy-character-walk"></a>
**Reawakened player rule.** A character that stores walking tile references can stand and walk using that artwork. When no walk animations are stored, adapt the sixteen pairs in memory as the four directional walk clips in the table. Each frame is a 32 × 64 canvas with the upper tile at y = 0 and the lower tile at y = 32. The bottom centre (16, 64) is the actor anchor. An empty or unavailable tile leaves its cell transparent. A direction with at least one available tile retains all four frame positions. A direction with no available tiles has no clip. Tile transparency and the conversion's white colour key both apply. The existing [facing and animation rules](../../engine/movement-and-collision.md#e-21) select and advance these clips, including the normal diagonal and idle fallbacks. Each frame lasts `ceil(0.167 × 60)` fixed ticks. The player resolves the character and tile assets through the project's regular asset source on boot and restore. It writes no generated files.

<a id="reawakened-single-tile-walk-anchor"></a>
**One-tile walks.** A character with `sizeType = 0` and at most one stored tile reference in each walking frame stands with its visible feet at the actor anchor. Put the frame's tile in the lower cell whether the file names it in the upper or lower slot. An empty frame is still transparent. Determine whether the rule applies from the stored pairs across the whole walk, before resolving any tile assets. Walks with two-tile frames and other size types keep both authored cell positions. Final Destiny's Bill stores his one-tile walk in the upper slots, while other one-tile characters store their frames in the lower slots.

**Embedded pixels (sizeType 0).** Text characters with 32 × 32 graphics store pixels instead of tile names. They are first written into a new tileset `Tiles\<p>.tst`, one tile per embedded image in reading order: 16 walking tiles, then the 4 fight, 4 special, 4 defence and 4 death tiles (each group in frame order), the rest tile, and the 10 custom tiles. The tile references `<p>.tst<N>` then fill the frames: walking and custom frames get the tile in their **lower** cell (upper cell empty); battle and rest frames get it in the **bottom-right** cell of their 2 × 2 grid (other cells empty). Conversion then continues as above.

## Items

Applies to binary items before minor 4 (both the original editor and engine) and to text items (editor only).

| Generated | Size | Content | Used as |
|---|---|---|---|
| `<p>_walk_0.tbm` … `<p>_walk_15.tbm` | 1 × 2 tiles | walking frame *n* | |
| `<p>_walk_S_.anm`, `_E_`, `_N_`, `_W_` | 32 × 64 px, 0.167 s | frames 0-3, 4-7, 8-11, 12-15 | walk S, E, N, W |
| `<p>_rest.tbm`, `<p>_rest.anm` | 1 × 2 tiles; 32 × 64 px | rest frame | **idle south** animation |

Text items with sizeType 0 first write their embedded tiles (non-empty walking tiles, then the rest tile) into `Tiles\<p>.tst`, as for characters. **The original engine regenerates these files on every load** of an old binary item, and in a PAK game writes them into its temporary folder.

## Enemies

Text enemies only. The top-left width × height part of the 19 × 7 tile grid becomes `Bitmap\<p>_rest.tbm` (width × height tiles), and `Misc\<p>_rest.anm` (width·32 × height·32 px, one frame, 0.167 s) becomes the REST animation. FIGHT, DEFEND, SPECIAL and DIE take the four animation names at the end of the file.

## Fight backgrounds

Text backgrounds only. The 19 × 11 tile grid and its per-tile tints become `Bitmap\<p>.tbm`, which becomes the background's image.

The player also performs this conversion in memory when a stock fight loads a
text background. It composes the stored cells and their tints into one picture,
without writing files into the game. The stock screen stretches that picture
in the same way as an image background; binary image backgrounds are unchanged.

## Boards

Pre-vector boards (minor 2-3) are upgraded in memory; see the rules in [older-binary-versions.md](older-binary-versions.md#board-minor-2-and-3-pre-vector). Nothing is written until the board is saved.

## Main files

- Text main files are converted field by field ([text-formats.md](text-formats.md#main-file-toolkit-2-text)).
- Plugins named by number (`tkplug<i>.dll`) keep those names.
- Files from before Toolkit 3 kept plugins in the Toolkit folder's shared `Plugin\`; on conversion the original editor copies them into the project's `Plugin\`.
- **Battle plugin upgrade:** whenever the original editor opens a main file whose battle plugin is `tk3fight.dll` and that DLL reports plugin version 30 (the first 3.0 battle system), it backs up the project's copy as `tk3fight_old.dll` and replaces it with the template game's newer `tk3fight.dll` (if the template has one).

## Toolkit 2 folder layout

Toolkit 2 had no project folders: every game's files lived directly in the Toolkit folder (`Tiles\`, `Boards\`, `Chrs\` …), next to an `Archives\` folder. When the original 3.x editor starts in such a folder it offers an upgrade:

1. Ask for the game's main file and copy it into `Main\`.
2. Create `Game\<title>\` (the title with `\`, `/`, `:`, space and `.` removed; asked for if empty) with all 14 project folders, and store that path in the main file.
3. Copy the files (not sub-folders) of `Tiles, Boards, Chrs, SpcMove, Bkrounds, Media, Prg, Font, Item, Enemy, Bitmap` into it. `StatusE`, `Misc` and `Plugin` are created empty.
4. Optionally delete the old folders and `Archives\`.

Individual files are converted later, when they are opened.
