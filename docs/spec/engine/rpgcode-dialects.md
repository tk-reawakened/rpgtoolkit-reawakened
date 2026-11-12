# RPGCode: older dialects (Toolkit 2.x and Toolkit 1.x)

Games survive from two earlier Toolkits, and their scripts are not 3.1 source. Each runs through its own frontend — the Toolkit 2.x frontend, or a Toolkit 1.x frontend when one is added — and the 3.1 parser never sees these forms. A file written for the 3.1 editor uses none of them. The 3.1 editor shipped an **update wizard**, so a rebuild should either accept these forms or provide an equivalent converter.

The 3.1 language is in [rpgcode-language.md](rpgcode-language.md); modules and the `system.` namespace are in [modules and objects](rpgcode-modules-and-objects.md).

> **Correction (3.1 amendment).** Earlier versions of this section — and ADR 0004 — said Toolkit 2.x used `< … >`
> block delimiters. That is wrong. The `< … >` form with `then` is **Toolkit 1.x only**; Toolkit 2.x uses `{ }` blocks
> exactly like 3.1. A Toolkit 2.x corpus of 268 programs contains 3,120 `{` and no `<`, while the Toolkit 1.4 demo uses
> the `< >` form. ADR 0004 still carries the old claim, and correcting it is an open question in [rpgcode-language.md](rpgcode-language.md).

## Toolkit 2.x

This is the dialect most surviving games use.

<a id="reawakened-project-script-dialect"></a>
**Reawakened project boot.** A project launched from a Toolkit 2.x main file uses the 2.x frontend for its program files. Select it once from main-file version 2.0–2.2, including the supported 2.x text form. Later main-file versions use the 3.1 frontend. File references carry the selected dialect through startup, board and item programs, includes and later file calls. Engine and bundled package source declared as 3.1 continues to use 3.1. The source bytes stay unchanged. See [main-file version history](../formats/legacy/older-binary-versions.md#main-file-minor-history) and [boot](main-loop-and-startup.md#reawakened-boot-sequence).

* **`#` is the statement introducer**, stripped before parsing, and it appears on essentially every statement: commands
  (`#MwinCls`), control flow (`#If`, `#While`, `#For`), assignments (`#x! = 1`, `#a$ = "…"`), `#Method`, `#Include`. A
  keyword is case- and spacing-insensitive: `#if(cond)`, `#If (cond)` and `#IF` are the same.
* **Blocks are `{ }`.** A block may be written on the header line (`#If (c) { … }`) or with its brace on the next line.
* **`#For(init; cond; step)`** uses `;` between its three parts, like the 3.1 `for`; the parts may be empty.
* **Labels and flow.** `:label` defines a label; `#Branch(:label)` and `#FBranch(:label)` jump to it (goto, with no
  return). `#FBranch` is an exact alias of `#Branch` (and `fbranch` in 3.1 is an alias of `branch`;
  [facts-round-6.md](../../provenance/facts-round-6.md) Q8). `#Empty` and `#FBranch` are provided by the Toolkit 2.x
  compatibility plugin.
* **User commands.** `#Method name(params)` … `#ReturnMethod(v)` defines a command and returns a value. `#Method` is the
  Toolkit 2.x keyword and is the same keyword as 3.1's `function` — neither is legacy. `#ReturnMethod(v)` is the Toolkit 2.x
  return and maps to 3.1 `return v`; there is no `returnMethod` in 3.1, so that one spelling is pre-3.1 only.
* **Comparisons.** Inside a `#If` or `#While` condition a **single `=` is equality** (the help says "you can use one equal
  sign"); the comparison set is `==`, `!=`, `~=`, `<`, `>`, `<=`, `>=`. `!=` is a second "not equal" spelling alongside
  `~=` (3.1 accepts both, [rpgcode-language.md](rpgcode-language.md)). This rule is Toolkit 2.x only: in 3.1 `=` is
  assignment.
* **Includes and redirects.** `#Include(filename$)`, an implicit namespace include `#lib.method(args)` (loads
  `Prg/lib.prg` and calls `method`), `#Redirect(old, new)`, `#KillRedirect(name)` and `#KillAllRedirects()`. The
  `#Redirect` operands may themselves be `#`-prefixed names and the target may be an implicit `file.method` — for example
  `#redirect(#a, #b.c)`.
* **`#RPGCode(expr)`** (or `rpgCode(expr)`) evaluates `expr` as a fresh RPGCode statement, a leading `#` allowed, in the
  current scope. This is how a Toolkit 2.x program builds a variable name or emulates an instance: it concatenates a
  command string and runs it.
* **`<var>` splices a variable into message text.** A string passed to a message or text built-in (`mwin`, `text`, …) has
  every `<name>` replaced by the value of `name` — the same expansion the `spliceVariables` built-in performs.
* **`*` comment** starts a line comment when it is the first non-blank character, **and** it may follow a completed
  statement on the same line (`#InternalMenu(3) * Opens Details Menu *`). In a line introduced by `#`, a star
  separated by whitespace from a standalone command's closing parenthesis starts a comment through the end of
  that line. Stars inside its arguments or quoted text keep their ordinary meaning. Discarding the comment keeps
  later diagnostic line numbers unchanged.
* **`@` on a line of its own** writes a blank Message-Window line.
* **Unquoted string arguments** (`#Mwin(Hello there)`, `#SetImage(title.gif, …)`) are read as strings, and a variable name
  may be passed where a value is wanted.
* **Loose text lines** with no `#`, `*`, `:` or brace are shown as dialogue.

**STX-7.** Loose text lines and `#Mwin` unquoted arguments exist only in legacy files; accepting them is the frontends' and the converter's job, not the 3.1 parser's.

## Toolkit 1.x

Toolkit 1.x (RPGCode v1) is not in the first release.

* Blocks are `< … >`, and an inline block is introduced by `then` (`if (c) then < … >`). Loose text lines are common. This
  dialect is out of scope for the first release; a Toolkit 1.x frontend can be added later through the same seam.

## Toolkit 2.x spellings a 3.1 reader may meet

| Legacy form | 3.1 meaning |
|---|---|
| `#Mwin(Hello there)` with unquoted string args | `mwin("Hello there")` |
| `if (x = 5)` (`=` as comparison inside a condition) | `if (x == 5)` |
| unquoted map keys `m[key]` | `m["key"]` |
| `x! = 1`, `name$ = "a"` | sigils ignored (`x = 1`, `name = "a"`) |
| loose text lines (no `#`) shown as dialogue | `mwin("…")` |
| `#Method` | `function` — the same keyword; neither is legacy |
| `#ReturnMethod(x)` | `return x` (pre-3.1 spelling; 3.1 has no `returnMethod`) |
| `* comment` lines | comments |
| `#Dos`, `#Windows`, `#Gone`, `#Over`, `#Reset`, `#Win` | obsolete engine controls |

**References.** `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-vm/discovery/` (the Toolkit 2.x coverage study and the TK2/community material survey); [ADR 0004](../../adr/0004-script-ast-step-ir-and-plugins.md); the guard-rail on clean-room provenance ([guardrails.md](../../guardrails.md), G7).
