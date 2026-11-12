# RPGCode: quirks

**Status: a guide, not a rule.** Every entry points at the rule it comes from, and where this page and that rule disagree, the rule wins. Nothing here changes the language.

RPGCode is an old language with habits of its own. Most were set by RPG Toolkit 3.1 and are kept so that old games still play. A few are choices this project made. This page collects the ones most likely to surprise someone who has written code in another language.

Each entry says what happens, shows it, and says what to write. **3.1** marks behaviour kept from Toolkit 3.1. **Reawakened** marks a rule of this project, and says so when it differs from 3.1.

## True and false

### An empty string is true

A string counts as true unless it is the word `off` (in any letter case). So `""` is true. A number is true when it is not zero.

```
name = ""
if (name) { mwin("this line runs") }
```

Write the test you mean: `if (name ~= "")`.

*3.1.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion).

### `true`, `false` and `null` are numbers

`true` is 1. `false` and `null` are both 0. Once stored, a `false` cannot be told from a `null` or from a plain 0.

*3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules) (LEX-9).

### Both sides of `&&` and `||` always run

There is no short-circuit. Every part of `a && b`, `a || b` and `a ? b : c` is worked out, even when the first part already decides the answer.

```
if (hero ~= 0 && hero.hp > 0) { … }   // hero.hp is read even when hero is 0, and that is an error
```

Nest the tests instead:

```
if (hero ~= 0) {
  if (hero.hp > 0) { … }
}
```

The same applies to a call with a side effect: in `ready() || load()`, `load()` always runs.

*3.1.* Rule: [compatibility notes](rpgcode-language.md#compatibility-notes), note 2.

### One `=` in a condition assigns

`if (x = 5)` stores 5 in `x` and then tests 5, which is true. Equality is `==`.

*3.1.* Rule: [expressions](rpgcode-language.md#expressions) (EXP-4). Files read as Toolkit 2 code are the exception ([older dialects](rpgcode-dialects.md)).

### `!=` means "not equal" here, and did not in 3.1

In Toolkit 3.1, `if (opt!=1)` assigned 1 to `opt`, because `!` after a name was a type mark. Here `!=` written with no space is "not equal", the same as `~=`.

*Reawakened, differs from 3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules) (LEX-3).

## Numbers

### Reading a number from a variable drops its fraction

When a number is read **from a variable by name** and used in arithmetic, a comparison, a numeric argument or an array index, it is first cut down to a whole number (toward zero, 32 bits). A number written in the code, or the result of a calculation that has not been stored yet, keeps its fraction. Storing the value and turning it into text also keep it.

```
x = 1.5
y = x + 0      // y is 1
z = 1.5 + 0    // z is 1.5
```

Keep values that need a fraction as whole units: pixels, ticks, hundredths. A variable above 2,147,483,647 wraps round for the same reason.

*Reawakened; 3.1 also truncated, and differed for values that are not ordinary numbers.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion), "the name-read truncation".

### A number turned into text keeps six digits

```
mwin("Gold: " + 1234567)    // shows Gold: 1.23457e+06
```

Any number of a million or more, or with more than six digits that matter, is rounded and may be shown with an exponent. Keep displayed numbers under a million, or split them into parts before showing them.

*3.1 printed six digits; the exact rounding is Reawakened.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion), "number to string".

### Large array indexes collide

An array index is stored as that same six-digit text. So `a[1234567]` and `a[1234568]` are the same element. Indexes below 1,000,000 are safe.

*Reawakened.* Rule: [unset variables and array elements](rpgcode-runtime.md#sem-5--unset-variables-and-array-elements).

### `+` joins as soon as one side is text

```
1 + "2"          // "12", not 3
"Hello " + 32    // "Hello 32"
```

Turn text into a number first with `castNum` when you mean to add.

*3.1.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion), worked values.

### Comparing text and numbers

| Expression | Result | Why |
|---|---|---|
| `5 == "5"` | 1 | the number becomes the text `"5"` |
| `"5.0" == 5` | 0 | `"5.0"` and `"5"` are different text |
| `"abc" == "ABC"` | 0 | text is compared exactly, letter case included |
| `"10" < "9"` | 0 | `<` and `>` always compare as numbers |
| `"abc" < "abd"` | 0 | text that is not a number counts as 0, so there is no alphabetical order |

*3.1.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion).

### Dividing by zero is not an error, but remainder by zero is

`7 / 0` gives infinity and the program carries on. `7 % 0` is a runtime error. `%` cuts both sides to whole numbers first, so `7 % 0.5` is also a remainder by zero.

*`/` is 3.1; the `%` rule is Reawakened.* Rule: [comparison and conversion](rpgcode-runtime.md#sem-3--comparison-and-conversion); [ERR-2](rpgcode-errors-and-threads.md#err-2).

### `^` is power, and `-2^2` is 4

`^` raises to a power. It is worked out after a leading minus, so `-2^2` is `(-2)^2`. It also groups from the left: `2^3^2` is 64. Exclusive-or is the backtick `` ` ``.

*3.1.* Rule: [expressions](rpgcode-language.md#expressions) (R-30).

## Names and variables

### A misspelt name is a new variable

Nothing is declared. Reading a name that was never set gives 0 (or empty text) and creates the variable. A typing mistake is therefore never reported; it reads as 0.

```
playerGold = 50
if (playerGlod > 10) { … }   // never true, and no error
```

*3.1.* Rule: [unset variables and array elements](rpgcode-runtime.md#sem-5--unset-variables-and-array-elements).

### A variable set inside a function is global

A plain `x = 1` anywhere makes or changes the global `x`, unless a local of that name already exists. Write `local(x) = 1`, or call `autoLocal(true)` once in the program. There is no block scope either: a variable made inside an `if` or a loop lasts for the whole function.

*3.1.* Rule: [scope and visibility](rpgcode-runtime.md#sem-4--scope-and-visibility).

### Letter case is ignored in names, and `x`, `x!` and `x$` are one variable

`Gold`, `gold` and `GOLD` are the same name. A `!` or `$` on the end of a name is an old type mark and is ignored, so `gold!` is `gold` too.

*3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules) (LEX-10, sigils).

### Letter case is kept in text keys

A key written as text keeps its case, so `stock["Potion"]` and `stock["potion"]` are two entries. A key written with a dot is a name, and names are lower-cased: `cfg.Title` reads the key `title`, and never a key spelt `Title`. Use `cfg["Title"]` for that.

*3.1 for arrays; Reawakened for dictionaries.* Rule: [unset variables and array elements](rpgcode-runtime.md#sem-5--unset-variables-and-array-elements); [OOP-10](rpgcode-modules-and-objects.md#oop-10), "key spelling".

### A name can start with a digit

`2x` is a name, not a mistake for `2 * x`. So is `1e`.

*3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules) (LEX-2).

## Arrays and dictionaries

### An array is not a thing you can pass around

`a[1]` is simply a variable whose name is `a[1]`. There is no "array `a`" behind it: it has no length, and it cannot be handed to a function or returned from one. `a[1]`, `a["1"]` and `a[1.0]` are the same element. Reading an element that was never set gives 0, with no error.

When you need a list you can pass, use a dictionary: `list = { length: 0 }`, then number keys.

*3.1.* Rule: [compatibility notes](rpgcode-language.md#compatibility-notes), note 6; [unset variables and array elements](rpgcode-runtime.md#sem-5--unset-variables-and-array-elements).

### A word in `[ ]` is a variable, even in an old Toolkit 2.x script

`m[key]` uses the value of the variable `key` as the index. Only `m["key"]` uses the text `key`. Some old Toolkit 2.x scripts may have meant `m[key]` as the text `key`, but they are read the same way as 3.1, so a working game keeps reading the same entries.

```
key = "sword"
m[key] = 1       // sets m["sword"]
m["key"] = 2     // sets the entry named key
```

Quote a text key. The Toolkit 2.x converter keeps `m[key]` as it is and adds a `// TKR review:` comment so you can check what was meant.

*Reawakened (owner ruling, #2101).* Rule: [bare index](rpgcode-dialects.md#tk2-bare-index); [values and variables](rpgcode-language.md#values-and-variables) (EXP-1).

### Assigning a dictionary does not copy it

```
a = { hp: 10 }
b = a
b.hp = 0       // a.hp is now 0 as well
```

Both names hold the same object. `a == b` asks whether they are the same object, not whether their contents match.

*Reawakened.* Rule: [OOP-10](rpgcode-modules-and-objects.md#oop-10); [assignment between objects](rpgcode-modules-and-objects.md#assignment-between-objects-oop-4).

### A missing key is 0, but a member of a non-object is an error

`cfg.volume` on a dictionary with no `volume` gives 0 and no error. `x.volume` when `x` holds a number is a runtime error.

*Reawakened.* Rule: [OOP-10](rpgcode-modules-and-objects.md#oop-10), "reading a key that is not there".

## Writing code

### `**` starts a comment

`**` comments out the rest of the line, as `//` does. It is not a power operator: `2 ** 3` is the number 2 followed by a comment. A line whose first character is `*` is a comment too, so do not begin a continued line with a multiplication sign.

*3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules), comments.

### Text has no escape characters

`"…"` cannot contain a `"` or a line break, and `\n` is two ordinary characters. Build such text from pieces, using `chr` for the character you cannot type.

*3.1.* Rule: [lexical rules](rpgcode-language.md#lexical-rules) (LEX-8).

### Braces are required

`if (x) y = 1` is not valid. Every `if`, `else`, `while`, `until` and `for` needs `{ }`.

*3.1.* Rule: [keywords and structure](rpgcode-language.md#keywords-and-structure) (STX-1).

### `until` tests before it runs, and `switch` does not fall through

`until (done) { … }` checks first, so the body may never run. It is not a "do, then test" loop. In a `switch`, each `case` runs only its own block.

*3.1.* Rule: [keywords and structure](rpgcode-language.md#keywords-and-structure) (SEM-2, STX-2).

### A name alone on a line is a call

A line that is only `save` means `save()`. A variable name left alone on a line is therefore taken as a command, and reported as one that does not exist.

*3.1.* Rule: [keywords and structure](rpgcode-language.md#keywords-and-structure).

### Put `++x` in brackets before another operator

`++x == y` could be read wrongly by the original grammar. Write `(++x) == y`.

*3.1.* Rule: [compatibility notes](rpgcode-language.md#compatibility-notes), note 7.

## Functions

### Only the number of arguments chooses a function

Two functions with the same name are told apart by how many parameters they take. A type written before a parameter is a note for the reader; it is not checked. There are no default values.

*3.1.* Rule: [keywords and structure](rpgcode-language.md#keywords-and-structure) (FUN-1, FUN-5).

### The function decides what is passed by reference

A parameter written `&name` in the function receives the caller's variable itself. The caller writes nothing special. `&x` in a call is the "and" operator, or an error.

*3.1.* Rule: [expressions](rpgcode-language.md#expressions) (EXP-3).

### A function named like a built-in command is not called

If you write your own `mwin`, calls to `mwin` still run the engine's. You get a warning when the program loads.

*3.1; the warning is Reawakened.* Rule: [built-in commands](rpgcode-functions.md), compatibility notes (R-35).

### `end()` inside an included function ends the whole program

A function from an included file is part of the program that included it. `end()`, `done` and `stop` there end that program, at any call depth.

*3.1.* Rule: [keywords and structure](rpgcode-language.md#keywords-and-structure) (FUN-7).

## Errors

### An error does not stop the program

With no handler, a runtime error is reported and the program carries on from the next step. A call that failed gives 0. Code after a failed call runs with that 0.

*3.1.* Rule: [ERR-2](rpgcode-errors-and-threads.md#err-2).

### A handler only covers its own function

An error handler can be set inside a function only, and it sees errors raised in that function. An error inside a function it calls is not passed back up. Each function that can fail needs its own handler.

*3.1.* Rule: [ERR-1](rpgcode-errors-and-threads.md#err-1--the-handler-its-label-and-resumenext).

### "Resume next" can continue in the middle of a statement

`setResumeNextHandler()` swallows the error and continues at the next step, which may be partway through the statement that failed, with the failed call counted as 0. `resumeNext()` inside a labelled handler is the one that continues at the following statement.

*3.1.* Rule: [ERR-1](rpgcode-errors-and-threads.md#err-1--the-handler-its-label-and-resumenext).

## Files and time

### The end of a file looks like a blank line

Reading past the end of a file gives empty text and no error, the same as reading a blank line. Test `fileEof` to know which it was.

*3.1.* Rule: [files](rpgcode-runtime.md#files).

### `threadSleep` with 0 sleeps until woken

A sleep of exactly 0 seconds is not "no sleep". The thread stays asleep until `threadWake`. Any other time is rounded to whole ticks, 60 to the second, and is at least one tick.

*3.1 for the meaning of 0; the tick rule is Reawakened.* Rule: [THR-1](rpgcode-errors-and-threads.md#thr-1--the-sleep-its-unit-and-wake-order).

### `getTickCount` counts game time

It returns milliseconds since the game started, counted in game ticks. It is not the computer's clock.

*Reawakened, differs from 3.1.* Rule: [built-in commands](rpgcode-functions.md), compatibility notes (Ruling 5).

## Not yet ruled

These are gaps in the rules, not quirks. They are listed so nobody builds on a guess.

* **What a dictionary is in a condition.** The truth test is stated for numbers and text only. Test a field, not the dictionary.
* **Whether `++x` before an operator can still be misread** by this project's parser, or only by the original one.

## Adding to this page

An entry belongs here when a rule in `docs/spec/engine/` would surprise someone and has a simple thing to write instead. State what happens, show it in a few lines, say what to write, mark it 3.1 or Reawakened, and link the rule. If the rule is missing or unclear, fix the rule's page first.
