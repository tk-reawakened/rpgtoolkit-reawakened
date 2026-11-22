---
id: 31
type: bug
title: "Host-web project registration swallows IndexedDB errors"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3354"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3354"
refined: true
hitl: false
risk: low
severity: P2
---

# Host-web project registration swallows IndexedDB errors

## Description

Selecting a project folder in the web editor reported only "A persistent project folder could not be registered. Open a .gam session copy instead; folder changes will not be saved." The real cause was a stale `tkr-editor-projects` database at a newer IndexedDB version than the editor requests, which fails with `VersionError`. `packages/host-web/src/projects.ts` discarded that error in `openDatabase`, `readProjects`, `writeProject`, `sameEntry` and `restoreWebProject`, so a version mismatch was indistinguishable from a genuinely bad folder.

## Reproduction

1. Create the web editor's projects database at a newer version than the editor requests.
2. Select a project folder in the web editor.
3. Actual: the registration message above, with no diagnostic naming the cause.
4. Expected: the failure is reported with the operation scope and the error name, so a version mismatch is identifiable without deleting databases by guesswork.

## Acceptance Criteria

1. **Every project failure is reported with its scope**
   **Given** a failure in opening, reading, writing, comparing or restoring a project
   **When** the host catches it
   **Then** the console names the operation (for example `projects.open`) and the error name, and a bounded in-memory list keeps the most recent failures for later telemetry
2. **Behaviour is unchanged**
   **Given** any of those failures
   **When** it is reported
   **Then** the host still returns the same `null`/`false` it returned before, and no caller changes behaviour
3. **A version mismatch is provable**
   **Given** a `VersionError` from `openDatabase`
   **When** the host reports it
   **Then** a test records it as `projects.open`

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3354
- code — `packages/host-web/src/projects.ts`, `packages/host-web/src/host-log.ts`
- test — `packages/host-web/test/projects.test.ts`

## Notes

- Delivered by PR #3355.
- Out of scope there: the other `catch {}` sites in `settings.ts`, `workbench.ts`, `filesystem.ts` and `language.ts`, and surfacing the reason in the editor's status line.
