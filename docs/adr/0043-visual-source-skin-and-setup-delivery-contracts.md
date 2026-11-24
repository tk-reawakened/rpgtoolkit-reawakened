# ADR 0043 — Visual source, skin and setup delivery contracts

* **Status:** Proposed (2026-11-24). A draft for the owner to answer; **nothing here is decided**. Every numbered decision is a question with options, a recommendation and what it unblocks. Story 14.1 ([#1744](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1744)) stays open until the owner approves.
* **Date:** 2026-11-24
* **Context documents:** [0005](0005-independent-product-v1-and-native-format.md), [0008](0008-rpgcode-packages-and-trust-baseline.md), [0009](0009-compatibility-layer-not-the-model.md), [0013](0013-desktop-shell-electron.md), [0022](0022-shared-editor-authoring-contracts.md), [0026](0026-editors-are-registered-by-document-kind.md), [0034](0034-tiered-dependency-licence-policy.md), [0038](0038-every-editor-action-is-a-registered-command.md), [editor-features.md](../editor-features.md) (T-09, T-45, T-64, T-70, T-72), [main-file.md](../spec/formats/main-file.md), [packaging-and-paths.md](../spec/formats/packaging-and-paths.md#install-descriptor), [launcher.md](../spec/engine/launcher.md), [rpgcode-tooling.md](../spec/engine/rpgcode-tooling.md) (creator tests, entry 11.9), [screen-layouts.md](../editor-ecosystem/screen-layouts.md), and the Epic 14 plan `story-rule-visual-source-and-setup-delivery-contracts-plan.md`.
* **Does not reopen:** the selected Monaco editor and Electron desktop shell (ADR 0013), the document lifecycle and path identity (ADR 0022), the kind registry (ADR 0026), the creator-test contract approved on 2026-11-09 (rpgcode-tooling.md), or the 12.9 distribution package and install descriptor.

## In plain terms

Epic 14 gives beginners four tools: a **visual event builder** (pick "Show a message", fill in the words, get a program), a **screen-layout canvas** (place things where you want them), a **skin editor** (the look of windows and buttons) and a **setup builder** (something your players can install). Each one touches something that must have exactly one owner, or work gets lost or silently rewritten. Five questions need your answer before anyone builds them:

1. When the visual builder and the code editor show the same program, **which one is the real file**, and what happens to code the builder does not understand? (Recommendation: the program text is always the real file; the builder shows what it can and leaves the rest alone.)
2. **Who owns a position** placed on the layout canvas, and can it be typed as well as dragged?
3. What is a **skin**, where is it saved, and does it change a game or only the editor's picture of one? (Toolkit 3's two skin fields are ignored by the engine today.)
4. How do **test fixtures** that a beginner sets up visually become the real tests the code editor already runs?
5. What does **"Create setup"** produce, for which computers, and what must it never do to a player's machine?

Technically: each question lists options, tradeoffs and a recommendation. Recommendations are the author's, not the owner's. Facts are from the repository; anything inferred is marked **[INFERENCE]**.

## Context

* **Some authority is already ruled.** ADR 0022 D10 forbids an arbitrary code-to-visual round trip. The creator-test contract (rpgcode-tooling.md, entry 11.9) was approved on 2026-11-09 and fixes the operations `specFixture`, `specAction`, `specValue` and `specWait`, the `*.spec.prg` file form and the reserved `.tkr-tests/` folder. The owner left its RPGCode spellings and numeric limits to the implementing agent under the 2026-11-15 epic 11 delegation. That delegation is not a ruling on them, so they are treated as the current contract, not as approved wording.
* **T-45** ([editor-features.md](../editor-features.md)): "form-based … categories (Text, Display, Player, Fight, Control, Items, Variable manipulation, Input, Info; about 160 command templates) … Build to RPGCode. A small visual screen-layout canvas comes with it." It does not say where positions live or whether generated code can be read back.
* **Skins.** `skinButton` (field 35) and `skinWindow` (field 36) of the `.gam` file are marked "legacy; ignored" in [main-file.md](../spec/formats/main-file.md), listed under fields stored but not used by the engine. No engine, runner or core code consumes them. T-64 is one line: "window graphic and button graphic". [Screen layouts](../editor-ecosystem/screen-layouts.md) is a proposal with no format yet and is a separate route to changing how menus look.
* **Setup.** T-72 is one line: "A ZIP containing the game files plus a simple installer and uninstaller". The 12.9 distribution package (T-70) is a `.tpk`-compatible ZIP whose manifest has exactly three fields, `schema`, `main` and `index`. The install descriptor is a sibling `<package>.tpk.json` with exactly seven fields. Its rule: "installing is registering: no per-game stub, no executable wrapper and no file association" ([install descriptor](../spec/formats/packaging-and-paths.md#install-descriptor)). The legacy spec also has a "Setup ZIP" (`Main/` and `Game/` folders), which is an **input** form that this project reads and never writes; this ADR does not reuse that name for output. The standalone export targets in [launcher.md](../spec/engine/launcher.md) (signed `.app`/`.dmg`, installer executables, AppImage, web zip, mobile) are a **different and larger** route from T-72's ZIP. The platform service offers `sha256` and `downloadFile` for packages today, and no service that runs an installer or signs a file.
* **Hosts.** ADR 0001 names a VS Code extension and a standalone editor (PWA first, then a desktop shell) as the two editor hosts; ADR 0013 chooses Electron for that desktop shell. [packaging-and-paths.md](../spec/formats/packaging-and-paths.md) also describes a browser host. Packaging writes two files: the package and its descriptor. In a browser these are two independent downloads. In VS Code they are written by default into `.tkr-exports/` in the project. Hosts without an output capability report packaging unavailable.

## Decisions to make

### Question 1 — Structured event source authority and the supported subset

*Plain:* the visual builder and the code editor must never disagree about what a program says, and the builder must never rewrite code you wrote by hand.

**Options**

* **1A. The program text is the only authority (a projection).** A visual view is a *view* of one `.prg` document. On open it recognises a supported subset line by line: recognised statements become cards, and everything else becomes an **opaque code block** that keeps its exact bytes. An edit in the visual view changes only the lines of the card that was edited. Switching views changes nothing in the file, and neither view can save a state the other cannot show.
* **1B. A separate structured document generates the program.** A new kind holds the cards; the `.prg` is a generated build output, read-only to the author.
* **1C. The program text with generated regions fenced by marker comments** (for example `// tkr:begin` … `// tkr:end`). Hand-written code outside the fences is kept; inside the fences the builder owns the text.

**Tradeoffs**

| | 1A | 1B | 1C |
|---|---|---|---|
| Authorities | One: the document at its path (ADR 0022) | Two: the document and the generated file | One file, but part of its text belongs to a tool |
| Hand-written code | Kept byte for byte, shown as blocks | Cannot live in the document; a program started as code cannot enter the builder without conversion | Kept outside fences only |
| Beginner who edits the code later | Free | Edits to the `.prg` are overwritten, or must be refused | Edits inside a fence are overwritten |
| Existing projects | Open as they are | Need a conversion | Need fences added |
| Cost | A recogniser per supported command | A generator and a second kind in the registry | Smallest builder, but marker comments appear in every shared program |

**Recommendation: 1A.** It meets the "no arbitrary round trip" rule (ADR 0022 D10) without a second file, is consistent with the rule that VS Code keeps native text while Monaco serves the browser, and never regenerates a handwritten program.

**Supported subset (to approve as a rule).** For 14.2 and 14.3, I propose the T-45 categories, admitted **command by command**. A command is admitted only when its saved form re-reads to the same card. A command not on the list is an opaque block, never an error. The first runnable slice (14.2) is the message action alone. **[INFERENCE]** The full list becomes a table in the 14.3 plan once the recogniser exists. The owner approves the rule, not 160 rows.

**Worked example (illustrative; spellings per rpgcode-functions.md: `mwin`, `wait`, `mwincls`)**

A creator adds the supported *Show message* card with the text `Welcome to the village.`, and waits for a key. The saved `.prg` is exactly:

```
mwin("Welcome to the village.")
wait()
mwincls()
```

A friend then adds code by hand in the text editor:

```
mwin("Welcome to the village.")
wait()
mwincls()
// the old man counts your visits
visits = visits + 1
```

Opened in the visual view, the first three lines are one *Show message* card. The last two lines (a comment and an assignment that the approved subset does not include) are **one opaque block**, shown as code and labelled "Code the builder does not edit". Editing the message to `Hello!` rewrites line 1 only. The block's bytes, its comment and its line endings stay unchanged on disk. Deleting the card removes its three lines and nothing else.

**Failure and view switching.** Switching views never saves and never rewrites. A line the recogniser cannot read becomes part of an opaque block. A failed save keeps the unsaved edits, per ADR 0022's lifecycle promises. Undo is the shared document's undo; one card edit is one undo step.

**What approval unblocks:** 14.2 (runnable tracer) and 14.3 (full authoring) start against this contract. 14.7 reads the same rule for fixtures.

### Question 2 — T-45 screen-layout canvas: placement authority and generated commands

*Plain:* a canvas where you place a message box or a picture. The question is whether the picture or the numbers are the truth.

**Options**

* **2A. The numbers are the authority; the canvas is another editor for them.** A placement is the `x` and `y` (and size, where the command has it) *parameters* of a card from Question 1. The canvas reads and writes those parameters, and nothing is saved except the program text. The generated command is the card's own command. For example `text(x, y, str)` uses square cells one current-font-size on a side with 1-based coordinates ([rpgcode-functions.md](../spec/engine/rpgcode-functions.md)).
* **2B. A separate layout document**, as proposed in [screen-layouts.md](../editor-ecosystem/screen-layouts.md): a stamped document plus a built JSON file read by a stock package. Cards would refer to it.
* **2C. A read-only canvas** that previews the cards' positions and cannot place anything.

**Tradeoffs:** 2A adds no file and no format, and meets the "no arbitrary round trip" rule. It can place only what the supported subset has a coordinate for, so it cannot lay out a menu or a battle screen. 2B is the larger layout designer that screen-layouts.md scopes as later work. It depends on `json*` commands, a binding list and a built file, and adopting it here would pull that whole feature into Epic 14. 2C gives no placing at all, which T-45 asks for.

**Recommendation: 2A.** Coordinates are authored in one place, the card, in the unit the command documents. The generated text is the program text of Question 1.

**Numeric and keyboard alternative (any option).** Each placed element can be selected by Tab and arrow keys from a list beside the canvas. The inspector shows `x`, `y` (and size) as numeric fields, with the command's unit and valid range. Arrow keys nudge by one unit and Shift+arrow by ten. Placement is therefore never pointer-only. Every action is a registered command (ADR 0038).

**What approval unblocks:** 14.3 (the canvas, save and reopen, and undo).

### Question 3 — Skin authoring and preview

*Plain:* Toolkit 3 stored two picture names for window and button looks, and the engine never used them. So what is a skin in this product? Is it only a picture in the editor, or something a game shows?

**Options**

* **3A. A new native skin document** is the authority. Its name and spelling are fixed in the 14.4 plan. It holds the window graphic and button graphic references, plus an optional label. The editor previews it **editor-only**, labelled "Preview only: the engine does not use skins yet". The `.gam` strings `skinButton` and `skinWindow` are **read and preserved untouched**. Saving a skin never writes them, and the editor never implies they take effect. No runtime consumer is promised.
* **3B. The `.gam` fields are the authority.** The editor edits the two named image files and the two strings stay in the game file. This keeps the old shape and adds no kind. But it writes a field the format marks "ignored", edits the main file for an editor-only feature, and gives no version to preserve.
* **3C. 3A, plus a separately specified runtime consumer**, for example a built layout JSON read by the stock menu package. It makes a skin change a game, but needs its own owner ruling, spec and tests, and `core`, the stock packages and the runner would all change.

**Tradeoffs:** 3A is the smallest honest contract. It can be saved, reopened and previewed without claiming gameplay support, and ADR 0005 already allows a native format where the legacy one is limited. Its cost is a document that no game reads until 3C is ruled. 3B avoids a new kind, but couples an editor tool to a legacy field the format spec calls dead. 3C is the only option that delivers a visible game change, at the price of a new provider and of overlapping with screen layouts.

**Recommendation: 3A**, with 3C recorded as a later, separate owner decision. **[INFERENCE]** This is a design choice, not a verified user need. If the owner prefers 3B, 14.4's verification still holds, because it requires preserving the legacy fields either way.

**Provider pinned before 14.4 starts.** Whichever option is chosen, 14.4 depends on the document workspace and the shared pickers that its ticket already waits on (tickets 11.3 and 11.4 in `tickets.toml`). Under 3C only, a named runtime consumer (stock package or `core` reader) must also be pinned, with its own ADR and a G1–G7 review, before 14.4 starts. 3A adds no dependency. 14.4 preserves unknown format residue and the save version, treats selection and preview as non-edits, and keeps the draft when a save fails.

**What approval unblocks:** 14.4.

### Question 4 — Visual fixtures and player action lists against the 11.9 contract

*Plain:* a beginner builds a tiny test world by clicking. It must become the real test the code editor can also run.

**Options**

* **4A. The visual editor reads and writes `.spec.prg` text.** It recognises `specFixture`, `specAction`, `specWait` and `expect(specValue(...))` statements as cards under Question 1's rule, and keeps everything else as opaque blocks. The file lives where tests live, as `*.spec.prg`, which the runner discovers. The runner uses the real engine. The 11.9 limits are validated in the form from the same constants: for example `stats` takes at most six entries, `inventory` at most 32 entries, and `specTicks` takes 0 to 1,000 ticks.
* **4B. A separate fixture document** (data) that the runner or an exporter turns into `.spec.prg`. This gives two authorities and a new reader path in the runner.
* **4C. Fixtures stay code-only in Epic 14**, with only a form that pastes a `specFixture` call.

**Tradeoffs:** 4A reuses Question 1's single authority and the runner. It adds no engine change and no format, and keeps the rule that a visual dependency does not block code tests (epic decision of 2026-11-08). Its cost is that a hand-edited spec outside the supported cards shows as opaque blocks. 4B gives a cleaner form model but duplicates the contract. 4C gives a beginner nothing they can use.

**Recommendation: 4A.** One card is one TOOL-5 call. The form's validation uses the TOOL-5 limits, and its diagnostics are the runner's own located `spec.*` codes. Distribution exclusion is already enforced: `producedArchiveViolations` in `packages/editor-model/src/package-export.ts` rejects `*.spec.prg` and anything under `.tkr-tests/`, and [packaging-and-paths.md](../spec/formats/packaging-and-paths.md) states that the exclusions are verified on the produced archive. 14.7 relies on that check. **[INFERENCE]** 14.7's acceptance test for a deliberately broken fixture would run through the runner, with no mock or second simulator.

**What approval unblocks:** 14.7 (fixtures and action lists).

### Question 5 — Setup delivery (T-72) from the 12.9 package

*Plain:* "Create setup" must hand a friend something they can install, run and remove. Today a game is a package that the player app *registers*. Which of those do we build?

**Options**

* **5A. Setup = a ZIP of the 12.9 package, its descriptor and a plain-text how-to, with no executable.** Installing is the player app's own **Install** (register the package, validated against the descriptor's SHA-256 and size). **Remove** unregisters it. Nothing is signed by us, and nothing executes on the recipient's machine. A browser can download the ZIP, but cannot install; the web player is then the install target.
* **5B. Setup = native standalone installers per OS**, from the standalone route in launcher.md: signed and notarised `.app`/`.dmg`, an installer `.exe`, an AppImage or archive, built from the Electron desktop shell. This needs signing credentials, per-OS build hosts, an uninstaller owned by the OS installer technology, and a release path in ADR 0013's licence inventory.
* **5C. 5A now, 5B later.** Ship the ZIP route in 14.6 and rule the native route as a separate owner decision that names its signing credentials.

**Tradeoffs:** 5A needs no signing, no privileges and no uninstaller of its own, and honours "installing is registering". It cannot give a recipient a double-click installer unless the player app is already installed. 5B delivers that experience and the storefront route, but it is the whole standalone-export feature of launcher.md. It needs credentials only a human can supply, adds per-OS release engineering, and every bundled binary carries ADR 0013's Chromium and ffmpeg licence inventory. 5C keeps both options and delays the native route.

**Recommendation: 5C.** Rule 5A completely now (14.6 builds it). Ask for 5B's targets, signer and credentials as a later decision.

**Contract to approve for 5A (and the checklist 5B would also have to meet)**

* **Inputs:** only a 12.9 package and its descriptor. The setup ZIP is a third artefact, distinct from the editable project and from the game package. It never contains `Saved/`, history, exports, creator tests or editor-only files (the existing inventory rules), and never contains the engine.
* **Review before writing:** the author sees the destination, the file list and the dependency list. Cancelling at any point writes nothing and leaves the package and descriptor untouched.
* **Install and uninstall safety:** install validates SHA-256 and size, and refuses on mismatch with the reason. It only registers. It never overwrites another game's data, never writes outside the player's library store and never touches saves. Uninstall removes the registration and the package copy, and **asks before** removing saves. It never deletes outside the store. Both are idempotent.
* **No elevated privileges, no scripts run by us, and no download of anything** on the recipient's machine.
* **Failure and cancel:** a failed or cancelled build leaves the previous setup artefact intact (write a staging file, then replace). Every failure names its cause.
* **Unsupported-host semantics:** a browser can build and download the ZIP, the same way it downloads the `.tpk` and descriptor today. It **cannot install or sign**. It says so and offers no emulated installer. VS Code writes the ZIP into `.tkr-exports/` by default, under the same rules as packages. A host without an output capability reports setup unavailable.
* **Signing:** under 5A nothing is signed. The integrity check is the descriptor's SHA-256, published beside the ZIP. Signing and notarisation, and the credentials they need, belong to 5B and are named by that later ruling. A signing step is never faked.
* **Monaco and Electron are not reopened.** 5B, if chosen, uses the Electron shell ADR 0013 already selected.

**What approval unblocks:** 14.6 (build and inspect the setup) and, with Question 1's rule, 14.9–14.10, which close the epic.

## What approval unblocks (summary)

| Story | Needs |
|---|---|
| 14.2 Runnable visual event tracer | Q1 |
| 14.3 Structured authoring and canvas | Q1, Q2 |
| 14.4 Skin editor and preview | Q3 (and the provider it names) |
| 14.6 Build and inspect game setup | Q5 |
| 14.7 Visual fixtures and action lists | Q1, Q4 |

## What this ADR does not decide

* Any runtime skin consumer, unless the owner picks 3C and rules it separately.
* The 160-command list. Question 1 fixes only the rule for admitting a command.
* Native installers, signing identities, store submission and mobile standalone builds (5B).
* Anything about media import (see [ADR 0044](0044-media-import-contracts-and-tool-licensing.md)).

## Owner decisions

*Pending.* The owner records an answer for each question here, for example "Q1: 1A; Q2: 2A; Q3: 3A; Q4: 4A; Q5: 5C", with a date. On approval the status becomes Accepted, the spec rows named by each answer are written docs-first in their own commit, and 14.1 may close.
