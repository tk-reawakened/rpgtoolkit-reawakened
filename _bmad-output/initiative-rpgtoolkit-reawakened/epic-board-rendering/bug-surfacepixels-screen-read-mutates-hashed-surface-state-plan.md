---
title: 'surfacePixels screen read mutates hashed surface state'
type: 'bug'
ticket: '41'
status: 'blocked'
blocked_reason: 'Awaiting #1047 landing on main and owner confirmation before starting #1048.'
tracker_id: '#1048'
risk: 'high'
---

# Plan

**Approved ruling (owner: Jensen, 2026-11-01), option C** — the presented screen surface is a derived cache excluded from the hash, rebuilt deterministically on restore before any script read; script-owned canvases (`cnvX`) remain hashed. Implementation is unstarted; do not start until #1047 is on main and the owner confirms.
