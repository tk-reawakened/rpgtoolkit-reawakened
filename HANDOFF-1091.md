# Handoff: #1091 input/action routing — paused

**Do not merge PR #3284.** The owner stopped implementation and directed a preservation-only handoff. Auto-merge is disabled. The current PR is too broad to approve without narrowing or proving the replay/protocol changes.

## 1. Goal and original symptoms

Issue [#1091](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1091) reports two script-facing E-110 regressions when project key bindings are configured:

1. Unbound physical keys are dropped before reaching `Wait()`/`Get()`/`waitinput()`.
2. Bound keys queue the configured action name (for example `left`) instead of the physical legacy key name (`LEFT` for ArrowLeft, `A` for KeyA), even though the semantic action must still be dispatched.

The desired narrow fix is one script-facing compatibility-name record per nameable key-down, alongside—not instead of—the complete ordered semantic-action record. Both unbound and bound key presses must reach scripts; configured actions and diagonal movement remain intact.

## 2. Current state

- Worktree: `/private/tmp/tkr-1091-action-routing` (Git also lists the same macOS `/tmp` alias as `/tmp/tkr-1091-action-routing`).
- Branch: `fix/1091-action-routing-review-fixes`.
- Preservation commit: `8f6725a437` (`wip(input): preserve #1091 review state`). It records the unverified E-110 vk-collision mapping and generated baseline updates. No `Fixes` footer.
- The earlier branch tip is `02019fdfd9`; this branch was rebased onto the fetched `origin/main` `c52d33d1` before the pause. Do not rebase again without owner direction.
- PR [#3284](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3284) is OPEN, 94 files, and was `DIRTY`/`CONFLICTING` at remote head `e900d91b` against base `b5a5d508`. The local branch already contains `c52d33d1`; a preservation push may refresh the PR head. Recheck live state before resuming.
- Auto-merge was disabled successfully. `gh pr checks 3284` reported: `no checks reported on the 'fix/1091-action-routing-review-fixes' branch` for the then-current remote head. No CI checks were observed for that head.
- Local checks previously run before the preservation commit/latest collision edit: `pnpm typecheck` passed; `pnpm golden:record` then `pnpm golden` passed; `pnpm script:dogfood:record` then `pnpm script:dogfood` passed; `node --test tools/fixtures/test/movement.test.mjs` passed 19/19. `pnpm lint` passed before the rebase, not on the final state.
- The focused post-rebase suite had two failing historical v1/v2 replay hash assertions: expected `d8811003f01b4e3c`, actual `9ef4e57a4c710606`; the other tests in that focused run passed. This is a demonstrated pin mismatch, not yet evidence that menu results or historical semantics are wrong. Do not simply re-pin without asserting the resulting menu state.
- **Not locally verified:** the E-110 vk-collision edit in commit `8f6725a437`, any of the latest reviewer findings, or the exact current remote PR head after the preservation push. No tests were run after that edit.

## 3. Design decisions and rationale

- **Active v3 vs frozen history:** active v3 keyboard records carry physical `code`/`char`/`vk`; core derives the script-facing name. Historical v1/v2 recordings lack `vk` and must retain their name-based replay behavior through a version-scoped adapter. Do not rewrite frozen v1/v2 schemas, vectors, or recordings to fit v3.
- **Compatibility name plus ordered actions:** a semantic press edge still appends the E-112 rule-4 compatibility-name entry to `state.keys` (for example `right`, `confirm`, `menu`) as well as the ordered action record. `wait()`/replay require the key entry. Do not change fixtures to an action-only interpretation.
- **Screen ownership:** a screen that owns a physical input drains that event's complete ordered action batch before transitioning to a child/provider. Remaining actions must not be replayed to a newly opened UI; cancel-plus-menu tail handling must not be dropped.
- **Defaults / ACT-4 vs ACT-5 and E-80:** the owner-directed reconciliation is Enter/NumpadEnter = confirm and KeyM = menu by default. Keep an explicit accessible menu binding. ACT-4's full ordered action dispatch remains intact; ACT-5/E-80's overlapping Enter defaults are resolved in the default map rather than by truncating events at runtime. The docs-first amendment is separate commit `eb8e77f78` (rejected alternative recorded); related clarification commit `88a359ef3` is also in the branch.
- **Rejected alternatives:** do not special-case Enter to suppress/drop `menu`, truncate a custom ordered binding list, or deliver a tail action to a newly opened screen. Those violate generic remapping/ACT-4 semantics. Do not remove the key compatibility entry when an action record exists. Do not reinterpret v1/v2 recordings or replace independent expected results with re-recorded outputs merely to make the suite green.
- **Prior #1589/#1607 regression:** PR #1589 changed queued names to raw `event.name`; this broke the stock menu because `waitinput()` exposed only the key name while menu scripts consumed the semantic `menu` label. Issue #1607 records the 14 stock-menu CI failures on that PR branch and was closed after establishing the regression was not on main. The replacement must preserve both script key names and semantic routing; do not revive the raw-name-only patch.

## 4. Remaining review findings and evidence status

No dedicated red regression test was run for these findings in the final review round. Treat them as reviewer-identified hypotheses requiring a focused reproducer before changing code; do not claim they are demonstrated by the prior broad suite.

| Finding | Status at pause |
|---|---|
| Historical v1/v2 second Enter while Main is open may open Items and then have the menu tail clear/close it | Speculative in this worktree; no second-Enter failing regression was run. Existing migration test only asserted the first Enter/Main state. |
| Action-only `confirm` is recorded in `actionKeys`, but trigger activation scans only `input.keys` | Speculative here; reviewer identified the runtime path, but no failing trigger test was run. |
| E-110 vk collisions `%/&/'/(` with vk 37–40 should resolve to LEFT/UP/RIGHT/DOWN | Spec-backed, but not test-demonstrated. Commit `8f6725a437` contains an unverified mapping change; add/run a failing-before regression before relying on it. |
| Movement oracle fallback for non-aliased vk 13/27 may disagree with core | Speculative; no direct oracle-vs-core failing case was run. |
| Supplementary Unicode scalar chars may fail schema/host adapters despite core accepting them | Speculative; no failing protocol-vector or host-adapter test was run. |
| Unnameable physical-key key-up cleanup leak | Not resolved in this pause. A prior reviewer believed key-up release handling was okay, but the later owner request named it as a concern; obtain a focused regression rather than assuming either conclusion. |
| Cancel+menu tail drain / delivery to newly opened UI | Prior reviewer said the existing stock-menu coverage confirms cancel+menu tail drain; still retain that case when narrowing. |
| Historical replay hash pin | **Demonstrated test failure:** two old expected hash values differ from current result (`d881...` vs `9ef4...`). Cause and menu-result equivalence were not established. |

The independent reviewer also raised concern about the broad test migrations and replay behavior. The earlier review saw no evidence of dropped cases or unrelated golden re-recording, but there was no final independent review of a narrowed patch. The branch currently has broad v3/replay changes across 94 PR files; do not bless every test edit without checking that it preserves the original assertion and only changes the contract shape.

## 5. Known hazards and allocations

- `/Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-1091-ticket`, branch `fix/1091-ticket`, has a dangerous `Fixes #1091` footer. **Never merge that branch/PR.**
- Test/fixture migrations across the current PR were formerly dirty WIP and are now part of its history. They remain unverified as a group; preserve assertions and cases.
- `8f6725a437` includes generated `golden/scripts/golden.json` and `packages/script-cli/baselines/{stock-battle-test,stock-menu-test,stock-rpg-test,test}.json` changes. Prior review described these as hash/state-hash-only; the latest vk edit was not tested against them. Do not rerun any `*:record` command as verification or blindly accept new baselines.
- BMAD ticket for #1091 is **ID 21** (`_bmad-output/backlog/bug-script-key-names-with-bindings.md`); `_bmad-output/backlog/tickets.toml` has `next_id = 22`. Do not reallocate IDs. Current allocator notes: ID 6 reserved for #3251/#1324; ID 7 for #1643; IDs 8–12 allocated to linked tickets; ID 13 = #3250, ID 14 = #2795, ID 15 = #3257, IDs 16–20 = #2795 follow-ups #3278–#3282.

## 6. Recommended narrower path

Follow the owner's current scope: land only the two #1091 symptoms—unbound keys reach scripts and bound keys queue the compatibility name—while preserving semantic actions beside the key record. Start/rebase from current `origin/main` only after checking with the owner if needed. Split the active-v3/ordered-action/replay-version work into its own tracked issue and PR; do not force that broader protocol change into #1091 without focused local proof. Keep the existing PR paused until the narrow patch is independently reviewed and required CI passes.

## 7. Context and focused verification commands

Start by checking state without touching other worktrees:

```sh
cd /private/tmp/tkr-1091-action-routing
pwd && git branch --show-current && git status --short
gh pr view 3284 --json state,headRefOid,baseRefOid,mergeStateStatus,autoMergeRequest
```

The ticket plan's focused gate is:

```sh
pnpm build && node --test \
  packages/core/test/input.test.ts \
  packages/core/test/pointer-wait.test.ts \
  packages/core/test/stock-menu.test.ts \
  packages/core/test/save-migration.test.ts \
  packages/runner-harness/test/driver.test.ts \
  packages/runner-harness/test/script-plugin-host.test.ts \
  packages/runner-harness/test/protocol-v3.test.ts && \
pnpm runner-protocol:check && \
node --test tools/fixtures/test/runner-protocol-v3.test.mjs
```

Additional relevant gates previously used:

```sh
pnpm typecheck
pnpm lint
pnpm golden
pnpm script:dogfood
node --test tools/fixtures/test/movement.test.mjs
```

Add narrow regressions for the findings above before fixing them. The pinned v1/v2 replay test must assert the actual menu result as well as hashes. The baseline record commands (`pnpm golden:record`, `pnpm script:dogfood:record`) mutate files and are **not** verification commands.

## 8. Related worktrees, branches, issues, and PRs

Confirmed worktrees/branches (do not modify another worker's tree):

- `/private/tmp/tkr-1091-action-routing` (Git alias `/tmp/tkr-1091-action-routing`) — this handoff; `fix/1091-action-routing-review-fixes`; PR #3284.
- `/Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-1091-ticket` — `fix/1091-ticket`; unsafe `Fixes #1091` footer, never merge.
- `/tmp/items-1091-key-action` — `fix/1091-key-action-compat`.
- `/private/tmp/tkr-1091-reconcile` — `fix/1091-reconcile`; Git marks its worktree registration prunable; do not clean it up here.
- `/tmp/tkr-1091-baseline-hash` — detached at `b5a5d508`.
- `/Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-2153-title-buttons` — separate #2153 branch `fix/2153-setbutton-image-contract`; the `keyboard-1091` worker is there, not in this worktree. Do not touch.

Other local `fix/1091*` refs seen: `fix/1091`, `fix/1091-clean`, `fix/1091-input-keys-drop-and-names`, `fix/1091-key-action-compat`, `fix/1091-reconcile`, and `fix/1091-ticket` (the current branch is `fix/1091-action-routing-review-fixes`).

Related GitHub items:

- #1091 — open issue; PR #3284 is the paused replacement attempt.
- PR #1589 (`fix/1091-clean`) — closed draft; contains the #1607 stock-menu regression approach. Do not merge.
- PR #1588 (`fix/1091-input-keys-drop-and-names`) — closed older attempt.
- Issue #1607 — closed; documents the #1589 menu regression and why semantic routing must remain.
- PR #1107 — merged input-action specification that supplies the key/action contract context.
- #1099 and #1222 are referenced by #1091's history as naming and overlapping input/save work; coordinate before editing those same seams.
