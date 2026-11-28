---
type: feature
title: "Observe a first-time author using beginner tools"
ticket: 15
tracker_id: "#3640"
status: draft
risk: high
---

# Observe a first-time author using beginner tools

## Scope

Complete the real-person acceptance transferred from 14.8. Recruit a genuine first-time author with no prior experience using this editor; observe them complete all nine first-board steps in both browser and VS Code, then attempt a small integrated beginner-tools journey. Do not build product features in this task; file discovered bugs or fixes through the repo's normal issue/PR rules.

Use the same author in both hosts. Record which host is first and why, the build/revision and date, exact task prompts, all interventions, time/step order as useful, confusing or failing behavior, and anonymized findings. Preserve privacy; do not include identifying details. Ask the author to use keyboard equivalents, control tips, cancel a step and resume with progress preserved, and explain/choose among preview, Test Board, and normal startup. The integrated journey should use at least one beginner tool beyond the tutorial and connect it to an authored/run result; record the exact path and any host capability limits rather than treating unsupported behavior as success.

A blind independent-agent walkthrough can be attached as interim usability evidence only, clearly labelled independent-agent/AI evidence. It does not count as the genuine human walkthrough or close this task. Staff or AI surrogates do not satisfy acceptance.

## Acceptance and verification

A genuine first-time author completes the nine tutorial steps in both browser and VS Code and attempts the small integrated beginner-tools journey. The dated, anonymized report records build/revision, host order, prompts/interventions, keyboard and tips use, cancel/resume persistence, understanding of preview vs Test Board vs normal startup, confusing/failing steps, and findings. Relevant issues or fixes are filed under repository rules. Do not close this ticket until the observed human session and report exist.

## Dependencies and decisions

Runs after 14.10's integrated technical acceptance. Owner decision (2026-11-27) transfers the human-acceptance portion of 14.8 here. After the planning PR merges, #1751 closes as technically complete on the existing proof, with no human walkthrough claimed; #3640 is the sole remaining human-acceptance gate, and Epic #1360 remains open. A blind independent-agent review may precede this but is not human acceptance.

## References

- Final HITL task: https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3640
- Transferred 14.8 acceptance: https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1751
- Technical proof PR: https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3474
- Epic: https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360
