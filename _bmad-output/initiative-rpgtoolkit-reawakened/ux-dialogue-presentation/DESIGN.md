---
name: Reawakened Dialogue
description: Reusable speaker-aware presentation for RPGCode dialogue, configured by each game.
---

## Brand & Style

The game owns the dialogue window's visual identity. Speaker identity adds structure without imposing a palette or overriding the game's existing message-window settings. The foundation stays renderer-independent and preserves the text-only appearance when a script supplies no speaker metadata.

## Layout & Spacing

The message window retains its existing 600 × 100 logical-pixel geometry at the top of the game surface. When a speaker is supplied, a compact portrait occupies the left side and the speaker name labels the text area above the dialogue. The portrait is fitted within the available height without changing the window bounds. Text wraps within the remaining area; without a portrait, the text area uses the full width. Without speaker metadata, legacy text layout remains unchanged.

[ASSUMPTION] The portrait slot is square and at most 100 × 100 logical pixels, preserving the source image's aspect ratio. The layout may letterbox smaller or non-square source images; it never crops or stretches them.

[Key screen: speaker-backed message](mockups/key-dialogue-window.html) illustrates the layout in the fixed message window.

## Components

- **Dialogue window** — Uses the game's existing background image or color, translucency, font, and text color. No new theme is imposed.
- **Speaker portrait** — Uses the portrait asset already associated with the speaker actor when one is available. It is a supporting visual, never the only carrier of speaker identity.
- **Speaker name** — Appears above the message text, using the active dialogue font and color. The name comes from the selected actor record, not from parsing the message string.
- **Message text** — Remains the supplied text after the existing variable-splicing behavior; the text area follows the current font and wraps within its layout region.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Preserve each game's existing message-window appearance settings | Impose a new palette, font, or background image |
| Show names as structured speaker identity | Parse `Name: text` from message content |
| Treat portrait art as optional and preserve its aspect ratio | Stretch, crop, or require every actor to have a portrait |
| Keep text-only `mwin(text)` visually unchanged | Reserve portrait space when a line has no speaker metadata |
| Keep the speaker name visible independently of the portrait | Rely on the image alone to identify who is speaking |
