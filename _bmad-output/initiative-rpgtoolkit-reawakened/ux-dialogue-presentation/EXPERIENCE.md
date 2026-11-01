---
name: Reawakened Dialogue
status: draft
sources:
  - docs/spec/engine/rpgcode-functions.md#e-55
  - docs/spec/engine/actors.md#source-fields
  - docs/spec/engine/plugins-and-battle.md#e-95
  - docs/spec/formats/save-game.md#reawakened-canonical-actor-state
updated: 2026-10-23
---

# Reawakened Dialogue — Experience Spine

## Foundation

The dialogue surface is the existing fixed message window inside the game view, independent of renderer and host. Plain `mwin(text)` remains a non-waiting text-only call. Game startup code may establish reusable presentation defaults; an individual line may supply structured speaker identity. Scripts explicitly bracket a multi-line interaction so completion has a clear owner. `DESIGN.md` defines the presentation layout; the game remains responsible for its own colors, fonts, and window background.

This is a small runtime foundation for ordinary RPGCode and later dialogue tools. It is not a dialogue editor, branching graph, or new dialogue asset format.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Dialogue window | A script displays a message line | Shows game-authored text and, when supplied, speaker name and portrait |
| Startup configuration | Game/package startup | Establishes defaults shared by later dialogue lines |
| Interaction completion | Explicit end of a bracketed interaction | Queues one game-level `dialogue.completed` event for actor-scoped `talked` delivery |

There is no dialogue settings screen or editor in this foundation.

## Voice and Tone

The engine adds no authored dialogue copy. It preserves the exact game-supplied line after the existing variable-splicing behavior. Speaker names are labels from actor data, not prefixes rewritten into the message text.

## Component Patterns

| Component | Use | Behavioral rules |
|---|---|---|
| Dialogue window | Every `mwin` line | Text-only calls keep their existing appearance and behavior; speaker metadata adds a name and optional portrait without changing the game's window theme. [Mock](mockups/key-dialogue-window.html) |
| Speaker identity | A line with a speaker actor id | Resolve the display name from actor data; use its portrait asset when available; never infer a speaker from the text. |
| Interaction scope | A scripted conversation spanning one or more lines | Begin explicitly, preserve source/target actor identity, collect displayed lines in order, and finish explicitly. An unfinished or failed scope emits no completion. |
| Completion event | A normally finished interaction | Queue exactly one `dialogue.completed` with `{ actorId, targetId, text }`; text contains displayed lines joined by newlines. The `stock_rpg` bridge emits actor-scoped `talked` from that signal. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Legacy text-only line | Dialogue window | Preserve current `mwin(text)` rendering and non-waiting behavior. |
| Speaker-backed line | Dialogue window | Show the speaker name above the line and the actor portrait at the left when available. If no portrait exists, omit the portrait and use the full text width. |
| Interaction in progress | Script and dialogue window | Keep the current actor, optional target, accumulated displayed lines, and open/closed state as plain saveable data. Do not emit yet. |
| Normal completion | Script and event queue | Explicit end queues one event. Clear or close the interaction so a repeated end cannot emit twice. |
| Interrupted or failed | Script and event queue | Preserve existing script failure/interruption behavior; do not emit `dialogue.completed` or `talked`. |
| Snapshot/restore while waiting | Script and dialogue window | Restore the same visible line and open interaction; resume at the recorded wait without duplicate completion. |

## Interaction Primitives

- A game initializes reusable presentation defaults at startup; per-line speaker metadata overrides only the speaker identity for that line.
- The script explicitly opens and closes an interaction around ordinary RPGCode control flow, including branches and waits. A `wait` alone does not complete a conversation.
- Each displayed `mwin` line inside the open scope is captured in display order after the existing text substitution. The completion event uses the captured text, separated by newline characters.
- Normal completion is the explicit close. Reaching an error, interruption, or script termination first leaves the scope incomplete and emits no event.
- A plain `mwin(text)` call outside an interaction remains valid and produces no completion event.

## Accessibility Floor

- Speaker identity is text: the name is rendered as a label and is never communicated only through portrait imagery.
- Message text remains readable when a portrait is absent, unavailable, or cannot be rendered.
- When a host exposes accessible dialogue output, announce the speaker name before the message text and do not require the player to identify an image.
- No animation or text-reveal timing is introduced; the existing all-at-once text behavior remains.

## Key Flows

### Flow 1 — A short NPC conversation (Steven, visiting the inn)

1. Game startup establishes its chosen dialogue-window appearance.
2. Steven begins an interaction with the innkeeper as the target.
3. The game displays “I like pugs” with Steven's actor identity; the portrait and name appear without changing the sentence.
4. The script waits for the player's ordinary input, then displays “Yes, pugs are adorable” with the innkeeper's speaker identity.
5. Steven's interaction ends normally.
6. **Climax:** One queued `dialogue.completed` records the interaction actor, target, and both displayed lines; the `stock_rpg` bridge delivers one actor-scoped `talked` event.

### Flow 2 — Continue a conversation after restore (Steven, mid-reply)

1. Steven's interaction is open, and the script is waiting after a displayed line.
2. A snapshot captures the message window and open interaction data.
3. The game restores package startup and saved state, then resumes the same wait.
4. The innkeeper's next line appears once, and the script reaches the explicit end.
5. **Climax:** One completion and one `talked` event are delivered; restoring did not replay or duplicate prior lines or events.

## Open Assumption

The portrait uses a square slot no larger than the existing 100-pixel window height and preserves source aspect ratio. `DESIGN.md` records this as an assumption; it can be adjusted if the project needs a different portrait frame.
