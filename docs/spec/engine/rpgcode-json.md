# RPGCode: JSON text and dictionaries

The rules of the three commands `jsonParse`, `jsonFile` and `jsonText`. Their signatures are in the [Reawakened additions table](rpgcode-functions.md#reawakened-additions-not-part-of-the-282-legacy-catalogue). This page is separate because that page holds only four-column command tables, which a check reads.

**Status: specification only. Owner direction, Jensen, 2026-11-11 (design conversation); the text below is proposed and is approved by merging the change that adds it.** No command here is implemented. Nothing in the 282-name legacy catalogue changes.

*What it does for a game author:* a JSON file is a common way to keep settings and layouts as text. These three commands let a program read one into the dictionaries it already knows how to use, and write one back out. YAML is not read by the running game: it is the notation people edit in the editor, and the editor builds JSON from it ([ADR 0019](../../adr/0019-tkr-authoring-formats.md) decision 3 keeps the YAML reader out of `core`).

**Two modes.** A program picks one when it reads and uses the same one when it writes. The two shapes never mix.

| JSON value | `"plain"` (the default) | `"typed"` |
|---|---|---|
| number | the number | `{ type: "number", value: <number> }` |
| string | the string | `{ type: "string", value: <string> }` |
| `true` | `1` | `{ type: "boolean", value: 1 }` |
| `false` | `0` | `{ type: "boolean", value: 0 }` |
| `null` | `0` | `{ type: "null", value: 0 }` |
| object | a dictionary with one key for each member | `{ type: "object", value: <dictionary of pairs> }` |
| list | a dictionary holding `length` and the keys `"0"` to `"<length - 1>"` | `{ type: "list", value: <dictionary holding a plain `length` and a pair at each number key> }` |

* **Plain is for reading.** `cfg.x` is the number in the file. It cannot tell `true` from `1`, or `false` and `null` from `0`, and it never writes `true`, `false` or `null`.
* **Typed is exact.** Every value at every depth, the outermost one included, is a dictionary with exactly the two keys `type` and `value`, created in that order. Any JSON text read in typed mode and written in typed mode gives JSON with the same values. A condition must test `.value`: `if (cfg.value.visible.value)`.
* **Lists.** `length` is created first and is always a plain number, in both modes, because it is bookkeeping and not data from the file. Then come the keys `"0"`, `"1"` and so on, in order. `list[i]` reads entry `i`, because a number key is written as its digits ([OOP-10](rpgcode-modules-and-objects.md#oop-10), "what a key can be"). An empty list is a dictionary holding only `length` = 0, so it differs from an empty object. This is the convention `battleenemydata` already uses for `specialmoves`, with the count kept inside the list.
* **Key order and spelling.** Members are created in the order they appear in the text, so enumeration follows the file (OOP-10, enumeration order). A member name that appears twice keeps its first position and its last value. JSON member names keep their case, as every string key does, so a name with a capital letter is read with brackets: `cfg["Title"]`, not `cfg.Title`, which reads the key `title` (OOP-10, key spelling).
* **What comes back.** Dictionaries made by these commands are ordinary dictionaries: they are saved, restored, compared and collected like any other. A text whose outermost value is a number or a string gives that number or string in plain mode.

**Writing.**

* In plain mode a number is written as a number, a string as a string and a dictionary as an object, except that a dictionary is written as a **list** when it holds `length`, a whole number `n` of 0 or more, and its only other keys are exactly `"0"` to `"<n - 1>"`. A dictionary built in that shape on purpose is therefore written as a list. A script that adds an entry to a list must also raise `length`, or the dictionary no longer passes the test and is written as an object.
* In typed mode every value must be a well-formed pair whose `type` is one of the six names above and whose `value` fits it (for `boolean`, 1 or 0; for `null`, anything, and `null` is written). Anything else is the catchable error `json.shape`. Nothing is recognised by its shape, so there is no guessing.
* Members are written in enumeration order. A list is written from `"0"` to `"<length - 1>"`.

**Errors.** All are catchable runtime errors with the located form of [ERR-2](rpgcode-errors-and-threads.md#err-2), which gains these rows when the commands are built. A failed call makes no dictionary and changes nothing.

| Code | When |
|---|---|
| `json.syntax` | the text is not JSON; the message gives the line and column in the text |
| `json.mode` | `mode` is neither `"plain"` nor `"typed"` |
| `json.too-large` | the text, the nesting depth or a list is over the limit |
| `json.shape` | `jsonText` in typed mode met a value that is not a well-formed pair |
| `json.unsupported` | `jsonText` met a value JSON cannot hold: a callable, a class instance, a number that is not finite, or a dictionary that contains itself |

**Limits (proposed; the owner sets them).** Text of at most 1 MiB, nesting of at most 64 levels, and a list of at most 1,000,000 entries, which is also the largest index a number key writes exactly. A parse is one script step however long the text is, so the limit is what keeps a tick bounded.

**Guard-rails.** G1: the result is plain dictionaries in the `objects` list and no hidden state. G2: `jsonParse` and `jsonText` touch no host; `jsonFile` reaches the file only through an AD-17 `asset` request. G3: the same text gives the same values, key order and state hash on every engine.

**Not decided.**

* What a dictionary is in a condition. The truth test is stated for numbers and strings only. Until it is ruled, `if (cfg.visible)` on a typed pair is not a test of the JSON value, and the help text must say so.
* How a number is written as text. It must read back as the same number, which the 6-significant-digit conversion of [values, scope and conversion](rpgcode-runtime.md) does not do. The implementing story names the rule and shows it is the same on every engine (G3).
* Whether a key that holds the unset value is left out by `jsonText` or is an error.
* The text encoding `jsonFile` expects (UTF-8 is proposed, with or without a byte-order mark).
* A command that appends to a list and raises `length` in one call. It cannot be named `push`, which is a movement command.
* The corpus check that no legacy program defines `jsonParse`, `jsonFile` or `jsonText`, as was done for `bindingOf`.
