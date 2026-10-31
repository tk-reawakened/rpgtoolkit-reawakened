---
type: epic
title: "Standalone editor in a desktop shell"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-18"]
assignee: ""
risk: medium
---

# Standalone editor in a desktop shell

## Description

A spike compares Tauri, Electron and Electrobun on all three desktop OSes with the board editor and game runner; the winner hosts `host-desktop`, which implements platform-services and shares the standalone editor.

## Outcome

Desktop users get the standalone editor with native file access; the CAP-18 success check for the desktop host is the signal.

## Done when

1. A written decision records the shell choice with results from Windows, macOS and Linux (including WebKitGTK).
2. `host-desktop` opens, edits and saves a project through platform-services.
3. The same `editor-ui` build runs in `host-desktop` with no host-specific editor features.

## Boundaries

The spike and `host-desktop` chrome. Not the runner wrapper, which epic web-runner-packaging owns.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/adr/0001-typescript-core.md, decision 6
- reference - docs/architecture-options.md, section 4

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Decision: ADR 0001 defers the shell choice to a spike; the choice is reversible through platform-services.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on editor-assets-p0 because: a board editor to spike against.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
