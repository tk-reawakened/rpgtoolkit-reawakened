---
type: chore
title: "Evaluate docking libraries for the web editor"
ticket: 19
status: done
baseline_revision: e8410caffae5e9769fad31299a29a5aca170e5cd
---

## Reconciled research delivery, 2026-11-15

Issue #2182 is closed and its research deliverables merged in PR #2186 (`e8410caffae5e9769fad31299a29a5aca170e5cd`). This plan repairs missing ticket-state metadata; it does not adopt a dependency.

The entry's acceptance asks for a reproducible browser spike, raw findings and a **proposed** ADR covering licence, CSP, accessibility, features, size, maintenance and remaining gates. Those outputs are `docs/findings/dock-library/README.md`, its `raw/` measurements, `tools/spikes/e11-editor/` and `docs/adr/0028-docking-library-selection.md`. The findings document the four candidates, isolated exact dependency inventory, keyboard prototype and measured limitations.

ADR 0028 remains Proposed. The packaged-host adoption gate and owner ruling are not closed by this research status. Scratch Electron output is not packaged-editor proof; the research explicitly records that distinction. No new experiment was run during this metadata reconciliation.
