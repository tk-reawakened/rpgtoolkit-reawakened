---
name: tkr-issue-preflight
description: 'Resolves a GitHub issue number (#NNN or an issue URL) to the one internal BMad ticket that carries it, its existing plan path, and the reference stock bmad-ticket and bmad-build accept; fails closed on missing, duplicate or conflicting identities. Use when the user hands over an issue number to build, plan, resume, review or close in rpgtoolkit-reawakened, e.g. "work #1234", "what is the plan for issue 987". Not for creating or editing issues or tickets.'
---

# Issue preflight

Issues are the project's front door and tickets are BMad's. Before any build, plan or review starts from `#NNN`, find the single ticket that carries that tracker id so work lands on the right plan. A wrong guess here means building under the wrong ticket or opening a second plan for work already planned, so an unclear answer stops the work.

## Run it

```bash
uv run "{skill-root}/scripts/resolve_issue.py" "<#NNN | NNN | issue URL>" --project-root "{project-root}" --check-stock
uv run "{skill-root}/scripts/resolve_issue.py" --validate-store --project-root "{project-root}"
```

It reads the whole ticket store under `{output_folder}` and never writes. Quote both paths: a checkout path can hold spaces or shell characters. `--check-stock` also asks the project's stock ticket reader about the same ticket and checks its identity and joined plan. An empty stock tracker ID is expected for TOML-only mappings; a different nonempty ID is a conflict. Leave the check off only to inspect a store you know stock cannot read. It never calls GitHub.

`--validate-store` takes no issue and runs before every build route, because stock no longer checks tracker IDs itself. It fails unless no number is on two tickets, each ticket's entry, file and `remote` agree (and name this repository), and no joined plan carries another ticket's issue number. It exits 0 with counts when the store is sound.

## Read the result

`ok: true` with `buildable: true` (a story, spike or bug): report `key`, `title`, `kind`, and the plan: `plan.exists` with its `status` means the build resumes that plan; `false` means the build will start one at `plan.path`. Hand the work to `bmad-build` or `bmad-ticket` with `handoff.bmad_build_input` (for example `7.1`) only when it is set: it is set only when stock's own reader, asked for the ref in the active initiative as a bare `find` is, returns this very ticket. File-name refs (backlog, unlisted-id-less leaves) are always scoped. Never hand over the bare `#NNN`; stock documents refs, file names and title phrases, not issue numbers. When it is `null` (no active initiative set, or the ticket lives in another one), give the user `handoff.scoped` (folder and ref) and `handoff.stock_find`, a shell-quoted command that names the project root, and relay `handoff.note`; do not change the active initiative for them. Relay every `warnings` entry beside the answer.

`buildable: false` (an epic or initiative): it holds tickets and is not built itself; `--check-stock` returns `stock_check.checked: false` for it and still exits 0. List `children` with their tracker ids (a pulled leaf's id counts; `tracker_id_conflict` on a child means its entry and file disagree) and ask which to preflight.

`ok: false`: report `code` and `error` verbatim and stop. Each is a store defect for the owner to fix, not something to work around:

- `not_found`: no ticket carries the number. `mentions` lists plans that name it. Do not create an issue or a ticket to make it resolve; the ticket may be unpublished, or the number mistyped.
- `duplicate_tracker_id`, `tracker_id_conflict`: two tickets share the number, or one ticket's carriers (entry, file, `remote` issue number) disagree. Show the paths and let the user choose which is wrong.
- `multiple_plans`, `plan_path_collision`: the plan is ambiguous. Do not pick one. `plan_identity_conflict`: a plan names another issue than its ticket carries, whichever number you asked for.
- `malformed_store` (including a folder that cannot be listed, or a symlink to a folder, which stock follows and this scan would not), `bad_remote`, `wrong_repository` (an issue URL, or a ticket's `remote`, in another repository), `stock_unreadable`, `stock_disagrees`, `bad_config`, `bad_reference`: the store, the stock reader or the input is wrong.

A malformed ticket file anywhere in the store fails every lookup, by design: an unreadable file could hold the duplicate.

## Limits

- The number is a name, not proof the issue is open or exists on GitHub; a ticket can carry a stale id.
- It reads these layouts: entries in an epic's `tickets.toml`, pulled leaf files, leaf files the breakdown does not list, `backlog/` leaves, epic rows in an initiative's `tickets.toml`, epic and initiative files, and any plan in the ticket's own folder joined by `ticket:` id or leaf file stem. A plan elsewhere joins only by `ticket: "#NNN"`.
- A plan is any markdown with a `ticket` key whose `type` is not story, spike or bug, or whose name ends `-plan.md`; historical plan types (feature, bugfix, chore) are fine.
- `--check-stock` compares leaves only: reference, epic, id, plan path, whether the plan exists, which plan stock's own reader joined, and the plan's status. A plan stock does not join (for example one typed `story`) fails it with `stock_disagrees` even when the path matches. A tracker id stock leaves empty is not a conflict; a different one is.
