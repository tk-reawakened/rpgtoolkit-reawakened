---
type: chore
title: "Measure Monaco CSP, worker and licence requirements"
ticket: 20
status: done
baseline_revision: e8410caffae5e9769fad31299a29a5aca170e5cd
---

## Reconciled research delivery, 2026-11-15

Issue #2183 is closed and its research deliverables merged in PR #2186 (`e8410caffae5e9769fad31299a29a5aca170e5cd`). This plan repairs missing ticket-state metadata, not the historical experiment or an owner ruling.

The entry's acceptance asks for a reproducible host spike, raw findings and a proposed ADR documenting exact policies, worker behavior, licences, bundle sizes and a CodeMirror comparison. Those outputs are `docs/findings/monaco-csp/README.md`, its `raw/` measurements, `tools/spikes/e11-editor/` and `docs/adr/0029-monaco-csp-style-src.md`.

ADR 0029 subsequently records its own accepted owner CSP ruling. Production language/document integration and its licence/offline proofs belong to 11.7 (#1705, merged PR #2708), not to this research acceptance. The spike's hypothetical embedded-Monaco webview and scratch Electron measurements do not authorize embedding it in VS Code or establish a packaged editor. No new experiment was run during this metadata reconciliation.
