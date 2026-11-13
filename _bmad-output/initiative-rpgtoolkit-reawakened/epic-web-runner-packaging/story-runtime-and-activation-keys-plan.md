---
type: feature
title: "The run-time key, its program and the general activation key work as the project sets them"
ticket: 35
status: draft
---

# The run-time key, its program and the general activation key work as the project sets them

## Scope

Register the main file's `runTimeKey` with `runTimePrg` as the player's run-time action, and `activationKey` as the interact action that board items and programs respond to, in place of the hard-coded Space. The run-time program follows the documented blocking rules: it does not fire while a blocking script owns the key queue.

Reuse the precedence 9.33 defines for a key that collides with a movement or menu binding, and report the collision as a diagnostic rather than silently rebinding.

Read the rules from `docs/spec/engine/display-input-audio.md` ("Input") and the action-key rows of `docs/spec/formats/main-file.md`. Today `packages/runner-web/src/input-bindings.ts` fixes Space, and the engine never starts a run-time program. The extended run-time keys (Key 0 to Key 50) are out of scope unless the owner asks for them here.

## Acceptance and verification

On a fixture whose main file binds the run-time key to R and its program to one that increments a variable: pressing R changes it once per press and does nothing while a blocking script owns the queue. Rebinding the activation key to E makes board item activation take E and not Space. A key already bound to movement or the menu wins, and the player reports the collision. The shipped demo, whose activation key is Space, plays unchanged.

Assert one press, one run, and the blocked case directly. Follow G1 (the run-time program is an ordinary script start, not a host callback) and G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 9.16. Land the binding precedence with 9.33 in one place; if the two stories run in parallel, one owns the table and the other consumes it.
