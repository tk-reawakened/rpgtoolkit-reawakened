---
title: 'Live player audio stutters from ScriptProcessorNode underruns'
type: 'bug'
ticket: '17'
status: 'in-review'
tracker_id: '#1043'
risk: 'medium'
---

# Plan

PR #1042 proposes the buffer mitigation. Issue #1043 records the original evidence, required real-output proof, and the buffer-assertion perturbation; a buffer-size check alone does not prove playback is dropout-free.
