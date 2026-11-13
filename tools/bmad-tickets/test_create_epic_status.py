"""The Project status the epic mirror writes for a story comes from the store's row, matched the way the store matches ids.

The store reads the entry ids `1`, `"1"` and `"01"` as one id (`_id` in `_bmad/method/scripts/tickets.py`). A lookup on the raw
TOML value misses the row of an entry written `id = "01"`, and the mirror then writes the breakdown's own status
(draft by default) over a done ticket (#2259). The mirror is `tools/create-epic-on-github.py`; it has a hyphenated name, so
the tests load it by path. Nothing here touches GitHub.
"""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "_bmad" / "method" / "scripts" / "tickets.py"
MIRROR_PATH = ROOT / "tools" / "create-epic-on-github.py"

spec = importlib.util.spec_from_file_location("create_epic_on_github", MIRROR_PATH)
mirror = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(mirror)

SLUG = "epic-example"


def row(ref_id, state="done", status="done", epic=SLUG):
    return {"epic": epic, "id": ref_id, "state": state, "status": status}


class CanonicalIdTests(unittest.TestCase):
    def test_numbers_and_digit_text_are_one_id(self):
        for value in (1, "1", "01", "001"):
            with self.subTest(value=value):
                self.assertEqual(mirror.canonical_id(value), 1)

    def test_ids_with_letters_stay_text(self):
        self.assertEqual(mirror.canonical_id("6a"), "6a")
        self.assertEqual(mirror.canonical_id("06a"), "06a")

    def test_values_that_are_not_ids_are_none(self):
        for value in (None, True, False, "", "a b", "1.2", "-1", "true", "false", 1.5, [1]):
            with self.subTest(value=value):
                self.assertIsNone(mirror.canonical_id(value))

    def test_matches_the_resolver_on_the_ids_it_reports(self):
        """The mirror's reading of an entry id equals the id on the row the resolver reports for that entry."""
        with tempfile.TemporaryDirectory() as tmp:
            epic = Path(tmp) / SLUG
            epic.mkdir()
            (epic / f"{SLUG}.md").write_text("---\ntype: epic\n---\n# Example\n", encoding="utf-8")
            (epic / "tickets.toml").write_text(
                '[[entry]]\nid = "01"\ntype = "story"\ntitle = "Zero one"\n'
                '[[entry]]\nid = "6a"\ntype = "story"\ntitle = "Six a"\n'
                '[[entry]]\nid = 3\ntype = "story"\ntitle = "Three"\n',
                encoding="utf-8",
            )
            run = subprocess.run(
                [sys.executable, str(RESOLVER), "status", str(epic)], check=False, capture_output=True, encoding="utf-8"
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            reported = {t["title"]: t["id"] for t in json.loads(run.stdout)["tickets"]}
        self.assertEqual(reported, {"Zero one": 1, "Six a": "6a", "Three": 3})
        for raw, canonical in (("01", 1), ("6a", "6a"), (3, 3)):
            self.assertEqual(mirror.canonical_id(raw), canonical)


class RowsByEntryIdTests(unittest.TestCase):
    def test_keeps_only_the_epics_rows_with_usable_ids(self):
        view = {
            "tickets": [
                row(1),
                row("6a"),
                row(2, epic="epic-other"),
                row(None),
                row("story-loose-leaf.md"),
            ]
        }
        self.assertEqual(set(mirror.rows_by_entry_id(view, SLUG)), {1, "6a"})

    def test_an_empty_view_has_no_rows(self):
        self.assertEqual(mirror.rows_by_entry_id({}, SLUG), {})


class StoryStatusTests(unittest.TestCase):
    def rows(self, **overrides):
        return mirror.rows_by_entry_id({"tickets": [row(1, **overrides)]}, SLUG)

    def test_zero_padded_toml_id_finds_the_done_row_not_the_draft_fallback(self):
        for toml_id in (1, "1", "01"):
            with self.subTest(toml_id=toml_id):
                self.assertEqual(mirror.story_status(toml_id, "draft", self.rows()), "done")

    def test_the_stores_status_wins_over_the_entrys_own(self):
        rows = self.rows(state="in-progress", status="in-progress")
        self.assertEqual(mirror.story_status("01", "draft", rows), "in-progress")

    def test_state_is_used_when_the_row_status_is_not_a_project_option(self):
        rows = self.rows(state="review", status="")
        self.assertEqual(mirror.story_status("01", "draft", rows), "in-review")

    def test_an_entry_the_store_does_not_report_keeps_the_fallback(self):
        rows = self.rows()
        self.assertEqual(mirror.story_status(2, "ready-for-dev", rows), "ready-for-dev")
        self.assertEqual(mirror.story_status("02", "ready-for-dev", rows), "ready-for-dev")

    def test_an_unknown_fallback_with_no_row_writes_nothing(self):
        self.assertIsNone(mirror.story_status(2, "backlog", self.rows()))

    def test_another_epics_row_with_the_same_id_is_not_used(self):
        rows = mirror.rows_by_entry_id({"tickets": [row(1, epic="epic-other")]}, SLUG)
        self.assertEqual(mirror.story_status("01", "draft", rows), "draft")


if __name__ == "__main__":
    unittest.main()
