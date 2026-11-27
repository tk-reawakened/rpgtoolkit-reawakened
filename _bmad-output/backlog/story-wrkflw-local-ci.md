---
id: 40
type: story
title: "Reusable local CI with wrkflw"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3607"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3607"
refined: true
hitl: false
risk: low
---

# Reusable local CI with wrkflw

Run selected jobs from the checked-out CI workflow with retained dependency workspaces, without maintaining a second set of versions or test commands. Keep GitHub's required gate authoritative.

## Acceptance Criteria

1. Given an existing CI browser lane, when selected locally, only that matrix lane and its prerequisites run; tracked workflow bytes remain unchanged.
2. Given an unknown selection or option, the launcher fails before starting a workflow rather than running all jobs.
3. Given repeated local runs, workspaces are retained by default; an explicit fresh option starts empty, and no passing-result reuse is requested.
4. Given a local run, concurrency is limited to one job and a simultaneous launcher in the same checkout refuses to start.
5. Given setup instructions, contributors can install a container runtime and wrkflw, inspect a plan, run a job, and distinguish partial/unverified results from a real GitHub gate pass. The known setup-node, IPC, architecture and memory differences are disclosed.

## Implementation

`tools/ci/local.mjs`, `package.json` and `CONTRIBUTING.md`. Derived workflow and lock live beneath the existing ignored `.cache/` directory. No publishing jobs, automatic git hook, platform emulation, arbitrary runtime fallback or weakened CI assertions.

## Verification

Run the launcher against the small `changes` job in Podman, inspect an editor-web plan, and reject an invalid lane. Previous direct pilots ran the editor-web and editor-vscode lanes; see #3597 and #3606. An individual green local run does not establish absence of flaky behavior.

Check retained and fresh arguments, lock refusal and release on an interrupted
run, and rejection of a workflow whose browser matrix cannot be narrowed safely.
