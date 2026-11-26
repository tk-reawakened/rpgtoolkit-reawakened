---
title: "Native new-project recovery proof loses its restore-group Quick Pick"
ticket: 35
status: ready-for-dev
---

# Plan

1. Reproduce the recorded Quick Pick timeout in the packaged VS Code web proof and capture the picker state and browser trace.
2. Establish why the displayed `before-restore` entry becomes unstable or invisible. Do not treat a longer timeout or a skipped assertion as a fix.
3. Make the smallest evidence-based change while preserving the recovery refusal, restore, and write-persistence checks.
4. Run the focused native new-project proof repeatedly in the CI browser environment, then run the required editor-host acceptance proof.

The issue may also be resolved without a code change if repeated CI-shaped runs establish that the recorded failure was transient; record that evidence before closing it.
