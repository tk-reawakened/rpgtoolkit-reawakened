# ADR 0028 — Proposed docking-library direction

- **Status:** Proposed (2026-11-12); owner ruling required. This is not an accepted dependency or an amendment relaxing ADR 0022 D7.3.
- **Spike:** [#2182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2182); **story:** 11.4 [#1702](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1702).
- **Evidence:** [reproducible findings and raw measurements](../findings/dock-library/README.md); constraints [G2 and G6](../guardrails.md), [ADR 0022 D7](0022-shared-editor-authoring-contracts.md), [ADR 0025](0025-editor-ui-framework-preact-tsx.md).

## Context

The browser/desktop workbench needs panels without giving the dock ownership of documents or undo. VS Code uses native groups, not this library. D7.3 requires a packaged browser/PWA and Electron proof including shared dirty document lifecycle, restart and missing-panel layout restoration, keyboard navigation/resize/move/close, focus, CSP, offline, G6 and Monaco shortcuts. Our scratch proof does not meet the whole gate.

## Options

| Option | Measured evidence | Cost or limitation |
|---|---|---|
| **dockview 8.9.0 MIT core + our keyboard layer** | Preact handles; tabs, split, in-page float, layout serialisation; 0 violations in web and simulated webview; JS 388,172 B min / 95,939 gzip, CSS 142,792 / 10,863. Eleven keyboard steps passed in Chromium and scratch Electron. | Core sashes lack separator semantics and keyboard access. Prototype layer is 100 nonblank, non-comment lines; not a full accessibility audit. Enterprise navigation/docking is proprietary and prohibited by G6. |
| dock-spawn-ts 4.5.4 | MIT, Preact, 0 CSP violations; JS 148,362 / 36,123, CSS 56,598 / 11,692; tabs, split, float and persistence exercised. | No roles or keyboard focus on measured tab/title elements or splitters. |
| Lumino widgets 2.10.0 | BSD-3-Clause declared, Preact, 0 violations; JS 209,863 / 56,323, CSS 5,786 / 1,363; tab arrows and application-mapped persistence. | Delete did not close a tab, sashes inaccessible; in-page floating not demonstrated; larger transitive tree. |
| Golden Layout 2.6.0 | MIT, Preact; JS 145,775 / 37,262, CSS 8,738 / 2,323; split/persistence. | No tab/sash roles or keyboard focus; four webview `img-src` violations; missing component throws; npm release 2023. |
| Build our own / React-only alternatives | Not prototyped here. | Own manager has unmeasured cost; React-only choices require a separate `preact/compat` decision under ADR 0025. |

Sizes include the shared Preact prototype; see findings for precise scope, upstream maintenance and other screened candidates.

## Recommendation for owner ruling

**Conditionally select pinned MIT dockview 8.9.0**, with an application-owned accessible keyboard and focus layer, **only after** the existing D7.3 packaged-host gate passes. Do not bundle or depend on `dockview-enterprise`; use vanilla ESM and external CSS. The prototype is evidence that the API can support part of the layer, not production-ready code, a G6 clearance of future installs, or a gate waiver. Keep models and undo in `editor-model`; persist stable view/layout identifiers rather than document state. Ship no new dependency merely by merging this proposal.

Before adoption, 11.4 must prove the full D7.3 contract in actual browser/PWA and packaged Electron editor builds, including real shared dirty document and undo over move/split/close/recreate, restart and absent component recovery, offline assets, packaged CSP, all required keyboard and focus paths including accessible splitter semantics, and actual Monaco shortcut ownership. Complete a production dependency/asset licence inventory and notices. If the packaged editor does not yet exist, that part remains open; a scratch Electron window is not a substitute. Screen-reader, zoom and non-Chromium validation remain unproved.

## Consequences

A vanilla package fits Preact and avoids `preact/compat`; the application owns significant accessibility and integration work, tests and upgrade regressions. Core is substantially larger in this prototype than the other candidates. Dockview's commit activity is concentrated in one maintainer. The recommendation unblocks implementation planning for 11.4 after owner ruling; it does not close D7.3 or establish a shipped workbench.
