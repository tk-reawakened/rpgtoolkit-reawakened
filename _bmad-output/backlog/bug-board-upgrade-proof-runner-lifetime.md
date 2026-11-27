---
id: 36
type: bug
title: "Release completed game runs during the board-upgrade browser proof"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3597"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3597"
refined: true
hitl: false
risk: low
severity: P2
---

# Release completed game runs during the board-upgrade browser proof

## Evidence

The editor-web board-upgrade proof in PR #3583 (run 45894269257, head ce88f1df912e33887a0acb2011835a323fda5a6b) exhausted its 60-second test deadline. The retained trace shows the first board running by about 8 seconds, with its pixel checks complete before authoring resumes at 8.74 seconds. That runner remains active throughout cancellation, write-refusal, script-save, coordinate conversion and reopen checks. The close-tab click starts at 40 seconds and takes 13.58 seconds; the pixel-copy run only begins near the test deadline. #3593 reports the same test exhausting its deadline at its final backing-store snapshot on PR #3535.

A prior unchanged local editor-web lane passed all 83 tests and this proof in 17.6 seconds; these timeouts have not been reproduced locally. Trace evidence supports removing unnecessary concurrent rendering, not claiming a product deadlock or widening timeouts.

## Acceptance Criteria

1. Once the first run has proved the upgraded board's coordinates and rendered pixels, stop it through the real toolbar and wait until its iframe has been removed before continuing independent authoring checks.
2. Both reopened board runs, authored pixel thresholds, cancellation, failed-write handling, pending-edit preservation and final persisted bytes remain asserted.
3. The second run also settles its removal before the final backing-store snapshot. No timeout increase, skip, fake state or weaker assertion is introduced.

## Verification

Run only `editor-web-host.spec.ts`'s pinned original minor-2 board proof in the CI Playwright image. A passing local check establishes the repaired proof still exercises its contract; GitHub must confirm the previously failing timing signature is resolved.
