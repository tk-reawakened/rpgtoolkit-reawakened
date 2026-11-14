# ADR 0031 — Our own art editor, permissive reuse and browser-led editor behavior

* **Status:** Accepted direction (owner agreement, 2026-11-13); component choices, detailed UX and additional feature scope remain open.
* **Date:** 2026-11-13
* **Related:** [13.2 / #1726](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1726), [product/UX research](../findings/pixel-art-platform/research.md), [editor features](../editor-features.md) T-36–T-39 and T-65
* **Does not amend:** [guardrails](../guardrails.md), [ADR 0022](0022-shared-editor-authoring-contracts.md), [ADR 0025](0025-editor-ui-framework-preact-tsx.md), native-format contracts or Epic 13 acceptance.

## In plain terms

We will build Reawakened's own integrated pixel-art editor. We own its user experience, artwork/document integration, edit commands and connection to game assets. **That does not mean writing every algorithm or canvas component ourselves.** Suitable libraries, copied or adapted permissively licensed code, and selective forks are legitimate ways to build it.

**The editor is not the deterministic game runtime.** Across the editor, prefer browser-native behavior and suitable libraries over recreating a tightly controlled platform. DOM/CSS layout, native controls, focus and accessibility behavior, pointer/pen/touch events, canvas drawing and UI scheduling are tools to use, not engine restrictions to work around. Consistent authoring outcomes do not require identical platform behavior in every host.

The reason is product fit: changing artwork in game context, preserving reusable assets and explaining shared edits are our jobs. A complete external application's document store, keyboard handling or undo system must not dictate how those jobs work.

## Owner decision

The owner agreed to the recommendation “our own pixel-art editor, with selective reuse underneath,” then clarified:

> agreed. This is also not the engine so code reuse and libraries obviously are fair game here

The owner then made the editor-wide principle explicit:

> We should yell it far and wide that the editor is not a space where we have to 100% control it's platform behaviors. We can loosen up and let the experience be more driven by the browser capabilities

This settles the product-building direction, **not a library choice or a requirement to rewrite all low-level drawing tools**. It does not approve every proposed feature in the research report or make this a separate standalone art product.

## Decision

1. **Own the editor experience and integration.** Build the shared art workspace as part of Reawakened's editor, with the existing authoritative document, host lifecycle and game-asset boundaries. Browser/PWA and VS Code use shared authoring behavior; the desktop host follows the same boundary, not a separately implemented art application.
2. **Reuse is permitted and encouraged when it fits.** Evaluate libraries, raster algorithms, codecs, canvas interaction components and selected application modules. A maintained dependency, selective extraction, adaptation or fork is acceptable when its licence/provenance, integration and maintenance costs are understood. Neither a whole-editor wrapper nor a blank-slate rewrite is required.
3. **Integrate document semantics, not every platform detail.** A library may implement drawing interactions and history mechanisms, provided they participate in the existing authoritative document/undo contract and respect host focus and shortcut routing. Test those seams; do not create two competing editable sources or independent undo authorities. We do not need to own or replace every browser event, control or library behavior.
4. **Keep external tools viable.** Building our editor does not prohibit creators from using Aseprite or another external application. Handoff/import behavior is subject to real host capabilities and representation limits; no lossless interchange or launch support is approved here.
5. **Retain complete existing scope.** All allocated Epic 13 tools and acceptance remain. Rich layered-source persistence, region animation, additional interchange formats and other proposed expansions still require their own scope and representation decisions. This ADR chooses neither a new art format nor a new runtime feature.
6. **Let browser capabilities drive the editor experience.** This is editor-wide guidance, not just permission for one pixel library. Prefer native DOM/CSS, browser controls, selection/focus/accessibility facilities, Pointer Events, canvas and browser scheduling where suitable. Use host adapters for file, clipboard and other platform-service capabilities. Share task meaning and document outcomes across hosts; host-appropriate interactions and capability differences are acceptable and should be explained rather than emulated away by default.

## Day-one rules and reasons

* **Licence and provenance:** any shipped or copied component must pass G6, including its actual files, transitive dependencies and bundled assets; retain the required notices and record modified/forked source revisions. MIT or Apache at a repository root does not clear everything inside it. Restricted, copyleft or unknown code is not admitted by this decision.
* **Clean-room boundary:** no legacy RPG Toolkit source may be copied or translated. Permissively licensed third-party editor code is a different reuse question; its incorporation and resulting behavior must be documented before implementation. This ADR is not an exception to G7.
* **Editor versus engine:** core-only VM, DOM/timer and simulation restrictions do not become blanket bans on editor libraries merely because we build our own editor. G2's shared-editor/host boundary still applies, and an editor library must not enter the runtime core without that package's separate admission requirements.
* **No replacement browser platform:** engine determinism is not a reason to rebuild editor layout, input dispatch, control behavior, accessibility, scheduling or ordinary artwork-canvas rendering. Use the browser and suitable libraries; add bespoke behavior only for a concrete creator need or an existing contract. A browser-rendered art-editing surface is not the game renderer. A preview claiming to show actual game output still uses the established engine composition rules.
* **Framework and input:** the accepted Preact/framework-neutral boundary stands. `preact/compat` is not silently admitted for Dotting or any other React-only dependency; any exception follows ADR 0025. Drawing views obey host/document input ownership rather than hijacking unrelated editor shortcuts.
* **Documents and recovery:** accepted edits use the existing document authority and lifecycle. Views may keep disposable rendering caches and gesture previews, not a second editable source of truth. Multi-file work uses the existing per-file reporting/checkpoint recovery, not an invented atomic transaction.
* **Evidence before a component choice:** 13.2 still needs pinned component/licence evidence, coverage against T-36, accessible input, offline/CSP behavior and real host integration. Approval of our own editor is not approval to install any candidate or a claim those checks passed.

## Consequences

* **Benefit:** UI and game integration can serve our creator journeys rather than an embedded application's workflow. **Cost:** we own the product's coherence and must prove the full toolset; accepting this direction does not reduce T-36 to pencil/fill.
* **Benefit:** selective reuse avoids reinventing sound primitives. **Risk:** extraction/forks create maintenance and notice obligations. **Mitigation:** pin source, explain what was retained/changed and compare ongoing adaptation cost with a simpler implementation.
* **Risk:** a reused canvas may secretly own history or mutate state outside document commands. **Mitigation:** prove programmatic edits, undo/redo, multiple views, cancellation and view recreation before adoption.
* **Risk:** a rich workspace may hide a beginner's first action. **Mitigation:** test the proposed contextual/sheet workflows and progressive disclosure with creators; this direction is not evidence of usability.
* **Benefit:** browser facilities and mature libraries reduce platform code we maintain. **Risk:** hosts and browsers expose different capabilities and behaviors. **Mitigation:** test supported creator tasks on actual target surfaces, preserve data/lifecycle semantics and report capability limits; do not impose bit-identical UI behavior as a substitute.

## Alternatives and revisit triggers

* **Embed a whole art application as the default:** not selected. Revisit only if a concrete application can obey the shared content, lifecycle, input and host requirements at lower demonstrated cost. Selectively reusing its modules remains allowed now.
* **Write every drawing primitive from scratch:** not required. Implement a primitive ourselves when appropriate reuse fails its licence, behavioral, integration or maintenance tests—not as an ideological default.
* **External editor only:** not selected as the primary direction, but external tools remain complementary. Keep their limitations visible rather than promising identical browser and desktop capabilities.

## Still open

* Which primitives or canvas components to reuse, adapt or fork; Dotting and JollyPixel remain candidates, not selected dependencies.
* The detailed workspace layout and validation with creators.
* Storage needed for any richer editable source, layers, timelines or recipes beyond approved contracts.
* Which expanded capabilities are scheduled, and which cross-epic providers own them.

## Key source files

* [Research and candidate evidence](../findings/pixel-art-platform/research.md).
* [Art-library evidence plan](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/story-art-library-reuse-evidence-decision-plan.md).
* [Shared authoring contracts](0022-shared-editor-authoring-contracts.md), [framework decision](0025-editor-ui-framework-preact-tsx.md), [guardrails](../guardrails.md).
* [Editor capabilities](../editor-features.md), [tile formats](../spec/formats/tiles.md).
