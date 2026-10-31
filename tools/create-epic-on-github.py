#!/usr/bin/env python3
"""Create or sync one BMAD epic parent issue from the initiative ticket store.

The initiative tickets.toml remains authoritative. This command mirrors the
parent issue to GitHub, stores its tracker_id, adds it to Project 3, and links
any story issues that already have tracker IDs. Run the story migrator first
for a complete parent/sub-issue hierarchy.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import tomllib
from pathlib import Path

REPO = "tk-reawakened/rpgtoolkit-reawakened"
INITIATIVE = "initiative-rpgtoolkit-reawakened"
PROJECT_ID = "PVT_kwDOFH0rD84Bnzfi"
STATUS_FIELD_ID = "PVTSSF_lADOFH0rD84BnzfizhmWa0w"
STATUS_OPTION_IDS = {
    "draft": "21a74e34",
    "ready-for-dev": "a8cecafe",
    "in-progress": "f6c0d6d9",
    "in-review": "fb146e09",
    "built": "bc56f2f4",
    "blocked": "31d77a88",
    "done": "d4a82464",
    "dropped": "939c6cf8",
}
STATE_TO_STATUS = {
    "backlog": "draft",
    "in-progress": "in-progress",
    "review": "in-review",
    "done": "done",
    "dropped": "dropped",
}
ITEM_QUERY = """query($issue:ID!) {
  node(id:$issue) {
    ... on Issue {
      projectItems(first:100) {
        nodes {
          id
          project { id }
          fieldValues(first:50) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { id } }
              }
            }
          }
        }
      }
    }
  }
}"""


def store_tickets(root: Path) -> dict[str, dict]:
    """Every stored ticket keyed by its tracker_id, from the store's own status view.

    A breakdown entry carries no status: the plans do. Asking the store keeps the mirrored
    Project status equal to what BMAD records, instead of resetting every story to draft."""
    result = subprocess.run(
        [sys.executable, str(root / "_bmad/method/scripts/tickets.py"),
         "--project-root", str(root), "status", INITIATIVE],
        text=True, capture_output=True, check=True, cwd=root,
    )
    view = json.loads(result.stdout)
    return {ticket["tracker_id"]: ticket for ticket in view.get("tickets", []) if ticket.get("tracker_id")}


def story_status(tracker: str, fallback: str, tickets: dict[str, dict]) -> str | None:
    """The story's Project status, or None when the store cannot say and nothing should be written.

    Writing the breakdown's own status would reset every planned story to draft, because a
    breakdown entry carries no status; an empty leaf frontmatter must not erase a real one."""
    ticket = tickets.get(tracker)
    if ticket:
        if ticket.get("status") in STATUS_OPTION_IDS:
            return ticket["status"]
        if ticket.get("state") in STATE_TO_STATUS:
            return STATE_TO_STATUS[ticket["state"]]
    return fallback if fallback in STATUS_OPTION_IDS else None


def project_item_status(item: dict) -> str:
    """The item's Status option name, or "" when the project has not set one."""
    for value in item.get("fieldValues", {}).get("nodes", []):
        if (value.get("field") or {}).get("id") == STATUS_FIELD_ID:
            return value.get("name") or ""
    return ""


def gh_api(endpoint: str, payload: dict | None = None, method: str = "POST") -> dict:
    command = ["gh", "api", endpoint]
    if payload is not None:
        command.extend(["--method", method, "--input", "-"])
    for attempt in range(3):
        result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                text=True, capture_output=True)
        if result.returncode == 0:
            break
        # A TLS handshake timeout in the middle of a 37-story epic must not lose the run.
        if attempt == 2:
            # `check=True` hid the reason inside CalledProcessError, which made a GraphQL refusal
            # (a child already parented elsewhere) read as an unexplained non-zero exit.
            raise RuntimeError(f"gh api {endpoint} failed: {result.stderr.strip() or result.stdout.strip()}")
        time.sleep(2 * (attempt + 1))
    response = json.loads(result.stdout) if result.stdout.strip() else {}
    if endpoint == "graphql" and response.get("errors"):
        raise RuntimeError(f"GitHub GraphQL error: {response['errors']}")
    return response


def find_issue_by_title(title: str) -> list[int]:
    """Numbers of issues (open or closed) whose title is exactly `title`."""
    result = subprocess.run(
        ["gh", "issue", "list", "--repo", REPO, "--state", "all", "--search", f'"{title}" in:title',
         "--json", "number,title", "--limit", "20"],
        text=True, capture_output=True, check=True,
    )
    return [int(issue["number"]) for issue in json.loads(result.stdout) if issue["title"] == title]


def github_issue_number(tracker_id: str) -> int:
    match = re.fullmatch(r"#?(\d+)", tracker_id.strip())
    if not match:
        raise ValueError(f"Invalid tracker_id: {tracker_id!r}")
    return int(match.group(1))


def write_epic_tracker_id(index_path: Path, epic_id: int, tracker_id: str) -> None:
    text = index_path.read_text(encoding="utf-8")
    blocks = re.split(r"(?=\[\[epic\]\])", text)
    for idx, block in enumerate(blocks):
        if re.search(rf"(?m)^id\s*=\s*{epic_id}\s*$", block):
            if re.search(r"(?m)^tracker_id\s*=", block):
                blocks[idx] = re.sub(r"(?m)^tracker_id\s*=.*$", f'tracker_id = "{tracker_id}"', block, count=1)
            else:
                lines = block.splitlines(keepends=True)
                for line_idx, line in enumerate(lines):
                    if re.match(r"id\s*=", line):
                        lines.insert(line_idx + 1, f'tracker_id = "{tracker_id}"\n')
                        break
                blocks[idx] = "".join(lines)
            index_path.write_text("".join(blocks), encoding="utf-8")
            return
    raise ValueError(f"Epic id {epic_id} was not found in {index_path}")

def write_epic_frontmatter(epic_doc: Path, tracker_id: str) -> None:
    text = epic_doc.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, flags=re.S)
    if not match:
        raise ValueError(f"Epic document has no YAML frontmatter: {epic_doc}")
    issue_number = github_issue_number(tracker_id)
    lines = match.group(1).splitlines()
    fields = {
        "tracker_id": f'"{tracker_id}"',
        "remote": f'"https://github.com/{REPO}/issues/{issue_number}"',
    }
    for key, value in fields.items():
        for idx, line in enumerate(lines):
            if line.startswith(f"{key}:"):
                lines[idx] = f"{key}: {value}"
                break
        else:
            lines.append(f"{key}: {value}")
    updated = match.group(0).replace(match.group(1), "\n".join(lines), 1) + text[match.end():]
    if updated != text:
        epic_doc.write_text(updated, encoding="utf-8")


def graphql(query: str, variables: dict) -> dict:
    return gh_api("graphql", {"query": query, "variables": variables})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="Epic folder slug, e.g. epic-deferred-work")
    parser.add_argument("--dry-run", action="store_true", help="Show the issue and links without changing GitHub or tickets.toml")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    initiative = root / "_bmad-output/initiative-rpgtoolkit-reawakened"
    index_path = initiative / "tickets.toml"
    index = tomllib.loads(index_path.read_text(encoding="utf-8"))
    epic = next((item for item in index.get("epic", []) if item.get("slug") == args.slug), None)
    if epic is None:
        raise SystemExit(f"No initiative epic with slug {args.slug!r}")

    epic_id = int(epic["id"])
    epic_dir = initiative / args.slug
    epic_doc = epic_dir / f"{args.slug}.md"
    story_index = epic_dir / "tickets.toml"
    if not epic_doc.is_file() or not story_index.is_file():
        raise SystemExit(f"Expected {epic_doc} and {story_index}")

    markdown = epic_doc.read_text(encoding="utf-8")
    body = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", markdown, count=1, flags=re.S).strip()
    epic_status_match = re.search(r"(?m)^status:\s*([a-z-]+)\s*$", markdown)
    epic_status = epic_status_match.group(1) if epic_status_match else ""
    if epic_status not in {"in-progress", "done", "dropped"}:
        raise SystemExit(f"Epic status must be one of in-progress, done, dropped; got {epic_status!r}")
    title = f"[Epic {epic_id}] {epic['title']}"
    stories = tomllib.loads(story_index.read_text(encoding="utf-8")).get("entry", [])
    existing_tracker = epic.get("tracker_id", "")
    children = [
        (story["id"], story["tracker_id"], story.get("status", "draft"))
        for story in stories if story.get("tracker_id")
    ]
    missing = [story["id"] for story in stories if not story.get("tracker_id")]
    tickets = store_tickets(root)

    if args.dry_run:
        print(f"Would sync parent issue: {title}")
        print(f"Would link story issues: {[tracker for _, tracker, _ in children]}")
        if missing:
            print(f"Stories without tracker_id (not linked yet): {missing}")
        return

    if existing_tracker:
        parent_number = github_issue_number(existing_tracker)
        print(f"Using existing Epic issue #{parent_number}")
    else:
        twins = find_issue_by_title(title)
        if twins:
            raise SystemExit(
                f"Issue {', '.join(f'#{number}' for number in twins)} already carries the title {title!r}. "
                f"Record it as `tracker_id = \"#{twins[0]}\"` for epic {epic_id} in the initiative index "
                "instead of creating a second parent."
            )
        created = gh_api(f"repos/{REPO}/issues", {"title": title, "body": body})
        parent_number = int(created["number"])
        print(f"Created Epic issue #{parent_number}")
    if existing_tracker != f"#{parent_number}":
        # The number can live only in the epic document (an envelope created by hand), so the
        # index row still has no tracker_id; write it either way.
        write_epic_tracker_id(index_path, epic_id, f"#{parent_number}")
        print(f"Wrote tracker_id #{parent_number} for epic {epic_id} into the initiative index")
    write_epic_frontmatter(epic_doc, f"#{parent_number}")

    parent = gh_api(f"repos/{REPO}/issues/{parent_number}")
    if parent.get("title") != title or (parent.get("body") or "").rstrip() != body.rstrip():
        gh_api(
            f"repos/{REPO}/issues/{parent_number}",
            {"title": title, "body": body},
            method="PATCH",
        )
        print(f"Updated parent issue #{parent_number} from epic metadata")
    parent_node = parent["node_id"]
    project_query = """mutation($project:ID!, $content:ID!) {
      addProjectV2ItemById(input:{projectId:$project, contentId:$content}) { item { id } }
    }"""
    graphql(project_query, {"project": PROJECT_ID, "content": parent_node})
    item_result = graphql(ITEM_QUERY, {"issue": parent_node})
    items = item_result.get("data", {}).get("node", {}).get("projectItems", {}).get("nodes", [])
    project_item = next((entry for entry in items if entry.get("project", {}).get("id") == PROJECT_ID), None)
    if project_item is None:
        raise RuntimeError(f"Epic issue #{parent_number} was not added to Project 3")
    status_query = """mutation($project:ID!, $item:ID!, $field:ID!, $option:String!) {
      updateProjectV2ItemFieldValue(input:{
        projectId:$project, itemId:$item, fieldId:$field,
        value:{singleSelectOptionId:$option}
      }) { projectV2Item { id } }
    }"""
    if project_item_status(project_item) != epic_status:
        graphql(status_query, {
            "project": PROJECT_ID,
            "item": project_item["id"],
            "field": STATUS_FIELD_ID,
            "option": STATUS_OPTION_IDS[epic_status],
        })
        print(f"Set parent issue #{parent_number} to {epic_status} in Project 3")
    else:
        print(f"Parent issue #{parent_number} already {epic_status} in Project 3")

    existing_children = graphql(
        """query($parent:ID!) {
          node(id:$parent) {
            ... on Issue { subIssues(first:100) { nodes { id } } }
          }
        }""",
        {"parent": parent_node},
    ).get("data", {}).get("node", {}).get("subIssues", {}).get("nodes", [])
    existing_child_ids = {entry["id"] for entry in existing_children}
    for story_id, tracker, fallback_status in children:
        child_number = github_issue_number(tracker)
        child = gh_api(f"repos/{REPO}/issues/{child_number}")
        child_items = graphql(ITEM_QUERY, {"issue": child["node_id"]}).get("data", {}).get("node", {}).get("projectItems", {}).get("nodes", [])
        child_item = next((entry for entry in child_items if entry.get("project", {}).get("id") == PROJECT_ID), None)
        if child_item is None:
            # An issue published before the board learned about it would otherwise abort the
            # whole epic; the board is part of the mirror, so join the story to it and carry on.
            graphql(project_query, {"project": PROJECT_ID, "content": child["node_id"]})
            print(f"Added story issue #{child_number} to Project 3")
            child_items = graphql(ITEM_QUERY, {"issue": child["node_id"]}).get("data", {}).get("node", {}).get("projectItems", {}).get("nodes", [])
            child_item = next((entry for entry in child_items if entry.get("project", {}).get("id") == PROJECT_ID), None)
            if child_item is None:
                raise RuntimeError(f"Story issue #{child_number} could not be added to Project 3")
        status = story_status(tracker, fallback_status, tickets)
        if status is None:
            print(f"Story {epic_id}.{story_id} (#{child_number}): the store reports no status; left as is")
        elif project_item_status(child_item) != status:
            graphql(status_query, {
                "project": PROJECT_ID,
                "item": child_item["id"],
                "field": STATUS_FIELD_ID,
                "option": STATUS_OPTION_IDS[status],
            })
        if child["node_id"] in existing_child_ids:
            print(f"Story {epic_id}.{story_id} (#{child_number}) already linked; status={status}")
            continue
        subissue_query = """mutation($parent:ID!, $child:ID!) {
          addSubIssue(input:{issueId:$parent, subIssueId:$child}) { subIssue { number } }
        }"""
        try:
            graphql(subissue_query, {"parent": parent_node, "child": child["node_id"]})
        except RuntimeError as error:
            # GitHub allows one parent per issue; a story already nested elsewhere must not
            # stop the rest of the epic from being mirrored.
            print(f"Could not link story {epic_id}.{story_id} (#{child_number}): {error}")
            continue
        print(f"Linked story {epic_id}.{story_id} (#{child_number}) under Epic #{parent_number}; status={status}")
    if missing:
        print(f"Stories without tracker_id (not linked yet): {missing}")


if __name__ == "__main__":
    main()
