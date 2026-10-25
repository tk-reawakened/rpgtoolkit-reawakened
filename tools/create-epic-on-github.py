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
import tomllib
from pathlib import Path

REPO = "tk-reawakened/rpgtoolkit-reawakened"
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


def gh_api(endpoint: str, payload: dict | None = None, method: str = "POST") -> dict:
    command = ["gh", "api", endpoint]
    if payload is not None:
        command.extend(["--method", method, "--input", "-"])
        result = subprocess.run(command, input=json.dumps(payload), text=True, capture_output=True, check=True)
    else:
        result = subprocess.run(command, text=True, capture_output=True, check=True)
    response = json.loads(result.stdout) if result.stdout.strip() else {}
    if endpoint == "graphql" and response.get("errors"):
        raise RuntimeError(f"GitHub GraphQL error: {response['errors']}")
    return response


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
        created = gh_api(f"repos/{REPO}/issues", {"title": title, "body": body})
        parent_number = int(created["number"])
        write_epic_tracker_id(index_path, epic_id, f"#{parent_number}")
        print(f"Created Epic issue #{parent_number} and wrote tracker_id")
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
    item_query = """query($issue:ID!) {
      node(id:$issue) {
        ... on Issue { projectItems(first:100) { nodes { id project { id } } } }
      }
    }"""
    item_result = graphql(item_query, {"issue": parent_node})
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
    graphql(status_query, {
        "project": PROJECT_ID,
        "item": project_item["id"],
        "field": STATUS_FIELD_ID,
        "option": STATUS_OPTION_IDS[epic_status],
    })
    print(f"Added parent issue #{parent_number} to Project 3 with {epic_status} status")

    existing_children = graphql(
        """query($parent:ID!) {
          node(id:$parent) {
            ... on Issue { subIssues(first:100) { nodes { id } } }
          }
        }""",
        {"parent": parent_node},
    ).get("data", {}).get("node", {}).get("subIssues", {}).get("nodes", [])
    existing_child_ids = {entry["id"] for entry in existing_children}
    for story_id, tracker, status in children:
        child_number = github_issue_number(tracker)
        child = gh_api(f"repos/{REPO}/issues/{child_number}")
        child_items = graphql(item_query, {"issue": child["node_id"]}).get("data", {}).get("node", {}).get("projectItems", {}).get("nodes", [])
        child_item = next((entry for entry in child_items if entry.get("project", {}).get("id") == PROJECT_ID), None)
        if child_item is None:
            raise RuntimeError(f"Story issue #{child_number} is not in Project 3")
        option = STATUS_OPTION_IDS.get(status.lower())
        if option is None:
            raise ValueError(f"Unsupported status {status!r} for story {epic_id}.{story_id}")
        graphql(status_query, {
            "project": PROJECT_ID,
            "item": child_item["id"],
            "field": STATUS_FIELD_ID,
            "option": option,
        })
        if child["node_id"] in existing_child_ids:
            print(f"Story {epic_id}.{story_id} (#{child_number}) already linked; status={status}")
            continue
        subissue_query = """mutation($parent:ID!, $child:ID!) {
          addSubIssue(input:{issueId:$parent, subIssueId:$child}) { subIssue { number } }
        }"""
        graphql(subissue_query, {"parent": parent_node, "child": child["node_id"]})
        print(f"Linked story {epic_id}.{story_id} (#{child_number}) under Epic #{parent_number}; status={status}")
    if missing:
        print(f"Stories without tracker_id (not linked yet): {missing}")


if __name__ == "__main__":
    main()
