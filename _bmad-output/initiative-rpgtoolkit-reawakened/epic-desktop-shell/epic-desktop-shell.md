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

The desktop shell is **ruled** (epic web-runner-packaging, entry 9.1, D-1; text in that epic's ruling draft, and the
shell's ADR is 0013), so this epic does not re-run a three-way shell spike. It **cites that ruling** and measures only
what the ruling does not: how the standalone editor behaves in the ruled Electron shell through platform-services — file
I/O and watching, dialogs, file association and drag-and-drop of a project onto the window — on macOS, Windows and
Linux. The ruled shell is one application that is both the editor and the player, so `host-desktop` is that app's
editor half and this epic adds no second shell.

## Outcome

Desktop users get the standalone editor with native file access; the CAP-18 success check for the desktop host is the signal.

## Done when

1. A written decision **cites ADR 0013** for the shell choice and records the editor-specific measurements — platform-services file I/O and watch, dialogs, file association, drag-and-drop — from Windows, macOS and Linux.
2. `host-desktop` opens, edits and saves a project through platform-services.
3. The same `editor-ui` build runs in `host-desktop` with no host-specific editor features.

## Boundaries

The editor's half of the desktop shell, `platform-services` for that host, and its chrome. Not the shell choice itself,
which epic web-runner-packaging rules in 9.1 and 9.10, and not the runner's side of the same app. Every feature lands in
`editor-ui` first.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/adr/0001-typescript-core.md, decision 6
- reference - docs/architecture-options.md, section 4
- ruling - _bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/story-rulings-the-runner-boundary-the-desktop-shell-image-storage-plan.md, D-1
- ruling - docs/adr/0013-desktop-shell-electron.md (lands with epic web-runner-packaging entry 9.1)

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Decision: ADR 0001 defers the shell choice to a spike; the choice is reversible through platform-services.
- Decision: epic set approved by the user, 2026-10-10.
- Decision (2026-10-31): the shell is ruled elsewhere. Epic web-runner-packaging's 9.1 records the owner's ruling that
  the harness is separate from the game bundle, that there are at most two shells, and that the one desktop shell is
  Electron; this epic cites that ruling and **cannot overrule it by accident**. A divergence found here is raised as a new
  ADR that supersedes 0013, not implemented as a second shell.
- Waits on editor-assets-p0 because: a board editor to spike against.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
