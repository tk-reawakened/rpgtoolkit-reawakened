"""The ticket-store contract this project relies on: the stock resolver as installed, plus the project's issue preflight.

The resolver is the stock `bmad-ticket` script that `bmad setup` writes to `_bmad/method/scripts/tickets.py`. The project does not
patch it, so what it cannot do is covered by the preflight (`.agents/skills/tkr-issue-preflight`), and these tests check both
sides of that line:

* Stock reads entries of type story, spike and bug only. `chore` is not an entry type; a chore is a story or a bug whose plan
  says so. A plan is a file with a `ticket` key whose `type` is not story, spike or bug (feature, bugfix, chore, ...); a plan
  typed as a leaf is read as a leaf and joins nothing, which is why such plans were retyped.
* Stock never carries the `tracker_id` of a `tickets.toml` entry onto its rows, so it cannot see two tickets sharing one there.
  The preflight reads every carrier and fails closed on duplicates, on an unknown number and on a malformed store.

Tests that pin a limit of stock say so; if stock grows the behaviour, they fail and the preflight's matching guard is the thing
to revisit, not the test to delete.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "_bmad" / "method" / "scripts" / "tickets.py"
PREFLIGHT = ROOT / ".agents" / "skills" / "tkr-issue-preflight" / "scripts" / "resolve_issue.py"

LEAF_PLAN_NAME = "story-ci-change-classifier-plan.md"
LEAF_NAME = "story-ci-change-classifier.md"


class StoreCase(unittest.TestCase):
    """A one-epic ticket store in a temporary folder, and the stock resolver pointed at it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.store = self.base / "store"
        self.epic = self.store / "epic-packaging"
        self.epic.mkdir(parents=True)
        (self.epic / "epic-packaging.md").write_text("---\ntype: epic\n---\n# Packaging\n", encoding="utf-8")
        self.write_entry("story")

    def tearDown(self):
        self.tmp.cleanup()

    def write_entry(self, kind, tracker_id=None):
        tracker = f'tracker_id = "{tracker_id}"\n' if tracker_id else ""
        (self.epic / "tickets.toml").write_text(
            f'[[entry]]\nid = 23\ntype = "{kind}"\ntitle = "CI change classifier"\n{tracker}', encoding="utf-8"
        )

    def write_leaf(self, tracker_id=None, name=LEAF_NAME, ticket_id=23, kind="story", title="CI change classifier"):
        tracker = f"tracker_id: '{tracker_id}'\n" if tracker_id else ""
        path = self.epic / name
        path.write_text(f"---\nid: {ticket_id}\ntype: {kind}\ntitle: {title}\n{tracker}---\n# {title}\n", encoding="utf-8")
        return path

    def write_plan(self, plan_type, name=LEAF_PLAN_NAME, status="in-progress"):
        path = self.epic / name
        path.write_text(
            f"---\ntitle: 'CI classifier plan'\ntype: '{plan_type}'\nticket: 23\ncreated: '2026-10-29'\nstatus: '{status}'\n---\n# Plan\n",
            encoding="utf-8",
        )
        return path

    def run_ticket(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], check=False, capture_output=True, encoding="utf-8")

    def find(self, ref="23"):
        found = self.run_ticket("find", str(self.epic), ref)
        self.assertEqual(found.returncode, 0, found.stderr)
        return json.loads(found.stdout)

    def status_rows(self):
        status = self.run_ticket("status", str(self.epic))
        self.assertEqual(status.returncode, 0, status.stderr)
        return json.loads(status.stdout)["tickets"]


class StockResolverContractTests(StoreCase):
    def assert_story_in_status_and_next(self, expected_state):
        rows = [row for row in self.status_rows() if row["ref"] == "23"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["type"], "story")
        self.assertEqual(rows[0]["state"], expected_state)

        next_result = self.run_ticket("next", str(self.epic))
        self.assertEqual(next_result.returncode, 0, next_result.stderr)
        next_payload = json.loads(next_result.stdout)
        next_rows = [
            row
            for group in ("ready_to_refine", "ready_to_start", "in_progress", "blocked")
            for row in next_payload.get(group, [])
            if row["ref"] == "23"
        ]
        self.assertEqual(len(next_rows), 1)
        self.assertEqual(next_rows[0]["type"], "story")
        self.assertEqual(next_rows[0]["state"], expected_state)

    def test_find_pull_and_plan_join_for_story_entry(self):
        row = self.find()
        self.assertEqual(row["type"], "story")
        self.assertIsNone(row["story_file"])
        self.assertEqual(Path(row["plan"]).name, LEAF_PLAN_NAME)
        self.assert_story_in_status_and_next("planned")

        pulled = self.run_ticket("pull", str(self.epic), "23")
        self.assertEqual(pulled.returncode, 0, pulled.stderr)
        leaf = self.epic / LEAF_NAME
        self.assertTrue(leaf.is_file())
        self.assertEqual(Path(self.find()["story_file"]).resolve(), leaf.resolve())

        plan = self.write_plan("feature")
        row = self.find()
        self.assertEqual(Path(row["plan"]).resolve(), plan.resolve())
        self.assertEqual(row["status"], "in-progress")
        self.assert_story_in_status_and_next("in-progress")

    def test_plans_with_a_non_leaf_type_join_their_entry(self):
        """The historical plan types join, so a former chore plan (type chore) is still a plan, not a row of its own."""
        for plan_type in ("feature", "bugfix", "chore"):
            with self.subTest(plan_type=plan_type):
                plan = self.write_plan(plan_type, status="blocked")
                row = self.find()
                self.assertEqual(Path(row["plan"]).resolve(), plan.resolve())
                self.assertEqual(row["status"], "blocked")
                rows = self.status_rows()
                self.assertEqual([r["ref"] for r in rows], ["23"])
                self.assertEqual(rows[0]["state"], "in-progress")

    def test_leaf_typed_plan_does_not_join_its_entry(self):
        """Limit of stock: a plan typed story, spike or bug is read as a leaf file. It joins nothing, the entry stays
        planned and the plan becomes a row of its own. Plans must use a non-leaf type (see the test above)."""
        self.write_entry("bug")
        plan = self.write_plan("bug", name="bug-ci-change-classifier-plan.md", status="blocked")
        rows = self.status_rows()
        entry_rows = [r for r in rows if r["ref"] == "23"]
        self.assertEqual(len(entry_rows), 1)
        self.assertEqual(entry_rows[0]["state"], "planned")
        self.assertIn(plan.name, [r["file"] for r in rows])

    def test_legacy_story_leaf_with_ticket_field_remains_a_leaf(self):
        leaf = self.epic / LEAF_NAME
        leaf.write_text(
            "---\nid: 23\ntype: story\nticket: 'legacy metadata'\ntitle: 'CI change classifier'\n---\n# Story\n",
            encoding="utf-8",
        )
        row = self.find()
        self.assertEqual(row["type"], "story")
        self.assertEqual(Path(row["story_file"]).resolve(), leaf.resolve())

    def test_story_leaf_and_non_leaf_plan_share_one_row(self):
        self.write_leaf()
        plan = self.write_plan("feature")
        rows = self.status_rows()
        self.assertEqual([r["ref"] for r in rows], ["23"])
        self.assertEqual(rows[0]["state"], "in-progress")
        self.assertEqual(Path(self.find()["plan"]).resolve(), plan.resolve())

    def test_duplicate_tracker_ids_on_leaf_files_still_fail(self):
        (self.epic / "tickets.toml").write_text(
            '[[entry]]\nid = 23\ntype = "story"\ntitle = "First"\n[[entry]]\nid = 24\ntype = "story"\ntitle = "Second"\n',
            encoding="utf-8",
        )
        self.write_leaf(tracker_id="#1045", name="story-first.md", ticket_id=23, title="First")
        self.write_leaf(tracker_id="#1045", name="story-second.md", ticket_id=24, title="Second")
        result = self.run_ticket("status", str(self.epic))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracker_id", result.stderr)
        self.assertIn("more than one ticket", result.stderr)

    def test_unknown_entry_types_are_rejected_and_chore_is_not_an_entry_type(self):
        for kind in ("task", "chore"):
            with self.subTest(kind=kind):
                self.write_entry(kind)
                result = self.run_ticket("find", str(self.epic), "23")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"type {kind!r} is not one of story, spike, bug", result.stderr)


class PreflightContractTests(StoreCase):
    """The project's `tkr-issue-preflight`, run as the skill runs it, with the stock resolver cross-check."""

    def setUp(self):
        super().setUp()
        self.project = self.base / "project"
        scripts = self.project / "_bmad" / "method" / "scripts"
        scripts.mkdir(parents=True)
        shutil.copy(SCRIPT, scripts / "tickets.py")

    def preflight(self, issue="#1045", check_stock=True):
        args = [sys.executable, str(PREFLIGHT), issue, "--project-root", str(self.project), "--store", str(self.store)]
        if check_stock:
            args.append("--check-stock")
        run = subprocess.run(args, check=False, capture_output=True, encoding="utf-8")
        try:
            payload = json.loads(run.stdout)
        except ValueError:
            self.fail(f"preflight printed no JSON (exit {run.returncode}): {run.stdout!r} {run.stderr!r}")
        return run.returncode, payload

    def carried_story(self):
        """Entry, leaf file and plan all say #1045: the shape both the preflight and stock can read."""
        self.write_entry("story", tracker_id="#1045")
        return self.write_leaf(tracker_id="#1045")

    def test_resolves_the_issue_to_its_ticket_and_plan_and_stock_agrees(self):
        self.carried_story()
        plan = self.write_plan("feature")
        code, result = self.preflight()
        self.assertEqual(code, 0, result)
        self.assertTrue(result["ok"])
        self.assertEqual(result["key"], "epic-packaging/23")
        self.assertEqual(result["kind"], "story")
        self.assertTrue(result["buildable"])
        self.assertTrue(result["plan"]["exists"])
        self.assertEqual(result["plan"]["status"], "in-progress")
        self.assertEqual(Path(result["plan"]["path"]).resolve(), plan.resolve())
        self.assertTrue(result["stock_check"]["agrees"])
        self.assertIsNone(result["handoff"]["bmad_build_input"])
        self.assertEqual(result["handoff"]["scoped"]["ref"], "23")
        self.assertEqual(Path(result["handoff"]["scoped"]["dir"]).resolve(), self.epic.resolve())

    def test_a_ticket_with_no_plan_names_the_path_where_one_starts(self):
        self.carried_story()
        code, result = self.preflight()
        self.assertEqual(code, 0, result)
        self.assertFalse(result["plan"]["exists"])
        self.assertEqual(Path(result["plan"]["path"]).name, LEAF_PLAN_NAME)
        self.assertTrue(result["stock_check"]["agrees"])

    def test_former_chore_plan_types_still_join(self):
        self.carried_story()
        for plan_type in ("feature", "bugfix", "chore"):
            with self.subTest(plan_type=plan_type):
                plan = self.write_plan(plan_type)
                code, result = self.preflight()
                self.assertEqual(code, 0, result)
                self.assertTrue(result["plan"]["exists"])
                self.assertEqual(Path(result["plan"]["path"]).resolve(), plan.resolve())

    def test_duplicate_tracker_id_across_entry_and_leaf_fails_closed(self):
        """The shape the retired patch used to catch: one number on an entry and on another ticket's leaf file."""
        (self.epic / "tickets.toml").write_text(
            '[[entry]]\nid = 23\ntype = "story"\ntitle = "First"\ntracker_id = "#1045"\n'
            '[[entry]]\nid = 24\ntype = "story"\ntitle = "Second"\n',
            encoding="utf-8",
        )
        self.write_leaf(tracker_id="#1045", name="story-second.md", ticket_id=24, title="Second")

        code, result = self.preflight(check_stock=False)
        self.assertEqual(code, 1, result)
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "duplicate_tracker_id")

        # Limit of stock, pinned: it does not read the entry's tracker_id, so it accepts this store. Only the preflight
        # stands between a duplicate like this and a build under the wrong ticket.
        self.assertEqual(self.run_ticket("status", str(self.epic)).returncode, 0)

    def test_entry_tracker_id_without_a_leaf_file_is_invisible_to_stock(self):
        self.write_entry("story", tracker_id="#1045")
        code, result = self.preflight(check_stock=False)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["key"], "epic-packaging/23")

        code, result = self.preflight(check_stock=True)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["issue"], "#1045")
        self.assertIsNone(result["stock_check"]["stock_tracker_id"])

    def test_an_issue_no_ticket_carries_is_not_found(self):
        self.carried_story()
        code, result = self.preflight("#999")
        self.assertEqual(code, 1, result)
        self.assertEqual(result["code"], "not_found")

    def test_unknown_entry_types_are_malformed_and_chore_is_not_an_entry_type(self):
        for kind in ("task", "chore"):
            with self.subTest(kind=kind):
                self.write_entry(kind, tracker_id="#1045")
                code, result = self.preflight(check_stock=False)
                self.assertEqual(code, 1, result)
                self.assertEqual(result["code"], "malformed_store")
                self.assertIn(f"type {kind!r} is not one of story, spike, bug", result["error"])


if __name__ == "__main__":
    unittest.main()
