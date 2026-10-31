#!/usr/bin/env python3
"""Sync every epic entry's own text into its GitHub issue body.

The store (`tickets.toml`) stays authoritative: this tool projects one entry into
one issue body and nothing else. The template is fixed and ordered, so the same
store gives byte-identical bodies and a second run patches nothing:

    ## Goal & Description      <- entry.description
    ## Acceptance Criteria     <- entry.verify
    ## Prerequisites          <- entry.after, by ref and issue link
    ## Flags                  <- type, risk, hitl, the two checkpoints
    ## References             <- entry.covers, then entry.references
    ## Guard-Rails            <- the epic's area lines

It reads the current body first and skips an issue whose body already matches, so
a re-run with no store change performs no writes and a changed entry updates only
that issue.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tomllib
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "tk-reawakened/rpgtoolkit-reawakened"
INITIATIVE = "initiative-rpgtoolkit-reawakened"

EPIC_AREA_MAP = {
    "epic-platform-baseline": "tooling",
    "epic-legacy-formats": "formats",
    "epic-tk2-support": "core",
    "epic-rpgcode-vm": "core",
    "epic-board-rendering": "core",
    "epic-movement-triggers": "core",
    "epic-audio-synth": "synth",
    "epic-rpgcode-first-class-actions": "core",
    "epic-rpgcode-first-class-functions": "core",
    "epic-rpgcode-platform": "core",
    "epic-actors": "core",
    "epic-media-objects": "synth",
    "epic-rpgcode-grammar": "tooling",
    "epic-rpgcode-tooling": "tooling",
    "epic-web-runner-packaging": "core",
    "epic-editor-foundation": "editor",
    "epic-editor-assets-p0": "editor",
    "epic-headless-sessions": "tooling",
}


def yes(value: object) -> str:
    return "yes" if value is True else "no"


def text(value: object) -> str:
    return str(value).strip() if value is not None else ""


def get_gh_token() -> str:
    return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip()


def api(url: str, token: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "tkr-body-syncer")
    req.method = method
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                time.sleep(int(error.headers.get("Retry-After", "10")))
                continue
            raise RuntimeError(f"{method} {url} failed: HTTP {error.code}: {error.read().decode('utf-8')}")
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{method} {url} failed after retries")


def index_entries(initiative: Path) -> dict[str, dict]:
    """Every entry of every epic, keyed by its cross-epic ref (`<epic id>.<entry id>`)."""
    index = tomllib.loads((initiative / "tickets.toml").read_text(encoding="utf-8"))
    by_slug = {epic["slug"]: int(epic["id"]) for epic in index.get("epic", [])}
    entries: dict[str, dict] = {}
    for slug, epic_id in by_slug.items():
        path = initiative / slug / "tickets.toml"
        if not path.is_file():
            continue
        for entry in tomllib.loads(path.read_text(encoding="utf-8")).get("entry", []):
            entries[f"{epic_id}.{entry['id']}"] = entry
    return entries


def prerequisite_line(ref: object, entries: dict[str, dict], siblings: dict[str, dict]) -> str:
    text_ref = str(ref)
    if text_ref.isdigit() and siblings.get(text_ref) is not None:
        title = text(text_ref and siblings[text_ref].get("title", ""))
        return f"- `{text_ref}` — {title}" if title else f"- `{text_ref}`"
    if text_ref.startswith("epic-"):
        return f"- `{text_ref}` — the whole epic"
    entry = entries.get(text_ref)
    if entry is None:
        return f"- `{text_ref}`"
    tracker = text(entry.get("tracker_id", ""))
    title = text(entry.get("title", ""))
    link = f"#{tracker.removeprefix('#')}" if tracker else "no issue yet"
    return f"- `{text_ref}` — {title} ({link})"


def build_body(entry: dict, area: str, entries: dict[str, dict], siblings: dict[str, dict]) -> str:
    lines: list[str] = []
    lines.append("## Goal & Description")
    lines.append("")
    lines.append(text(entry.get("description", "")) or "_Not written in the store yet._")
    lines.append("")
    lines.append("## Acceptance Criteria")
    lines.append("")
    lines.append(text(entry.get("verify", "")) or "_Not written in the store yet._")
    lines.append("")
    lines.append("## Prerequisites")
    lines.append("")
    after = [str(item) for item in entry.get("after", [])]
    if after:
        lines.extend(prerequisite_line(item, entries, siblings) for item in after)
    else:
        lines.append("- None.")
    lines.append("")
    lines.append("## Flags")
    lines.append("")
    lines.append(f"- type: `{text(entry.get('type', 'story'))}`")
    lines.append(f"- risk: `{text(entry.get('risk', 'medium'))}`")
    lines.append(f"- hitl: {yes(entry.get('hitl'))}")
    lines.append(f"- plan checkpoint: {yes(entry.get('plan_checkpoint'))}")
    lines.append(f"- done checkpoint: {yes(entry.get('done_checkpoint'))}")
    lines.append("")
    lines.append("## References")
    lines.append("")
    for cover in entry.get("covers", []):
        lines.append(f"- Spine capability: `{cover}`")
    for reference in entry.get("references", []):
        lines.append(f"- {reference}")
    lines.append("")
    lines.append("## Guard-Rails (docs/guardrails.md)")
    lines.append("")
    lines.append("- [x] **G7 Clean-Room**: Implemented from `docs/` only. No legacy GPL source consulted.")
    if area == "core":
        lines.append("- [ ] **G1 Step-Machine**: Script VM state remains plain JSON data.")
        lines.append("- [ ] **G2/G3 Core Boundaries**: `core` touches no I/O, DOM, Node, or non-deterministic APIs.")
    elif area == "tooling":
        lines.append("- [ ] **G2 Package Boundaries**: dependency direction `core <- synth <- runners/lsp/dap <- host-*` holds.")
        lines.append("- [ ] **G5 Goldens**: goldens change only deliberately, with the reason stated.")
    elif area == "editor":
        lines.append("- [ ] **G2 Editor Boundary**: `editor-ui` reaches the host only through platform-services.")
    else:
        lines.append("- [ ] **G6 Licence Gate**: every shipped dependency stays Bronze or better.")
    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epic", action="append", default=[], help="Epic folder slug to sync; repeatable; default all")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without patching")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    initiative = root / "_bmad-output" / INITIATIVE
    entries = index_entries(initiative)
    token = "" if args.dry_run else get_gh_token()

    epics = [initiative / slug for slug in args.epic] if args.epic else sorted(
        path for path in initiative.iterdir() if path.is_dir() and (path / "tickets.toml").is_file()
    )

    total = changed = same = skipped = 0
    for epic_dir in epics:
        if not (epic_dir / "tickets.toml").is_file():
            raise SystemExit(f"No tickets.toml in {epic_dir}")
        area = EPIC_AREA_MAP.get(epic_dir.name, "core")
        entries_of_epic = tomllib.loads((epic_dir / "tickets.toml").read_text(encoding="utf-8")).get("entry", [])
        siblings = {str(item["id"]): item for item in entries_of_epic}
        for entry in entries_of_epic:
            tracker = text(entry.get("tracker_id", ""))
            if not tracker.startswith("#"):
                skipped += 1
                continue
            total += 1
            number = int(tracker.removeprefix("#"))
            body = build_body(entry, area, entries, siblings)
            if args.dry_run:
                print(f"--- {epic_dir.name} {entry['id']} -> #{number}")
                print(body)
                continue
            current = api(f"https://api.github.com/repos/{REPO}/issues/{number}", token)
            if (current.get("body") or "") == body:
                same += 1
                continue
            api(f"https://api.github.com/repos/{REPO}/issues/{number}", token, method="PATCH", payload={"body": body})
            changed += 1
            time.sleep(0.3)

    if not args.dry_run:
        print(f"issues with a tracker_id: {total}; updated: {changed}; already identical: {same}; skipped (no issue): {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
