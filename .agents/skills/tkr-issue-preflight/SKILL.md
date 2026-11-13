---
name: tkr-issue-preflight
description: 'Resolves a GitHub issue number (#NNN or an issue URL) to the one internal BMad ticket that carries it, its existing plan path, and the reference stock bmad-ticket and bmad-build accept; fails closed on missing, duplicate or conflicting identities. Use when the user hands over an issue number to build, plan, resume, review or close in rpgtoolkit-reawakened, e.g. "work #1234", "what is the plan for issue 987". Not for creating or editing issues or tickets.'
---

# Issue preflight

Issues are the project's front door and tickets are BMad's. Before any build, plan or review starts from `#NNN`, find the single ticket that carries that tracker id so work lands on the right plan. A wrong guess here means building under the wrong ticket or opening a second plan for work already planned, so an unclear answer stops the work.

## Run it

```bash
uv run {skill-root}/scripts/resolve_issue.py "<#NNN | NNN | issue URL>" --project-root {project-root} --check-stock
```

It reads the whole ticket store under `{output_folder}` and never writes. `--check-stock` also asks the project's stock `tickets.py find` about the same ticket and fails unless it names the same tracker id and plan; leave it off only to inspect a store you know stock cannot read. It never calls GitHub.

## Read the result

`ok: true` with `buildable: true` (a story, spike or bug): report `key`, `title`, `kind`, and the plan: `plan.exists` with its `status` means the build resumes that plan; `false` means the build will start one at `plan.path`. Hand the work to `bmad-build` or `bmad-ticket` with `handoff.bmad_build_input` (for example `7.1`), never the bare `#NNN`: stock BMad documents refs, file names and title phrases, not issue numbers. When `handoff.in_active_initiative` is `false`, stock looks only in the active initiative and `backlog/`; give the user `handoff.stock_find`, which names the folder, instead of changing the active initiative for them. Relay every `warnings` entry beside the answer.

`buildable: false` (an epic or initiative): it holds tickets and is not built itself. List `children` with their tracker ids and ask which to preflight.

`ok: false`: report `code` and `error` verbatim and stop. Each is a store defect for the owner to fix, not something to work around:

- `not_found`: no ticket carries the number. `mentions` lists plans that name it. Do not create an issue or a ticket to make it resolve; the ticket may be unpublished, or the number mistyped.
- `duplicate_tracker_id`, `tracker_id_conflict`: two tickets share the number, or one ticket's carriers (entry, file, `remote`) disagree. Show the paths and let the user choose which is wrong.
- `multiple_plans`, `plan_path_collision`, `plan_identity_conflict`: the plan is ambiguous. Do not pick one.
- `malformed_store`, `stock_unreadable`, `stock_disagrees`, `bad_config`, `bad_reference`, `wrong_repository`: the store, the stock reader or the input is wrong.

A malformed ticket file anywhere in the store fails every lookup, by design: an unreadable file could hold the duplicate.

## Limits

- The number is a name, not proof the issue is open or exists on GitHub; a ticket can carry a stale id.
- It reads these layouts: entries in an epic's `tickets.toml`, pulled leaf files, leaf files the breakdown does not list, `backlog/` leaves, epic rows in an initiative's `tickets.toml`, epic and initiative files, and any plan in the ticket's own folder joined by `ticket:` id or leaf file stem. A plan elsewhere joins only by `ticket: "#NNN"`.
- A plan is any markdown with a `ticket` key whose `type` is not story, spike or bug, or whose name ends `-plan.md`; historical plan types (feature, bugfix, chore) are fine.
- `--check-stock` compares leaves only, and only as far as tracker id and plan path.
