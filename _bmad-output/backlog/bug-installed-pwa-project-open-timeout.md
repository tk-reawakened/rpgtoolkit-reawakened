---
id: 41
type: bug
title: "Installed editor PWA proof times out opening Game Settings in CI"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3305"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3305"
refined: true
hitl: false
risk: low
severity: P2
---

# Installed editor PWA proof times out opening Game Settings in CI

## Description

The installed Chromium proof clicks Open project folder but times out waiting for Game title. This recurred on #3534 and #3609. On #3609, all 84 ordinary editor-web tests passed before the separate proof failed in [job 140313789675](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45940574470/job/140313789675). The exact #3534 revision passed the focused local installed proof in wrkflw run `20261127-043727494-f64f62`.

An enabled folder button exists before the editor bundle registers its handler. The page event and the injected picker's readiness do not establish that the bundle ran. This is a startup race in the proof and a plausible cause of the CI signature; the failed jobs did not retain enough state to establish it.

## Acceptance Criteria

1. Open the folder only after the installed start document has loaded its editor handlers and the proof picker is ready.
2. If Game Settings still fails to open, report the editor's observed host status and the original failure.
3. Keep the standalone installation, saved-byte assertions, offline reopen, and cleanup checks unchanged. Do not extend the Game Settings wait.

## Verification

Run the focused `pnpm editor:pwa:proof` in the CI Playwright image and confirm the required GitHub editor-web lane on the repaired revision.
