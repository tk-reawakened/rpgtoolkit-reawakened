---
type: epic
title: "RPGCode language server and debug adapter"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-14"]
assignee: ""
risk: medium
---

# RPGCode language server and debug adapter

## Description

An LSP gives diagnostics from the core parser, hover and call tips from the built-in catalogue, go-to-definition across includes, outline, formatting and quick fixes for legacy syntax; a DAP launches programs against a test fixture with breakpoints, stepping, watches, threads and call stack.

## Outcome

Script authors get modern tooling in any LSP or DAP client; the CAP-14 success check is the signal.

## Done when

1. The LSP reports diagnostics, hover, go-to-definition across includes and outline on the sample games' programs.
2. Each legacy-syntax form of `docs/spec/engine/rpgcode-dialects.md` gets a quick fix that preserves behaviour.
3. The whole built-in catalogue of `docs/spec/engine/rpgcode-functions.md` resolves across the registered domains, asserted by a test.
4. A DAP session built on `runner-harness` sets a breakpoint, steps and shows threads, call stack and variables against a test fixture, and runs in the `vscode.dev` web build too.
5. The LSP ships as a VS Code and Open VSX extension build on its own, before the editor.

## Boundaries

`lsp` and `dap` packages (transport-free; `dap` over `runner-harness`) plus a minimal extension wrapper to ship the LSP early. Not the custom editors or webviews (epic editor-foundation).

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, T-40 to T-46
- reference - docs/architecture-options.md, section 4.1
- reference - docs/spec/engine/rpgcode-language.md#e-98

## Notes

- Assumption: the early LSP release uses its own minimal extension host, folded into `host-vscode` later. Confirm.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on rpgcode-vm because: the parser and the VM.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Handoff (epic board-rendering inception, 2026-10-16): epic 4 entry 4.30 builds `setBreakpoints`, the `paused { thread, frame, line }` stop, the open-tick cursor and the resume modes `continue` and a one-instruction `step`. Step over, step in and step out are this epic's, built from `step` and the frame depth; watches and the call stack read state through the engine's read-only views. The initiative file now lists epic 4 in this epic's `after`.

- Handoff (owner request, 2026-10-24): Epic 22 (#624, `epic-rpgcode-grammar`) owns the independent spec-authored tree-sitter grammar and syntax artifact. This epic retains semantic LSP/DAP ownership; no dependency on Epic 22 is added. Task 22.9 integrates only syntax highlighting/outlines in the shared program editor.
