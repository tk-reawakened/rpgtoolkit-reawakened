---
id: 15
type: story
title: "Coverage: measured baseline, enforced thresholds, generated-code exemptions"
parent: epic-platform-baseline
tracker_id: "#616"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/616"
tracker_status: done
covers: [CAP-13]
after: []
refined: true
hitl: true
risk: medium
---

# Coverage: measured baseline, enforced thresholds, generated-code exemptions

## Description

Adds coverage to the existing test path with Node's built-in runner only, sets thresholds from the measured baseline on `main`, ratchets them upward only, and exempts the generated catalogue stubs. The entry never had a leaf file, so the store kept reporting it as `planned` although #616 closed COMPLETED on 2026-10-24; this leaf records the delivery state without changing any plan.

## Evidence

`package.json` `coverage` runs `node --experimental-test-coverage` with `--test-coverage-lines=91` and `--test-coverage-branches=81` over `packages/*/src/**`, excluding `**/catalogue-stubs.ts`, and writes `coverage/lcov.info`. CI merges the per-shard LCOV files in the `gate` job. Issue #616 closed COMPLETED on 2026-10-24.
