# ADR 0043 — Reviewed script writes use the single-user project policy

* **Status:** Accepted (2026-11-24; explicit owner decision).
* **Scope:** [TOOL-11 reviewed script changes](../spec/engine/rpgcode-tooling.md#tool-11-local-writes), [#1741](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1741), [#3439](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3439).

## Summary

1. Reviewed changes operate on the author's own project in both Monaco and VS Code, including VS Code web. No new provider or native helper is required.
2. Refuse detected symbolic links and changes; check paths and contents again before writing. Tell the author where the check stops protecting their files.

## Context

The owner extended the [distribution export policy](../spec/formats/packaging-and-paths.md#distribution-package-this-projects-own) to reviewed script writes: the local editor is a single-user workflow over user-controlled project files, not a security boundary against a malicious local process. [ADR 0035](0035-program-new-no-overwrite-limits.md) is separate precedent for disclosing a check/write race in both editors. This decision does not amend either contract or settle [proposed ADR 0030](0030-save-check-and-write-are-two-steps.md) on ordinary saves.

## Decision

1. Before dispatch, recheck the selected main, exact source and destination paths, reviewed bytes, and live editor state. Refuse any detected link, alias, incompatible entry, or changed input or destination. A failed check is not evidence that a path is safe or absent. Check again after checkpoint consent or creating folders.
2. Current adapters may use ordinary project-bound writes after those checks. VS Code can report links, but the browser's picked-folder API does not expose their metadata; it must not claim link detection. The checks and mutation are separate calls: another process can change contents, replace a path or substitute a link after its final check. No immunity to that race, atomic compare-and-write, or cross-file transaction is promised.
3. Keep the author review, opt-out, cancel, restore-only checkpoint, recovery receipts and live buffer save/undo rules. Neither browser-picked folders nor the VS Code web proof are excluded to avoid the residual race. A host that cannot perform ordinary writes or record recovery must still report that limitation.

## Consequences

- The editor refuses unsafe conditions it observes, and applies reviewed changes through its existing filesystem surface. Checkpoint confirmation discloses the race and each host's link-detection limit.
- The final check cannot prove what a concurrent external process does after it returns. This is why the workflow is limited to user-controlled projects; it is not a policy for services writing arbitrary uploaded files.

## Alternatives rejected

- Require a portable handle-bound or atomic write before enabling any reviewed disk change. The current browser-picked folder and VS Code web APIs cannot do that; rejecting those hosts would leave the accepted workflow incomplete.
- Treat a successful preflight as proof against later link substitution or content edits. A separate ordinary write cannot provide that proof.
