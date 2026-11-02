# Accessibility

<a id="a11y-1"></a>
**A11Y-1 Scope and level.** In plain terms: everything the engine draws and controls itself can be used by somebody who cannot see it well, cannot use a mouse, or cannot use a keyboard — and the engine tells a screen reader what is on screen so a game is not a silent picture.

Technically, the commitment is **WCAG 2.2 level AA** for **engine-owned chrome and controls** only:

| In scope (the engine is accountable) | Out of scope (the game author is accountable) |
|---|---|
| The message window, `MsgBox`, the message box for errors | Board art, tilesets, sprite art, their contrast and motion |
| The stock menu, equip, item, abilities, shop, inn, save and load dialogs | A game's own script-drawn screens and their content |
| The options and controls screens, including focus and remapping | Scripted text: its wording, reading level, punctuation |
| The cursor-map hand, the focus ring, engine cursor images | Custom cursor graphics, custom menu graphics (`MenuGraphic`) |
| Engine effects: fades, wipes, shakes, flashes | A script's own effects on its own canvases |

The engine gives authors the means to comply (remapping, a reduce-motion preference, a pause, target size, the accessibility tree) and cannot certify a game that uses them badly. A game MAY declare its intentions in an `a11yProfile`; the registry records the claim and the engine reports, but never rewrites, what a game does.

<a id="a11y-2"></a>
**A11Y-2 Keyboard operability (SC 2.1.1).** Every function performed by the engine's own chrome is operable by keyboard alone: opening and closing the menu, moving the cursor, choosing, cancelling, paging a list, scrolling a dialog, save and load, and remapping. No function of the chrome requires a pointer. A script's own screen is out of scope but is reached, left and paused by keyboard alone.

The test is behavioural: a headless play-through completes a menu-only and dialog-only session using keyboard actions only, and produces the same selection state as the pointer run.

<a id="a11y-3"></a>
**Contrast of engine chrome (SC 1.4.3, 1.4.11).** Engine-drawn text meets **4.5:1** against its background, and engine-drawn interactive boundaries and indicators — the focus ring, the cursor-map hand's selected point, button borders, the menu frame, the selection bar — meet **3:1**. The stock theme is authored to meet both with its default palette, and a surface MAY sample a background so long as the result is checked at draw time against the actual pixels behind the text.

The engine computes the ratio with the deterministic maths of [ADR 0002](../../adr/0002-core-pixels-and-deterministic-maths.md) (no `Intl`, no locale) and reports any stock surface that fails as a located `a11y.contrast` diagnostic in the harness. An authored theme that fails is reported, never silently corrected.

<a id="a11y-4"></a>
**Character key shortcuts (SC 2.1.4).** A single-character shortcut — any binding whose control is one character-producing key, which is exactly what the legacy activation, menu and run-time keys are — MUST be remappable, or disableable, or limited to when a chrome control has focus. A **locked** action ([ACT-6](display-input-audio.md#act-6)) whose only bindings are single-character keys is an accessibility violation: the engine reports `a11y.character-shortcut` at load and lists the action as fixed in options. It does not unlock it behind the game's back, because a locked action is a compatibility promise.

<a id="a11y-5"></a>
**Focus visible and unobscured (SC 2.4.7, 2.4.11).** Every surface draws a focus indicator for the current cursor position: at least **2 logical pixels** on every side, at least **3:1** against both the surface and the item, and never removed while the surface can accept input. The indicator is part of the draw list, so a renderer cannot forget it. The focus indicator MUST NOT be covered by the message window or a fade: a surface whose cursor would fall behind the message window moves the window, shrinks the list or scrolls the cursor into view rather than obscuring it.

<a id="a11y-6"></a>
**Pointer cancellation (SC 2.5.2).** A pointer press MUST NOT perform its action. The action happens on **release over the same target**, and moving off the target before release cancels it. This applies to menu items, cursor-map entries, on-screen buttons, the shop and the options screen. Dragging is never the only way to perform an action ([2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)): every drag in engine chrome has a click-click alternative.

<a id="a11y-7"></a>
**Target size (SC 2.5.8).** An interactive target in engine chrome is at least **24 by 24 logical pixels** at 1× scale, or meets the spacing exception. Legacy surfaces are drawn on a 16-pixel grid, so the engine provides:

1. **nearest-target resolution** — a pointer position inside the spacing envelope selects the nearest target, deterministically by distance then by list order;
2. a **large-cursor option** that scales the stock theme to 1.5× and 2× with nearest-neighbour sampling, so text and targets scale without blurring;
3. a documented exception list for targets embedded in a legacy game's own art.

<a id="a11y-8"></a>
**Timing (SC 2.2.1).** The engine imposes no time limit on any decision: no menu, dialog, cursor map or battle screen expires, and no surface auto-advances. The 75 ms, 90 ms and 100 ms pauses in [display-input-audio.md](display-input-audio.md#input) and [plugins-and-battle.md](plugins-and-battle.md#e-80) are internal debounce between accepted inputs and are not time limits on the player. Where a script or package imposes its own timer through an engine surface, the engine exposes an extend/disable preference; the engine never extends a script's own logic silently.

<a id="a11y-9"></a>
**Motion, flashes and sound (SC 2.2.2, 2.3.1).** The `ui` section carries a **reduce-motion** preference, off by default, which the options screen toggles. When it is on, engine effects — wipes, fades, shakes, the screen-transition animation and the cursor-move animation — are shortened to a single frame, and motion that carries no information is removed. A scripted effect that the engine drives (`Wipe`, `Fade`, screen shakes) is shortened the same way; one that a script draws itself is that script's own art. Engine effects MUST NOT flash more than three times in any one second, at any intensity, in either preference state.

<a id="a11y-10"></a>
**No trap, no surprise (SC 2.1.2, 3.2.1, 3.2.2).** `cancel` always leaves the current surface, including a nested one, and no surface consumes it to stay open. Moving the cursor never activates anything, and choosing never changes context without the action the player took — a Quit confirmation is a separate screen, not a side effect of Enter on a list row.

<a id="a11y-11"></a>
**The accessibility tree (SC 4.1.2, 4.1.3).** `core` emits, alongside the draw list and never inside it, a plain-data accessibility tree for the surfaces currently drawn:

```
A11yNode = {
  id:      string,                    // stable for the surface's life, not per frame
  role:    "surface" | "menu" | "menuitem" | "dialog" | "message" | "button"
         | "list" | "listitem" | "text" | "label" | "status",
  label:   string,                    // MUST be non-empty; the visible text, not a key name
  value:   string | null,             // e.g. "3 of 12", the gold amount; null means none
  state:   { disabled: boolean, selected: boolean, checked: boolean | null },
  focused: boolean,                   // exactly one leaf per surface is focused
  bounds:  { x, y, w, h },            // logical pixels, integer
  children: readonly A11yNode[]
}
```

Rules: the tree is rebuilt each frame from the same state the draw list uses, so they cannot disagree; it contains no DOM, function or host object (G2) and no locale-formatted string (G3); a transient message that the player must hear is also queued as an announcement `{ politeness: "polite" | "assertive", text }`, assertive for errors and polite for dialogue; roles and labels are the game's own language strings, never a legacy key name such as `LEFT`.

Runners bridge it: the browser and mobile hosts maintain a hidden ARIA mirror, the desktop host forwards to the platform accessibility API, and the headless harness dumps it as text. A node with an empty label, two focused leaves in one surface, or a `listitem` outside a `list` FAILS the harness suite; a stock surface without any tree node fails as well. The tree is opt-in per host request so that no existing draw-list golden moves.

<a id="a11y-12"></a>
**What the engine gives authors (support, not certification).** The engine exposes: the action table and remapping ([ACT-6](display-input-audio.md#act-6)), the reduce-motion preference, the large-cursor option, the accessibility tree for script-drawn surfaces (a script may post nodes for its own screen), a pause the author can offer, and the contrast checker as a callable so a script's own colours can be measured. An author who needs narration beyond label and value supplies it through the message window, which is announced.

<a id="a11y-13"></a>
**A11Y-13 Many actions and dense surfaces (SC 1.4.1, 2.4.3, 2.4.6).** A spell-and-skill game can register hundreds of actions ([ACT-2](display-input-audio.md#act-2)) and draw them as a bar, a grid or a paged list ([ACT-8](display-input-audio.md#act-8)). Four rules keep that usable:

1. **Grouping is a heading, not a colour.** The options screen and any grouped surface present a `group` as a labelled heading in the accessibility tree, and the reading order equals the visual order.
2. **Paging never loses the player.** A paged options list keeps the cursor on a real row after a page turn, announces the new page (`value: "2 of 5"` on the list node), and `cancel` leaves in one step. The stock item list's `left`/`right` paging rule is the only paging gesture.
3. **State is never colour alone.** Enabled, disabled, on cooldown, selected and "unusable here" are each conveyed by a distinct icon, glyph or text as well as a tint, and the accessibility tree carries the same state (`state.disabled`, `value` for a cooldown). A player who cannot distinguish the tints loses no information.
4. **Cooldowns are announced at the edges, not continuously.** A cooldown produces one polite announcement when it starts and one when the action becomes ready; it never updates per frame, so a screen reader is not flooded while a timer runs.

A surface with more slots than fit on the frame scrolls or pages; it MUST NOT shrink its slots below the target-size rule ([A11Y-7](#a11y-7)) to fit them.
