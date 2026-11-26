---
id: 33
type: bug
title: "Fight-background browser proof accepts a no-op Stop"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "3507"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3507"
refined: false
hitl: false
risk: medium
severity: P2
---

# Fight-background browser proof accepts a no-op Stop

## Description

The fight-background browser proof must demonstrate that Stop interrupts active looping audio, not merely that a short one-shot clip eventually ends. A passing proof that also passes when Stop is removed gives false confidence in the editor's playback controls.

## Reproduction

1. Run `pnpm exec playwright test tools/browser/tests/editor-battle-data.spec.ts --grep "a fight background" --reporter=line` with the former test, which played a 0.33-second non-looping WAV, stopped after observing sound, then checked for silence 0.4 seconds later.
2. Temporarily remove the `audioOutput.stop()` call from the owned-playback branch of the audition control's Stop handler.
3. Actual: the test still passes because the WAV ends naturally before the silence check. Expected: the test fails when Stop no longer interrupts playback.
4. Verified failing perturbation with the replacement regression: leave the playback looping for at least 0.45 seconds after first sound, then Stop and require silence. With the Stop call removed, the test fails at the silence assertion after its 7-second poll timeout.

## Cause Hypothesis

The original proof checked an unlooped clip shorter than its silence-observation delay. Natural clip completion therefore produced the same silence result as a working Stop handler.

## Acceptance Criteria

1. **The proof demonstrates Stop interrupts active playback**
   **Given** the browser BKG editor is auditioning a looping sound
   **When** the sound has remained audible for longer than one full source clip and Stop is pressed
   **Then** sound becomes silent after Stop rather than continuing to loop
2. **The proof rejects a no-op Stop**
   **Given** the browser test suite
   **When** the owned-playback Stop call is temporarily removed
   **Then** the focused BKG browser test fails at its post-Stop silence assertion, and passes again when the call is restored
3. **Or: no change is needed, with proof**
   **Given** the original reproduction
   **When** the current browser proof is run with the no-op mutation
   **Then** the test fails for an assertion that requires interruption of active playback, with the result recorded in Verification

## Verification

- Original weak test behavior: the 0.33-second clip was non-looping; the silence check occurred 0.4 seconds after Stop. Removing the Stop call still allowed the clip to end naturally.
- Mutation evidence: with the owned-playback `audioOutput.stop()` call removed, the focused test failed at the silence assertion (`Expected: true; Received: false`) after the 7-second poll timeout.
- Fix evidence: the current proof checks looped playback remains audible at least 0.45 seconds after the initial signal, then asserts silence after Stop. The same focused test passed after restoring Stop.
- Focused command: `pnpm exec playwright test tools/browser/tests/editor-battle-data.spec.ts --grep "a fight background" --reporter=line`.
- The fix is in the current uncommitted worktree. No PR exists yet; the ticket is tracked at https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3507 and should be linked from the PR for #1736.

## References

- test — `tools/browser/tests/editor-battle-data.spec.ts` (fight-background audition proof)
- implementation — `packages/editor-ui/src/board-audition.ts` (owned playback Stop)

## Notes

- Evidence is from an intentional local mutation and restored passing test. The no-op Stop was not a persistent production behavior; the defect was the test's inability to detect it.
