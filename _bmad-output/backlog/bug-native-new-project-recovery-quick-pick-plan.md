---
title: "Native new-project recovery proof loses its restore-group Quick Pick"
ticket: 35
status: ready-for-dev
---

# Plan

1. Attempt to reproduce the recorded Quick Pick timeout in the packaged VS Code web proof and capture the picker state and browser trace.
2. If the timeout reproduces, establish why the displayed `before-restore` entry becomes unstable or invisible. Do not treat a longer timeout or a skipped assertion as a fix; whether or not it reproduces, continue through the diagnostic verification below.
3. If the timeout is attributed to an in-scope host or proof defect, make the smallest evidence-based fix while preserving the recovery refusal, restore, and write-persistence checks. If evidence shows it is unrelated, make no product fix and continue to diagnostic verification.
4. Verify failures at group selection, action-picker opening, and action selection report the exact recovery group and attempted action. If diagnostics are missing, make a proof-only diagnostic change even when the timeout does not reproduce; runs before the final proof change do not count toward closure.

5. Run the complete focused native new-project proof repeatedly in the CI container and browser environment on the final proof revision. Every run must complete the recovery refusal and restore checks. On that same revision, require the VS Code web editor acceptance proof to pass.

Do not hide a failure with retries, longer timeouts, or weaker assertions. Close with a verified fix only after documenting a reproduced cause and verified fix, repeatedly passing complete focused proof on the final revision, diagnostic coverage at all picker stages, and a passing VS Code web editor acceptance proof on that revision. Closure without a verified fix may include proof-only diagnostic changes; it requires repeated complete-proof passes, diagnostic coverage at all picker stages, and that same passing acceptance proof, plus evidence showing the failure was transient or unrelated. Record the applicable evidence in Notes before closing.
