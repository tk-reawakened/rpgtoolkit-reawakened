# Menu, HUD and battle screens: layouts and settings

Part of the [editor ecosystem proposal](README.md). **Proposed**, from the owner's direction of 2026-11-11. It adds no ticket and no file format yet. The RPGCode commands it relies on are specified in [rpgcode-functions.md](../spec/engine/rpgcode-json.md) and are not built.

## In plain terms

Toolkit 3 had no menu editor, no screen overlay editor and no way to change how battles work without writing a program. The menu and the battle screen were drawn by plugin code, and an author who wanted them different had to rewrite that code.

Here the stock menu and battle systems are RPGCode packages (`stock/stock_menu`, `stock/stock_battle`). A package can read a file. So:

1. An author arranges a screen in one visual designer: where the text, bars, lists, portraits and buttons go, and what each one shows.
2. The editor saves that as a layout document, and builds a small JSON file from it.
3. The stock package reads the JSON file when it starts and draws the screen from it.

The same designer serves the menu screens, an overlay shown while walking around (a HUD) and the battle screen. Battle settings (numbers such as charge speed) travel the same way without a designer: a form in the editor, a JSON file, read by the battle package.

The engine does not change. It gains no file reader. A game with no layout file plays exactly as it does today.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| Layout document | What the author edits: named elements, their positions and what each shows. A native text document with a stamp, like every `.tkr*` file | The project; editor-only, not shipped |
| Built layout file | The same content as JSON, with positions resolved to whole pixels and nothing the game does not need | The project; **shipped** with the game |
| Binding list | For each kind of screen, the fixed list of things an element may show and things a button may do | Published by the package that draws the screen |
| Designer | One specialist view in `editor-ui` for every layout | The editor |
| Reader | A few lines in the package: `jsonFile`, then draw from the dictionary | `stock_menu`, `stock_battle`, and any package that wants a HUD |

### What a layout holds

Mostly coordinates and asset paths. A sketch of a built file, to show the scale of it and not to fix a format:

```json
{
  "screen": "menu.main",
  "size": { "width": 640, "height": 480 },
  "elements": [
    { "kind": "image", "x": 0, "y": 0, "file": "Bitmap/menu_back.png" },
    { "kind": "text", "x": 24, "y": 16, "show": "party.1.name" },
    { "kind": "bar", "x": 24, "y": 40, "width": 120, "height": 8, "show": "party.1.hp", "of": "party.1.maxhp" },
    { "kind": "list", "x": 200, "y": 16, "rows": 6, "show": "menu.entries" },
    { "kind": "button", "x": 24, "y": 420, "label": "Save", "do": "menu.save" }
  ]
}
```

* Every number is a whole pixel, so the plain mode of `jsonParse` reads it without loss.
* The built file uses lower-case member names, `1` and `0` for yes and no, and no `null`, so a package never needs the typed mode.
* `elements` is a list, so the package walks it from `0` to `length - 1`. Order in the list is drawing order.

### The binding list is the real work

A designer can only offer what a screen is able to show. Each package that draws a screen must publish, as data:

* the **screens** it has (for the stock menu: main, inventory, equipment and abilities, [E-80](../spec/engine/plugins-and-battle.md#e-80));
* for each screen, the **values** an element may show (`party.1.hp`, `menu.entries`, `selected.item.description`) with a plain description of each;
* the **actions** a button or a list row may trigger (`menu.save`, `menu.close`, `item.use`);
* **sample data** for the designer's preview, so a screen can be drawn without running a game.

A layout that names a value or action not on the list is reported in the editor before it is ever built. This list is a [level 0 and level 1 contribution](extensions.md#three-levels) in the sense of the extensions page, and the stock packages are its first users.

## The three screens

| | Menu | HUD | Battle screen |
|---|---|---|---|
| Was there a Toolkit 3 version? | Yes, drawn by the menu plugin | No | Yes, drawn by the battle plugin |
| Screens | Four, fixed | One or more overlays, the author's choice | One |
| Must match today's look by default? | Yes | Nothing to match | Yes |
| Extra rule needed | None | When it is shown and hidden: dialogue, battle, menus, a script's request | Positions of fighters, which move when the party size changes |
| Size of the binding list | Small and known | Party values and script variables | Largest: fighters, charge, targets, commands |

Suggested order: **menu**, then **battle settings**, then **HUD**, then **battle screen**. The menu proves the document, the built file and the designer on the smallest known surface. Battle settings need only the schema-driven form. The battle screen is last because its binding list is the largest.

## Battle settings

Three layers, cheapest first. Only the first two are new.

1. **Settings.** Numbers and choices the stock battle package already uses, shown as a form and built into a JSON file the package reads at start. Which numbers exist is for the package to publish; examples would be charge speed, party size and the chance to run.
2. **Screen.** The battle screen as a layout, above.
3. **Rules.** Anything a setting cannot express stays in RPGCode: a custom fight program, and the `beforeDamage` event a listener can change ([EMIT](../spec/engine/rpgcode-modules-and-objects.md#emit-1) table). No formula language is added.

## Rules that keep old games safe

* **No file, no change.** If a layout or settings file is absent, the package draws and behaves as it does now. The default look is the package's own code, not a shipped file that could go missing.
* **Defaults are today's values.** Every battle setting defaults to the current behaviour, and any golden test that covers the stock menu or battle keeps passing unchanged (G5).
* **Read once.** A package reads its files when it starts and keeps the dictionaries. It does not read a file each time a menu opens, because a file read is a wait.
* **A bad file is reported, not fatal.** A file that is not JSON, or names an unknown value, gives a diagnostic and the default screen.
* **Packaging.** The built JSON files are game files and are shipped. The layout documents are editor files and are not ([ADR 0019](../adr/0019-tkr-authoring-formats.md) decision 6). Story 12.9 would need both rules.

## Admission test

The [six questions](document-kinds.md#admission-test-for-a-new-kind) for the layout document:

| # | Question | Answer |
|---|---|---|
| 1 | Whose task is this? | "Redesign my menu, add a health bar while I walk around, change how the battle screen looks", for an author who does not write programs. Owner direction, 2026-11-11. It still needs the creator evidence the [experience bank](../editor-experience-bank.md) asks for before it is promoted. |
| 2 | Why can no existing document hold it? | No Toolkit 3 file describes a menu, an overlay or a battle screen. A skin is two images (T-64). Putting a layout in a program makes it code again. |
| 3 | How does the game use it? | Lowered: the editor builds a JSON file, and an RPGCode package reads it with `jsonFile`. No engine reader, no ADR for one. It does need the three `json*` commands built. |
| 4 | What does a change look like in Git? | One document per screen; one element per block; moving an element changes its `x` and `y` lines. |
| 5 | What refers to it and what does it refer to? | It refers to pictures and fonts, and to names on a package's binding list. The package refers to the built file by a fixed name per screen. |
| 6 | Which editor first? | A specialist view (the designer) with the schema form as its inspector. Battle settings need the form only. |

## Open questions

1. **The built file's name and folder**, and whether one file holds one screen or all of a package's screens.
2. **The layout document's contract**: its name, extension and fields. Written as a contract page when the menu case is planned, never before.
3. **Anchoring.** Whether an element's position is a fixed pixel or is tied to an edge or the centre, for games that change resolution (AD-33).
4. **Text.** How an element names a font and size, given that text and fonts are engine-owned (AD-15).
5. **Focus order.** How the keyboard and controller order of buttons and rows is stated (E-80's order and wrapping rules must hold for the default menu).
6. **The HUD's home.** Whether an overlay belongs to the stock RPG package, to a new stock package, or to the game.
7. **Third-party packages.** A battle system that is not the stock one publishes its own binding list or has no designer. Nothing here makes a layout work on a package that does not read it.
8. **Reading cost.** The script steps a package spends walking a layout at start, against the per-tick step budget. To be measured on the stock menu before the format is fixed.
9. **Fractions.** The language notes that reading a variable truncates its number to an integer ([compatibility note 3](../spec/engine/rpgcode-language.md)). Built layouts use whole pixels for that reason; a setting that needs a fraction needs that note checked first.

## What this would need, in order

Nothing below is planned or ticketed.

1. The three `json*` commands, built from [their specification](../spec/engine/rpgcode-json.md).
2. The stock menu's binding list, written down, with sample data.
3. The layout contract page and the built-file format, proved on the main menu screen with the default look reproduced exactly.
4. The designer, for the four menu screens.
5. Battle settings: the list the battle package publishes, the form, the built file.
6. HUD, then the battle screen.
