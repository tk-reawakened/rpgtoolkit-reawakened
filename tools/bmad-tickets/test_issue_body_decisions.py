"""Ticket publication preserves decision gates without claiming work has already happened."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load("body_sync", "tools/sync-issue-bodies.py")
migrate = load("ticket_migration", "tools/migrate-tickets-to-github.py")


class IssueBodyDecisionsTests(unittest.TestCase):
    def test_sync_retains_unknown_and_plan_blocker_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initiative = root / "_bmad-output" / sync.INITIATIVE
            epic = initiative / "epic-example"
            epic.mkdir(parents=True)
            (initiative / "tickets.toml").write_text('[[epic]]\nid = 1\nslug = "epic-example"\n', encoding="utf-8")
            (epic / "tickets.toml").write_text(
                '[[entry]]\nid = "01"\ntracker_id = "#301"\nunknown = "Which format?"\n'
                '[[entry]]\nid = 2\ntracker_id = "#302"\n', encoding="utf-8",
            )
            rows = {("epic-example", "1"): {"status": "blocked", "blocked_at": "plan", "blocked_reason": "Owner decision needed"},
                    ("epic-example", "2"): {"blocked_at": "", "blocked_reason": ""}}
            bodies = {301: "old", 302: "old"}
            writes = []

            def api(url, token, method="GET", payload=None):
                number = int(url.rsplit("/", 1)[1])
                if method == "PATCH":
                    bodies[number] = payload["body"]
                    writes.append(number)
                return {"body": bodies[number]}

            with (
                patch.object(sync, "__file__", str(root / "tools" / "sync-issue-bodies.py")),
                patch.object(sync, "store_rows", return_value=rows),
                patch.object(sync, "get_gh_token", return_value="test"),
                patch.object(sync, "api", side_effect=api),
                patch.object(sync.time, "sleep"),
                patch.object(sys, "argv", ["sync-issue-bodies.py"]),
            ):
                self.assertEqual(sync.main(), 0)
                self.assertEqual(sync.main(), 0)
            self.assertEqual(writes, [301, 302])
            self.assertIn("Which format?", bodies[301])
            self.assertIn("Status: blocked", bodies[301])
            self.assertIn("Blocked at: plan", bodies[301])
            self.assertIn("Owner decision needed", bodies[301])
            self.assertNotIn("## Decisions and blockers", bodies[302])
            for body in bodies.values():
                self.assertIn("- [ ] **G7 Clean-Room**: Implement from", body)
                self.assertNotIn("Implemented from `docs/` only", body)

    def test_migration_publishes_unknown_and_blocker_without_claiming_implementation(self):
        tickets = [
            {"id": 1, "ref": "1.1", "title": "Planned", "epic": "epic-example", "state": "backlog",
             "status": "blocked", "unknown": "Which format?", "blocked_at": "plan", "blocked_reason": "Owner decision needed"},
            {"id": 2, "ref": "1.2", "title": "Complete", "epic": "epic-example", "state": "done"},
        ]
        published = []

        def request(endpoint, payload, **kwargs):
            if endpoint.endswith("/issues"):
                published.append(payload["body"])
                return {"number": 300 + len(published), "node_id": f"node-{len(published)}"}
            return {}

        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(migrate, "__file__", str(Path(tmp) / "tools" / "migrate-tickets-to-github.py")),
            patch.object(migrate, "get_gh_token", return_value="test"),
            patch.object(migrate, "get_existing_issues", return_value={}),
            patch.object(migrate.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps({"tickets": tickets}))),
            patch.object(migrate, "gh_api_request", side_effect=request),
            patch.object(migrate, "gh_graphql", return_value={"data": {"addProjectV2ItemById": {"item": {"id": "item"}}}}),
            patch.object(migrate.time, "sleep"),
            patch.object(sys, "argv", ["migrate-tickets-to-github.py"]),
        ):
            migrate.main()
        self.assertEqual(len(published), 2)
        self.assertIn("Which format?", published[0])
        self.assertIn("Status: blocked", published[0])
        self.assertIn("Blocked at: plan", published[0])
        self.assertIn("Owner decision needed", published[0])
        self.assertNotIn("## Decisions and blockers", published[1])
        for body in published:
            self.assertIn("- [ ] **G7 Clean-Room**: Implement from", body)
            self.assertNotIn("Implemented from `docs/` only", body)


if __name__ == "__main__":
    unittest.main()
