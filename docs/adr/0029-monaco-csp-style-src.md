# ADR 0029 — Proposed Monaco CSP posture

- **Status:** Proposed (2026-11-12); owner ruling required. No CSP or dependency is changed by this record.
- **Spike:** [#2183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2183); **story:** 11.7 [#1705](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1705).
- **Evidence:** [methods, exact policies, raw results and licence limits](../findings/monaco-csp/README.md); [ADR 0021](0021-monaco-code-editor.md), [ADR 0025](0025-editor-ui-framework-preact-tsx.md), [G6](../guardrails.md#g6--licence-gate).

## Context

ADR 0021 selects Monaco for standalone/browser and native text editing in VS Code. ADR 0025 leaves Monaco styles and workers open. Under the actual web editor's strict CSP, Monaco 0.57.0 allowed typing but blocked dynamic theme styles, inline style attributes and the icon font; highlight and token colour were wrong. The real VS Code webview's strict policy also blocked styles and font, and a cross-origin worker fell back to the main thread. VS Code does **not** embed Monaco under the accepted architecture.

## Options

| Option | Evidence | Consequence |
|---|---|---|
| **Permit inline styles in Monaco-containing standalone editor pages** | `font-src 'self'; style-src 'self' 'unsafe-inline'` on the web policy yielded zero observed violations; sample typing, undo, colour, find icons and classic same-origin worker worked in Chromium and scratch Electron. | Weakens style injection protection for the whole page, not just Monaco. Keep script policy strict; do not add `unsafe-eval` or script `unsafe-inline`. |
| Split directives | `style-src-attr 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'; font-src 'self'` also yielded zero. | Documents attribute/element allowances but still permits both kinds of inline styles in supporting browsers. A fallback `style-src` must be considered for older engines. |
| Nonced dynamic style elements | A build-time source patch that adds the page's nonce to Monaco-created style elements, plus `style-src-attr 'unsafe-inline'` and `font-src 'self'`, worked in Chromium. | Patch is not an upstream API and needs upkeep; static hosting needs a fresh unpredictable nonce per response. Attribute styles remain allowed. Hashing dynamic styles/attributes was not shown viable. |
| Keep strict policy unchanged | Monaco typed and undid, but generated >120 attribute and six element violations, blocked the icon font and had incorrect highlighting/colours. | Unacceptable as a complete editor. |
| CodeMirror 6 | Strict light-DOM styling was blocked; shadow-root adopted stylesheet worked in this Chromium sample without violations. | Smaller prototype, but different feature set; adopting it would reopen the owner's accepted ADR 0021, which this proposal does not do. |

## Recommendation for owner ruling

For standalone editor documents that actually host Monaco, permit `style-src 'self' 'unsafe-inline'` and `font-src 'self'`, preserving the existing strict script policy. This is a deliberate page-wide risk, not a claim that Monaco needs relaxed scripts. Prefer a same-origin packaged classic worker via `MonacoEnvironment.getWorker`; test it rather than silently accepting Monaco's main-thread fallback. If the blob loader is used instead, explicitly allow the needed `worker-src` sources and prove the worker actually responds. Keep the VS Code visual-editor webview's existing strict style policy because ADR 0021 uses native text editors there.

The option trades narrower element-style protection for an upstream-compatible setup without a private Monaco patch. Revisit if Monaco supplies a supported CSP nonce mechanism or the host can serve per-response nonces and an integration can avoid inline attributes. The isolated webview experiment is not permission to change its policy: embedding Monaco there would need separate approval, a nonce strategy, attribute allowance, font/connect sources and blob worker handling.

## Conditions and consequences

This proposal unblocks 11.7 policy planning after owner approval, not implementation acceptance. Pin and audit the exact Monaco package, vendored code, transitive dependencies and **codicon font** under G6, resolve its upstream asset terms and provide required notices before shipping. The package-level MIT label alone does not clear its bundled notices; no G6 exception is granted. Measure actual emitted bundles and workers, prove offline loading, no eval, real language/document ownership, keyboard accessibility, and browser/packaged-host behaviour. `frame-ancestors` in the current meta policy is ignored and tracked in [#2184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2184). The measurements are limited to the named Chromium/Electron/VS Code versions and a toy grammar; no WCAG, other-browser or full feature claim follows.
