#!/usr/bin/env python3
"""Migrates BMAD tickets to GitHub Issues and adds them to the GitHub Project board."""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "tk-reawakened/rpgtoolkit-reawakened"
PROJECT_ID = "PVT_kwDOFH0rD84Bnzfi"

STATUS_FIELD_ID = "PVTSSF_lADOFH0rD84BnzfizhmWa0w"
STATUS_OPTIONS = {
    "Draft": "21a74e34",
    "Ready for Dev": "a8cecafe",
    "In Progress": "f6c0d6d9",
    "In Review": "fb146e09",
    "Built": "bc56f2f4",
    "Blocked": "31d77a88",
    "Done": "d4a82464",
    "Dropped": "939c6cf8",
}

AREA_FIELD_ID = "PVTSSF_lADOFH0rD84BnzfizhmWbGg"
AREA_OPTIONS = {
    "core": "47bec5fd",
    "editor-ui": "ee76929a",
    "formats": "cc1b17e8",
    "synth": "f42abaa0",
    "docs": "c6cc5660",
    "tooling": "7fc398e5",
}

PRIORITY_FIELD_ID = "PVTSSF_lADOFH0rD84BnzfizhmWbKQ"
PRIORITY_OPTIONS = {
    "P0 - Blocker": "fbef9414",
    "P1 - High": "107ab450",
    "P2 - Normal": "1a5fa6f4",
    "P3 - Low": "0e66f570",
}

EPIC_AREA_MAP = {
    "epic-platform-baseline": "tooling",
    "epic-legacy-formats": "formats",
    "epic-tk2-support": "core",
    "epic-rpgcode-vm": "core",
    "epic-board-rendering": "core",
    "epic-movement-triggers": "core",
    "epic-audio-synth": "synth",
    "epic-rpgcode-first-class-functions": "core",
    "epic-rpgcode-platform": "core",
    "epic-actors": "core",
    "epic-media-objects": "synth",
    "epic-battle": "core",
    "epic-headless-sessions": "tooling",
}

EPIC_LABEL_MAP = {
    "epic-platform-baseline": "epic:platform-baseline",
    "epic-legacy-formats": "epic:legacy-formats",
    "epic-tk2-support": "epic:tk2-support",
    "epic-rpgcode-vm": "epic:rpgcode-vm",
    "epic-board-rendering": "epic:board-rendering",
    "epic-movement-triggers": "epic:movement-triggers",
    "epic-audio-synth": "epic:audio-synth",
    "epic-rpgcode-first-class-functions": "epic:first-class-functions",
    "epic-rpgcode-platform": "epic:rpgcode-platform",
    "epic-actors": "epic:actors",
    "epic-media-objects": "epic:media-objects",
    "epic-battle": "epic:battle",
}


def get_gh_token() -> str:
    res = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True)
    return res.stdout.strip()


def gh_api_request(endpoint: str, data: dict | None = None, method: str | None = None, token: str = "") -> dict:
    url = endpoint if endpoint.startswith("http") else f"https://api.github.com{endpoint}"
    payload = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=payload)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "tkr-ticket-migrator")
    if method:
        req.method = method
    elif data is not None:
        req.method = "POST"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                retry_after = int(e.headers.get("Retry-After", "10"))
                print(f"[Rate limit] HTTP {e.code}, sleeping {retry_after}s (attempt {attempt + 1})...", flush=True)
                time.sleep(retry_after)
                continue
            body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} for {url}: {body}") from e
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            wait_time = 2 * (attempt + 1)
            print(f"[Network error] {e}, retrying in {wait_time}s (attempt {attempt + 1})...", flush=True)
            time.sleep(wait_time)
            continue


def gh_graphql(query: str, variables: dict, token: str) -> dict:
    response = gh_api_request("https://api.github.com/graphql", {"query": query, "variables": variables}, token=token)
    if response.get("errors"):
        raise RuntimeError(f"GitHub GraphQL error: {response['errors']}")
    return response

def get_existing_issues(token: str) -> dict[str, dict]:
    print("Fetching existing GitHub issues...", flush=True)
    existing = {}
    page = 1
    ref_pattern = re.compile(r"^\[([0-9]+\.[0-9]+[a-z]?)\]")
    while True:
        items = gh_api_request(f"/repos/{REPO}/issues?state=all&per_page=100&page={page}", token=token)
        if not items:
            break
        for item in items:
            if "pull_request" in item:
                continue
            title = item.get("title", "")
            m = ref_pattern.match(title)
            if m:
                ref = m.group(1)
                existing[ref] = {
                    "number": item["number"],
                    "node_id": item["node_id"],
                    "state": item["state"],
                    "url": item["html_url"],
                }
        if len(items) < 100:
            break
        page += 1
    print(f"Found {len(existing)} existing tickets on GitHub.", flush=True)
    return existing


def update_entry_tracker_id(content: str, entry_id: str | int, tracker_id: str) -> str:
    pattern = rf"(\[\[entry\]\]\s*\n(?:(?!\[\[entry\]\])[\s\S])*?\bid\s*=\s*(?:{entry_id}|\"{entry_id}\")\b[\s\S]*?)(?=\n\[\[entry\]\]|\Z)"
    match = re.search(pattern, content)
    if not match:
        return content
    block = match.group(0)
    if re.search(r"\btracker_id\s*=", block):
        new_block = re.sub(r"tracker_id\s*=\s*\"[^\"]*\"", f'tracker_id = "{tracker_id}"', block)
    else:
        new_block = re.sub(rf"(\bid\s*=\s*(?:{entry_id}|\"{entry_id}\")\b)", rf'\1\ntracker_id = "{tracker_id}"', block)
    return content[: match.start()] + new_block + content[match.end() :]


def update_plan_tracker_metadata(path: Path, tracker_id: str) -> None:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, flags=re.S)
    if not match:
        raise ValueError(f"Story plan has no YAML frontmatter: {path}")
    lines = match.group(1).splitlines()
    issue_number = int(tracker_id.removeprefix("#"))
    fields = {
        "tracker_id": f'"{tracker_id}"',
        "remote": f'"https://github.com/{REPO}/issues/{issue_number}"',
    }
    for key, value in fields.items():
        replacement = f"{key}: {value}"
        for idx, line in enumerate(lines):
            if line.startswith(f"{key}:"):
                lines[idx] = replacement
                break
        else:
            lines.append(replacement)
    updated = match.group(0).replace(match.group(1), "\n".join(lines), 1) + text[match.end():]
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print actions without creating issues")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of tickets to process")
    parser.add_argument("--epic", default="", help="Only process tickets of one epic folder, e.g. epic-battle")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    token = get_gh_token()

    # Load tickets from tickets.py
    cmd = ["python3", str(root / "_bmad/method/scripts/tickets.py"), "status", str(root / "_bmad-output/initiative-rpgtoolkit-reawakened")]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    status_data = json.loads(res.stdout)
    tickets = status_data.get("tickets", [])
    print(f"Loaded {len(tickets)} tickets from initiative.", flush=True)

    if args.epic:
        tickets = [t for t in tickets if t.get("epic") == args.epic]

    if args.limit > 0:
        tickets = tickets[: args.limit]

    existing = {} if args.dry_run else get_existing_issues(token)

    created_count = 0
    updated_count = 0

    # Cache of tickets.toml files read/updated
    toml_cache: dict[Path, str] = {}

    for idx, t in enumerate(tickets, 1):
        ref = t["ref"]
        title = t["title"]
        epic = t["epic"]
        state = t["state"]
        risk = t.get("risk", "medium").lower()
        desc = t.get("description", "")
        verify = t.get("verify", "")
        refs = t.get("references", [])
        after = t.get("after", [])
        covers = t.get("covers", [])

        area = EPIC_AREA_MAP.get(epic, "core")
        epic_label = EPIC_LABEL_MAP.get(epic, f"epic:{epic.removeprefix('epic-')}")
        area_opt = AREA_OPTIONS.get(area)
        priority_val = "P1 - High" if risk == "high" else ("P3 - Low" if risk == "low" else "P2 - Normal")
        priority_opt = PRIORITY_OPTIONS.get(priority_val)

        labels = ["task", f"area:{area}", epic_label]
        if area == "core":
            labels.append("clean-room")

        issue_title = f"[{ref}] {title}"

        # Body construction
        lines = [f"## Goal & Description\n{desc}\n"]
        if verify:
            lines.append(f"## Acceptance Criteria / Verification\n{verify}\n")
        if refs or covers:
            lines.append("## References")
            for c in covers:
                lines.append(f"- Spine capability: `{c}`")
            for r in refs:
                lines.append(f"- {r}")
            lines.append("")
        if after:
            lines.append(f"## Prerequisites\n- Depends on: {', '.join(str(a) for a in after)}\n")
        lines.append("## Guard-Rails (docs/guardrails.md)")
        lines.append("- [x] **G7 Clean-Room**: Implemented from `docs/` only. No legacy GPL source consulted.")
        if area == "core":
            lines.append("- [ ] **G1 Step-Machine**: Script VM state remains plain JSON data.")
            lines.append("- [ ] **G2/G3 Core Boundaries**: `core` touches no I/O, DOM, Node, or non-deterministic APIs.")

        body = "\n".join(lines)

        issue_num = None
        issue_node_id = None

        if ref in existing:
            issue_info = existing[ref]
            issue_num = issue_info["number"]
            issue_node_id = issue_info["node_id"]
            print(f"[{idx}/{len(tickets)}] Ticket {ref} exists as #{issue_num}.", flush=True)
        elif args.dry_run:
            print(f"[DRY-RUN {idx}/{len(tickets)}] Would create issue: {issue_title} ({state}, area:{area}, priority:{priority_val})", flush=True)
            issue_num = idx + 300
        else:
            # 1. Create issue
            issue_res = gh_api_request(
                f"/repos/{REPO}/issues",
                {"title": issue_title, "body": body, "labels": labels},
                token=token,
            )
            issue_num = issue_res["number"]
            issue_node_id = issue_res["node_id"]
            created_count += 1
            print(f"[{idx}/{len(tickets)}] Created #{issue_num}: {issue_title} ({state})", flush=True)

            # 2. Close if done
            if state == "done":
                gh_api_request(
                    f"/repos/{REPO}/issues/{issue_num}",
                    {"state": "closed", "state_reason": "completed"},
                    method="PATCH",
                    token=token,
                )

            # 3. Add to project
            add_query = """
            mutation($projectId: ID!, $contentId: ID!) {
                addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
                    item { id }
                }
            }
            """
            item_res = gh_graphql(add_query, {"projectId": PROJECT_ID, "contentId": issue_node_id}, token=token)
            item_id = item_res.get("data", {}).get("addProjectV2ItemById", {}).get("item", {}).get("id")

            if item_id:
                # Update Area field
                if area_opt:
                    update_query = """
                    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optId: String!) {
                        updateProjectV2ItemFieldValue(input: {
                            projectId: $projectId,
                            itemId: $itemId,
                            fieldId: $fieldId,
                            value: { singleSelectOptionId: $optId }
                        }) { projectV2Item { id } }
                    }
                    """
                    gh_graphql(update_query, {"projectId": PROJECT_ID, "itemId": item_id, "fieldId": AREA_FIELD_ID, "optId": area_opt}, token=token)

                # Update Priority field
                if priority_opt:
                    gh_graphql(update_query, {"projectId": PROJECT_ID, "itemId": item_id, "fieldId": PRIORITY_FIELD_ID, "optId": priority_opt}, token=token)

            # Small sleep to keep well below secondary rate limits
            time.sleep(0.4)
        # Ensure existing and newly-created issues both reflect the ticket-store status.
        if issue_node_id and not args.dry_run:
            project_query = """
            mutation($projectId: ID!, $contentId: ID!) {
                addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
                    item { id }
                }
            }
            """
            item_result = gh_graphql(project_query, {"projectId": PROJECT_ID, "contentId": issue_node_id}, token=token)
            item_id = item_result.get("data", {}).get("addProjectV2ItemById", {}).get("item", {}).get("id")
            if not item_id:
                raise RuntimeError(f"Could not get Project 3 item for issue #{issue_num}")
            ticket_status = t.get("status", "").lower()
            status_name = {
                "draft": "Draft",
                "ready-for-dev": "Ready for Dev",
                "in-progress": "In Progress",
                "in-review": "In Review",
                "built": "Built",
                "blocked": "Blocked",
                "done": "Done",
                "dropped": "Dropped",
            }.get(ticket_status)
            if status_name is None:
                status_name = {"done": "Done", "dropped": "Dropped"}.get(state, "Draft")
            status_query = """
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optId: String!) {
                updateProjectV2ItemFieldValue(input: {
                    projectId: $projectId,
                    itemId: $itemId,
                    fieldId: $fieldId,
                    value: { singleSelectOptionId: $optId }
                }) { projectV2Item { id } }
            }
            """
            gh_graphql(status_query, {
                "projectId": PROJECT_ID,
                "itemId": item_id,
                "fieldId": STATUS_FIELD_ID,
                "optId": STATUS_OPTIONS[status_name],
            }, token=token)

        # Update tickets.toml with tracker_id
        if issue_num:
            epic_toml = root / f"_bmad-output/initiative-rpgtoolkit-reawakened/{epic}/tickets.toml"
            if epic_toml.is_file() and not args.dry_run:
                content = epic_toml.read_text(encoding="utf-8")
                new_content = update_entry_tracker_id(content, t["id"], f"#{issue_num}")
                if new_content != content:
                    epic_toml.write_text(new_content, encoding="utf-8")
                updated_count += 1
                plan_name = t.get("plan") or t.get("file")
                if plan_name:
                    plan_path = Path(plan_name)
                    if not plan_path.is_absolute():
                        root_candidate = root / plan_path
                        plan_path = root_candidate if root_candidate.is_file() else epic_toml.parent / plan_path
                    if plan_path.is_file():
                        update_plan_tracker_metadata(plan_path, f"#{issue_num}")

    print(f"\nDone! Created: {created_count}, Updated tracker IDs: {updated_count}", flush=True)


if __name__ == "__main__":
    main()
