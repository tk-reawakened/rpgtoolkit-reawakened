---
type: feature
title: "Complete pixel tile artwork editor"
ticket: 3
status: draft
risk: high
---

## Intent

Complete every T-36 operation in our browser-led editor, retaining legacy append/overwrite modes and using entry 22 for persistent editable layers and source-to-output ownership.

## Scope and acceptance

Include pencil, dropper, fill, erase, line, ellipse, rectangle, replace colour, DOS 16 palette, RGB/key, clear, 90/180/270 rotate, flip/mirror, cut corner, skew wrap/broken, wrap-scroll, iso conversion, layer opacity, shade, greyscale, blur, motion blur, blocker/angle/length shadow, texturise and translucentise; disclose known/uncertain shared uses and return to board selection; unsupported image formats are named, never silently substituted.

Browser/DOM controls, focus and accessibility, pointer/pen/touch events and canvas presentation may use platform capabilities under ADR 0031; no pixel-identical editor chrome is required across hosts. Saved artwork and command outcomes remain specified. Keep palette selection, indexed image encoding and explicit colour reduction distinct. Previewing an effect does not dirty source; applying it is undoable, and editable adjustments are preserved by the source contract. Entry 23 owns cross-cell sheet interaction; entry 24 owns shared/local contextual relinking.

## Verification

Independent expected pixels exercise every listed T-36 operation, keyboard/numeric access, transparency and iso preview, preview/cancel and undo. Reopen editable layers/adjustments and render saved legacy tiles through the runner.

## Dependencies and decisions

Prerequisites: 1, 2, 22. Apply the epic Notes, format specs, AD-18/19/20/22/29 and ADR 0031; T-36 maps to CAP-16. Preserve same-version legacy data and residue, use existing document/history services and the shared browser, and keep host I/O behind platform-services.
