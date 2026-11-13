import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "resolve_issue.py"
SKILL_MD = Path(__file__).resolve().parents[2] / "SKILL.md"
sys.path.insert(0, str(SCRIPT.parent))
import resolve_issue  # noqa: E402
REPO_ROOT = Path(__file__).resolve().parents[5]  # .agents/skills/<skill>/scripts/tests -> repository root
REPO = "owner/name"
INIT = "initiative-x"


def md(**keys):
    lines = ["---", *(f"{k}: {v}" for k, v in keys.items()), "---", "", "# body", ""]
    return "\n".join(lines)


def toml_entries(*entries):
    """entries are (id, tracker_id or None, type, title)."""
    out = ["next_id = 20", ""]
    for n, tracker, kind, title in entries:
        out += ["[[entry]]", f"id = {n}"]
        if tracker is not None:
            out.append(f'tracker_id = "{tracker}"')
        out += [f'type = "{kind}"', f'title = "{title}"', ""]
    return "\n".join(out)


class Fixture:
    """A ticket store in a temp directory; `project=True` also installs the BMad files stock tickets.py needs."""

    def __init__(self, case: unittest.TestCase, project: bool = False, active: str | None = INIT, subdir: str = ""):
        top = Path(tempfile.mkdtemp())
        case.addCleanup(shutil.rmtree, top, True)
        self.root = top / subdir if subdir else top  # a project root may hold spaces and shell characters
        self.root.mkdir(exist_ok=True)
        self.store = self.root / "_bmad-output"
        self.store.mkdir()
        self.project = project
        if project:
            for rel in ("_bmad/scripts/config_utils.py", "_bmad/method/scripts/tickets.py"):
                dest = self.root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(REPO_ROOT / rel, dest)
            self.write_at(
                "_bmad/config.toml",
                '[core]\noutput_folder = "{project-root}/_bmad-output"\n'
                + (f'active_initiative = "{active}"\n' if active else ""),
            )
            self.write_at("_bmad/custom/ticketing-store-config.toml", f'[tickets]\nrepo = "{REPO}"\n')

    def write_at(self, rel: str, text: str) -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def write(self, rel: str, text: str) -> Path:
        return self.write_at(f"_bmad-output/{rel}", text)

    def layout(self) -> "Fixture":
        """An initiative with two epics. epic-a (id 2) holds entry 3 (#101, story) and 4 (#102, bug); epic-b (id 3)
        holds entry 1 (#201)."""
        self.write(f"{INIT}/{INIT}.md", md(type="initiative", title='"X"', tracker_id='"#1"'))
        self.write(
            f"{INIT}/tickets.toml",
            "\n".join(
                [
                    "[[epic]]",
                    "id = 2",
                    'tracker_id = "#10"',
                    'slug = "epic-a"',
                    'title = "Epic A"',
                    "",
                    "[[epic]]",
                    "id = 3",
                    'tracker_id = "#11"',
                    'slug = "epic-b"',
                    'title = "Epic B"',
                    "",
                ]
            ),
        )
        self.write(f"{INIT}/epic-a/epic-a.md", md(type="epic", title='"Epic A"', tracker_id='"#10"'))
        self.write(
            f"{INIT}/epic-a/tickets.toml",
            toml_entries((3, "#101", "story", "Add widget"), (4, "#102", "bug", "Fix gadget")),
        )
        self.write(f"{INIT}/epic-b/epic-b.md", md(type="epic", title='"Epic B"', tracker_id='"#11"'))
        self.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#201", "story", "Other thing")))
        return self

    def run(self, ref: str, *extra: str):
        args = [sys.executable, str(SCRIPT), ref]
        args += ["--project-root", str(self.root)] if self.project else ["--store", str(self.store), "--repo", REPO]
        proc = subprocess.run([*args, *extra], capture_output=True, text=True, check=False)
        return proc.returncode, json.loads(proc.stdout), proc.stderr

    def validate(self, *extra: str):
        """The standalone whole-store check: (exit code, JSON or None, stderr)."""
        args = [sys.executable, str(SCRIPT), "--validate-store"]
        args += ["--project-root", str(self.root)] if self.project else ["--store", str(self.store), "--repo", REPO]
        proc = subprocess.run([*args, *extra], capture_output=True, text=True, check=False)
        return proc.returncode, (json.loads(proc.stdout) if proc.stdout.strip() else None), proc.stderr

    def snapshot(self) -> dict:
        return {str(p): p.read_bytes() for p in sorted(self.root.rglob("*")) if p.is_file()}


class HappyPathTests(unittest.TestCase):
    def test_entry_resolves_to_a_canonical_key_a_stock_ref_and_the_expected_plan_path(self):
        fx = Fixture(self).layout()
        code, out, _ = fx.run("#101")
        self.assertEqual(code, 0)
        self.assertEqual((out["layer"], out["kind"], out["buildable"]), ("leaf", "story", True))
        self.assertEqual((out["key"], out["epic"], out["epic_id"], out["entry_id"]), ("epic-a/3", "epic-a", 2, 3))
        self.assertEqual(out["stock"]["ref"], "2.3")
        self.assertEqual(Path(out["stock"]["dir"]).name, INIT)
        self.assertIsNone(out["leaf_file"])
        self.assertFalse(out["plan"]["exists"])
        self.assertEqual(Path(out["plan"]["path"]).name, "story-add-widget-plan.md")
        self.assertEqual(Path(out["plan"]["path"]).parent.name, "epic-a")

    def test_number_url_and_hash_forms_name_the_same_ticket(self):
        fx = Fixture(self).layout()
        answers = [fx.run(ref)[1]["key"] for ref in ("#101", "101", f"https://github.com/{REPO}/issues/101")]
        self.assertEqual(answers, ["epic-a/3"] * 3)

    def test_second_entry_in_the_same_epic_is_not_confused_with_the_first(self):
        _, out, _ = Fixture(self).layout().run("#102")
        self.assertEqual((out["key"], out["kind"], out["stock"]["ref"]), ("epic-a/4", "bug", "2.4"))

    def test_pulled_leaf_and_its_entry_are_one_ticket_and_the_file_names_the_plan(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-v2.md", md(id=3, type="story", title='"Add widget"', tracker_id='"#101"'))
        code, out, _ = fx.run("#101")
        self.assertEqual(code, 0)
        self.assertEqual(sorted(c["form"] for c in out["carriers"]), ["entry", "leaf-file"])
        self.assertTrue(out["leaf_file"].endswith("story-add-widget-v2.md"))
        self.assertEqual(Path(out["plan"]["path"]).name, "story-add-widget-v2-plan.md")

    def test_a_tracker_id_only_on_the_leaf_file_still_resolves(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/tickets.toml", toml_entries((3, None, "story", "Add widget")))
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", tracker_id="'#150'"))
        code, out, _ = fx.run("150")
        self.assertEqual((code, out["key"]), (0, "epic-a/3"))
        self.assertEqual(sorted(c["form"] for c in out["carriers"]), ["entry", "leaf-file"])
        self.assertEqual(out["stock"]["ref"], "2.3")

    def test_existing_plan_with_a_historical_type_joins_by_entry_id(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="'3'", status="in-progress"))
        _, out, _ = fx.run("#101")
        self.assertTrue(out["plan"]["exists"])
        self.assertEqual(out["plan"]["status"], "in-progress")
        self.assertTrue(out["plan"]["path"].endswith("epic-a/story-add-widget-plan.md"))

    def test_a_plan_mistyped_as_a_story_is_a_plan_and_not_a_second_leaf(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="story", ticket="3", status="done"))
        code, out, _ = fx.run("#101")
        self.assertEqual(code, 0)
        self.assertIsNone(out["leaf_file"])
        self.assertTrue(out["plan"]["exists"])

    def test_leaf_file_not_in_the_breakdown_resolves_by_its_id(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-late-addition.md", md(id=7, type="story", title='"Late"', tracker_id='"#103"'))
        _, out, _ = fx.run("#103")
        self.assertEqual((out["key"], out["stock"]["ref"]), ("epic-a/7", "2.7"))
        self.assertEqual(Path(out["plan"]["path"]).name, "story-late-addition-plan.md")

    def test_backlog_leaf_resolves_by_file_name_and_a_stem_plan(self):
        fx = Fixture(self).layout()
        fx.write("backlog/bug-flaky.md", md(type="bug", title='"Flaky"', tracker_id='"#300"'))
        fx.write("backlog/bug-flaky-plan.md", md(type="bugfix", ticket="bug-flaky", status="built"))
        _, out, _ = fx.run("#300")
        self.assertEqual((out["layer"], out["key"], out["stock"]["ref"]), ("leaf", "backlog/bug-flaky.md", "bug-flaky.md"))
        self.assertEqual(Path(out["stock"]["dir"]).name, "backlog")
        self.assertIsNone(out["epic_id"])
        self.assertEqual((out["plan"]["exists"], out["plan"]["status"]), (True, "built"))

    def test_plan_outside_the_ticket_folder_joins_only_by_the_issue_number(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/plan-gh-101-widget.md", md(type="feature", ticket="'#101'", status="draft"))
        _, out, _ = fx.run("#101")
        self.assertTrue(out["plan"]["exists"])
        self.assertTrue(out["plan"]["path"].endswith(f"{INIT}/plan-gh-101-widget.md"))
        self.assertEqual(out["plan"]["joined_by"], "ticket: #101")

    def test_a_plan_naming_a_ticket_in_another_epic_is_not_this_tickets_plan(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/story-other-thing-plan.md", md(type="feature", ticket="1", status="done"))
        _, out, _ = fx.run("#101")
        self.assertFalse(out["plan"]["exists"])

    def test_epic_with_rows_and_file_resolves_as_a_container_with_children(self):
        _, out, _ = Fixture(self).layout().run("#10")
        self.assertEqual((out["layer"], out["buildable"], out["epic_id"]), ("epic", False, 2))
        self.assertIsNone(out["stock"])
        self.assertEqual(sorted(c["tracker_id"] for c in out["children"]), [101, 102])
        self.assertEqual(sorted(c["form"] for c in out["carriers"]), ["epic-file", "epic-row"])

    def test_envelope_epic_with_no_breakdown_and_no_row_resolves(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-c/epic-c.md", md(type="epic", title='"Envelope"', tracker_id='"#12"'))
        code, out, _ = fx.run("#12")
        self.assertEqual((code, out["layer"], out["children"]), (0, "epic", []))

    def test_epic_row_without_a_folder_resolves(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/tickets.toml",
            (fx.store / INIT / "tickets.toml").read_text()
            + '\n[[epic]]\nid = 9\ntracker_id = "#13"\nslug = "epic-future"\ntitle = "Future"\n',
        )
        code, out, _ = fx.run("#13")
        self.assertEqual((code, out["layer"], out["epic"], out["epic_id"]), (0, "epic", "epic-future", 9))

    def test_initiative_resolves_and_lists_its_epics(self):
        _, out, _ = Fixture(self).layout().run("#1")
        self.assertEqual((out["layer"], out["buildable"]), ("initiative", False))
        self.assertEqual(sorted(c["tracker_id"] for c in out["children"]), [10, 11])

    def test_a_remote_in_the_right_repository_and_case_passes(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/epic-a/story-add-widget.md",
            md(id=3, type="story", tracker_id='"#101"', remote=f'"https://github.com/{REPO.upper()}/issues/101"'),
        )
        self.assertEqual(fx.run("#101")[0], 0)

    def test_epic_children_take_the_tracker_id_a_pulled_leaf_carries(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/tickets.toml", toml_entries((3, None, "story", "Add widget"), (4, "#102", "bug", "Fix gadget")))
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", title='"Add widget"', tracker_id='"#150"'))
        _, out, _ = fx.run("#10")
        children = {c["entry_id"]: c for c in out["children"]}
        self.assertEqual(children[3]["tracker_id"], 150)
        self.assertEqual(children[3]["file"], "story-add-widget.md")
        self.assertEqual(children[4]["tracker_id"], 102)
        self.assertIsNone(children[4]["file"])
        self.assertEqual(len(out["children"]), 2)  # the pulled file is not listed a second time

    def test_epic_children_never_guess_between_disagreeing_trackers(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", tracker_id='"#999"'))
        _, out, _ = fx.run("#10")
        child = next(c for c in out["children"] if c["entry_id"] == 3)
        self.assertIsNone(child["tracker_id"])
        self.assertEqual(child["tracker_id_conflict"], [101, 999])

    def test_initiative_children_merge_epic_files_and_list_epics_without_a_row(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/tickets.toml",
            "[[epic]]\nid = 2\nslug = \"epic-a\"\ntitle = \"Epic A\"\n\n[[epic]]\nid = 3\ntracker_id = \"#11\"\nslug = \"epic-b\"\n",
        )
        fx.write(f"{INIT}/epic-c/epic-c.md", md(type="epic", title='"Envelope"', tracker_id='"#12"'))
        _, out, _ = fx.run("#1")
        by_epic = {c["epic"]: c for c in out["children"]}
        self.assertEqual(by_epic["epic-a"]["tracker_id"], 10)  # only the epic file writes it
        self.assertEqual(by_epic["epic-b"]["tracker_id"], 11)
        self.assertEqual(by_epic["epic-c"]["tracker_id"], 12)
        self.assertIsNone(by_epic["epic-c"]["epic_id"])

    def test_preflight_leaves_every_file_untouched(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3"))
        before = fx.snapshot()
        for ref in ("#101", "#10", "#999"):
            fx.run(ref)
        self.assertEqual(fx.snapshot(), before)

    def test_plan_note_that_joins_nothing_is_a_warning_not_a_plan(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/plan-gh-101.md", md(type="feature", ticket="''", tracker_id="'#101'"))
        code, out, _ = fx.run("#101")
        self.assertEqual(code, 0)
        self.assertFalse(out["plan"]["exists"])
        self.assertEqual(len(out["warnings"]), 1)
        self.assertIn("plan-gh-101.md", out["warnings"][0])


class FailClosedTests(unittest.TestCase):
    def assertFails(self, fx, ref, code, *extra):
        status, out, err = fx.run(ref, *extra)
        self.assertEqual(status, 1, out)
        self.assertEqual((out["ok"], out["code"]), (False, code), out)
        self.assertTrue(err.startswith(f"{code}:"), err)
        return out

    def test_missing_number_fails_and_lists_plans_that_mention_it(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/plan-gh-999-orphan.md", md(type="feature", ticket="'#999'", status="done"))
        out = self.assertFails(fx, "#999", "not_found")
        self.assertEqual(out["mentions"], [f"{INIT}/plan-gh-999-orphan.md"])
        self.assertIn("do not create", out["error"])

    def test_missing_number_with_no_mentions(self):
        out = self.assertFails(Fixture(self).layout(), "#4040", "not_found")
        self.assertEqual(out["mentions"], [])

    def test_the_same_number_on_two_entries_in_different_epics_is_a_duplicate(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#101", "story", "Other thing")))
        out = self.assertFails(fx, "#101", "duplicate_tracker_id")
        self.assertEqual(len(out["tickets"]), 2)

    def test_an_entry_and_an_id_less_leaf_file_in_one_folder_are_two_tickets(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-stray.md", md(type="story", title='"Stray"', tracker_id='"#101"'))
        self.assertFails(fx, "#101", "duplicate_tracker_id")

    def test_an_epic_number_reused_by_a_story_is_a_duplicate(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#10", "story", "Other thing")))
        self.assertFails(fx, "10", "duplicate_tracker_id")

    def test_the_same_number_in_two_initiatives_is_a_duplicate(self):
        fx = Fixture(self).layout()
        fx.write("initiative-y/epic-z/tickets.toml", toml_entries((1, "#101", "story", "Again")))
        fx.write("initiative-y/epic-z/epic-z.md", md(type="epic", title='"Z"'))
        self.assertFails(fx, "#101", "duplicate_tracker_id")

    def test_entry_and_leaf_file_with_different_numbers_conflict_from_either_side(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", tracker_id='"#999"'))
        self.assertFails(fx, "#101", "tracker_id_conflict")
        self.assertFails(fx, "#999", "tracker_id_conflict")

    def test_epic_row_and_epic_file_with_different_numbers_conflict(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/epic-a.md", md(type="epic", title='"Epic A"', tracker_id='"#77"'))
        self.assertFails(fx, "#10", "tracker_id_conflict")

    def test_remote_naming_a_different_issue_conflicts(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/epic-a/story-add-widget.md",
            md(id=3, type="story", tracker_id='"#101"', remote=f'"https://github.com/{REPO}/issues/555"'),
        )
        self.assertFails(fx, "#101", "tracker_id_conflict")

    def test_two_plans_for_one_ticket_are_ambiguous(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3"))
        fx.write(f"{INIT}/epic-a/story-add-widget-again-plan.md", md(type="feature", ticket="'3'"))
        out = self.assertFails(fx, "#101", "multiple_plans")
        self.assertEqual(len(out["plans"]), 2)

    def test_an_id_plan_and_an_issue_number_plan_for_one_ticket_are_ambiguous(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3"))
        fx.write(f"{INIT}/plan-gh-101.md", md(type="feature", ticket="'#101'"))
        self.assertFails(fx, "#101", "multiple_plans")

    def test_a_file_at_the_expected_plan_path_that_names_no_ticket_is_a_collision(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="99"))
        self.assertFails(fx, "#101", "plan_path_collision")

    def test_plan_that_carries_the_number_but_joins_another_ticket_is_a_conflict(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/plan-misfiled.md", md(type="feature", ticket="4", tracker_id="'#101'"))
        self.assertFails(fx, "#101", "plan_identity_conflict")

    def test_malformed_breakdown_fails_every_lookup_even_an_unrelated_one(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", "[[entry]\nid = 1\n")
        self.assertFails(fx, "#101", "malformed_store")

    def test_unclosed_leaf_frontmatter_fails(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-broken.md", '---\nid: 5\ntype: story\ntracker_id: "#500"\n\n# never closed\n')
        self.assertFails(fx, "#101", "malformed_store")

    def test_a_tracker_id_that_is_not_an_issue_number_fails(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "JIRA-5", "story", "Other thing")))
        self.assertFails(fx, "#101", "malformed_store")

    def test_entry_with_an_unknown_type_fails(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#201", "chore", "Other thing")))
        self.assertFails(fx, "#101", "malformed_store")

    def test_two_entries_with_one_id_fail(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#201", "story", "A"), (1, "#202", "story", "B")))
        self.assertFails(fx, "#101", "malformed_store")

    def test_two_leaf_files_with_one_id_fail(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-one.md", md(id=8, type="story"))
        fx.write(f"{INIT}/epic-a/story-two.md", md(id=8, type="story"))
        self.assertFails(fx, "#101", "malformed_store")

    def test_references_that_are_not_issues_fail(self):
        fx = Fixture(self).layout()
        for ref in ("abc", "#0", "0", "", "#12x"):
            self.assertFails(fx, ref, "bad_reference")
        self.assertFails(fx, f"https://github.com/{REPO}/pull/101", "bad_reference")

    def test_issue_url_from_another_repository_fails(self):
        self.assertFails(Fixture(self).layout(), "https://github.com/someone/else/issues/101", "wrong_repository")

    def test_an_unreadable_folder_fails_every_lookup(self):
        fx = Fixture(self).layout()
        hidden = fx.store / INIT / "epic-b"
        hidden.chmod(0)
        self.addCleanup(hidden.chmod, 0o755)  # runs before the temp tree is removed
        if os.access(hidden, os.R_OK):
            self.skipTest("folder permissions are not enforced for this user")
        out = self.assertFails(fx, "#101", "malformed_store")
        self.assertIn("epic-b", out["error"])

    def test_remote_in_another_repository_fails(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/epic-a/story-add-widget.md",
            md(id=3, type="story", tracker_id='"#101"', remote='"https://github.com/someone/else/issues/101"'),
        )
        out = self.assertFails(fx, "#101", "wrong_repository")
        self.assertIn(REPO, out["error"])

    def test_remote_that_is_not_an_issue_url_fails(self):
        for remote in ("not a url", f"https://github.com/{REPO}/pull/101", f"https://example.com/{REPO}/issues/101"):
            fx = Fixture(self).layout()
            fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", tracker_id='"#101"', remote=f'"{remote}"'))
            self.assertFails(fx, "#101", "bad_remote")

    def test_a_remote_written_on_an_epic_row_or_entry_is_checked_too(self):
        fx = Fixture(self).layout()
        fx.write(
            f"{INIT}/epic-a/tickets.toml",
            toml_entries((3, "#101", "story", "Add widget")).replace(
                'title = "Add widget"', 'title = "Add widget"\nremote = "https://github.com/someone/else/issues/101"'
            ),
        )
        self.assertFails(fx, "#101", "wrong_repository")

    def test_missing_store_fails(self):
        fx = Fixture(self)
        shutil.rmtree(fx.store)
        self.assertFails(fx, "#101", "bad_config")


class PlanIdentityTests(unittest.TestCase):
    def conflicting(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#102'", status="draft"))
        return fx

    def test_a_joined_plan_naming_another_issue_is_rejected_whichever_issue_is_asked_for(self):
        fx = self.conflicting()
        for ref in ("#101", "#102"):  # the ticket's own number, and the number the plan claims
            code, out, _ = fx.run(ref)
            self.assertEqual((code, out["code"]), (1, "plan_identity_conflict"), (ref, out))
        out = fx.run("#101")[1]
        self.assertEqual((out["ticket_tracker_ids"], out["plan_tracker_id"]), ([101], 102))

    def test_a_plan_whose_tracker_matches_its_ticket_or_is_empty_passes(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#101'"))
        fx.write(f"{INIT}/epic-a/bug-fix-gadget-plan.md", md(type="feature", ticket="4", tracker_id="''"))
        self.assertEqual(fx.run("#101")[0], 0)
        self.assertEqual(fx.run("#102")[0], 0)

    def test_a_plan_joined_by_issue_number_must_carry_that_same_number(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/plan-gh-101.md", md(type="feature", ticket="'#101'", tracker_id="'#102'"))
        self.assertEqual(fx.run("#101")[1]["code"], "plan_identity_conflict")

    def test_check_stock_does_not_mask_a_conflicting_plan(self):
        fx = Fixture(self, project=True).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#102'"))
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual((code, out["code"]), (1, "plan_identity_conflict"), out)


class ValidateStoreTests(unittest.TestCase):
    def assertProblem(self, fx, code, *extra):
        status, out, err = fx.validate(*extra)
        self.assertEqual(status, 1, out)
        self.assertEqual((out["ok"], out["code"]), (False, code), out)
        self.assertTrue(err.startswith(f"{code}:"), err)
        self.assertIn(code, [p["code"] for p in out["problems"]])
        return out

    def test_a_sound_store_passes_without_an_issue_and_reports_counts(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#101'"))
        code, out, _ = fx.validate()
        self.assertEqual(code, 0, out)
        self.assertEqual((out["ok"], out["mode"], out["tracker_ids"], out["plans"]), (True, "validate-store", 6, 1))
        self.assertEqual(out["repo_checked"], REPO)

    def test_it_uses_the_project_config_when_given_a_project_root(self):
        code, out, _ = Fixture(self, project=True).layout().validate()
        self.assertEqual((code, out["repo_checked"]), (0, REPO), out)

    def test_it_needs_exactly_one_of_an_issue_or_the_flag(self):
        fx = Fixture(self).layout()
        base = [sys.executable, str(SCRIPT), "--store", str(fx.store)]
        for extra in ([], ["#101", "--validate-store"]):
            proc = subprocess.run([*base, *extra], capture_output=True, text=True, check=False)
            self.assertEqual(proc.returncode, 2, proc.stderr)

    def test_duplicate_numbers_fail_with_no_issue_given(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#101", "story", "Other thing")))
        out = self.assertProblem(fx, "duplicate_tracker_id")
        self.assertEqual(len(out["problems"][0]["tickets"]), 2)

    def test_a_duplicate_hidden_in_an_entry_that_stock_no_longer_reads_is_still_found(self):
        fx = Fixture(self, project=True).layout()
        fx.write(f"{INIT}/epic-a/tickets.toml", toml_entries((3, "#101", "story", "A"), (4, "#101", "bug", "B")))
        self.assertProblem(fx, "duplicate_tracker_id")

    def test_disagreeing_carriers_and_remotes_fail(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", tracker_id='"#999"'))
        self.assertProblem(fx, "tracker_id_conflict")
        other = Fixture(self).layout()
        other.write(
            f"{INIT}/epic-a/story-add-widget.md",
            md(id=3, type="story", tracker_id='"#101"', remote='"https://github.com/someone/else/issues/101"'),
        )
        self.assertProblem(other, "wrong_repository")

    def test_a_plan_naming_another_issue_fails_without_asking_for_either_issue(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#102'"))
        self.assertProblem(fx, "plan_identity_conflict")

    def test_every_problem_is_listed_not_just_the_first(self):
        fx = Fixture(self).layout()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#101", "story", "Other thing")))
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", tracker_id="'#102'"))
        out = self.assertProblem(fx, "duplicate_tracker_id")
        self.assertEqual(sorted({p["code"] for p in out["problems"]}), ["duplicate_tracker_id", "plan_identity_conflict"])

    def test_unreadable_and_malformed_stores_fail_closed(self):
        broken = Fixture(self).layout()
        broken.write(f"{INIT}/epic-b/tickets.toml", "[[entry]\nid = 1\n")
        status, out, _ = broken.validate()
        self.assertEqual((status, out["code"]), (1, "malformed_store"))
        locked = Fixture(self).layout()
        hidden = locked.store / INIT / "epic-b"
        hidden.chmod(0)
        self.addCleanup(hidden.chmod, 0o755)
        if os.access(hidden, os.R_OK):
            self.skipTest("folder permissions are not enforced for this user")
        status, out, _ = locked.validate()
        self.assertEqual((status, out["code"]), (1, "malformed_store"))


class SymlinkTests(unittest.TestCase):
    def linked(self):
        fx = Fixture(self).layout()
        try:
            os.symlink(fx.store / INIT / "epic-a", fx.store / INIT / "epic-link", target_is_directory=True)
        except OSError:
            self.skipTest("symlinks are not available")
        return fx

    def test_a_symlinked_ticket_folder_fails_every_lookup_and_the_store_check(self):
        fx = self.linked()
        for status, out, _ in (fx.run("#201"), fx.validate()):
            self.assertEqual((status, out["code"]), (1, "malformed_store"), out)
            self.assertIn("epic-link", out["error"])
            self.assertIn("symlink", out["error"])

    def test_stock_follows_the_link_which_is_why_it_is_rejected(self):
        fx = self.linked()
        fx.write_at("_bmad/config.toml", '[core]\noutput_folder = "{project-root}/_bmad-output"\n')
        for rel in ("_bmad/scripts/config_utils.py", "_bmad/method/scripts/tickets.py"):
            dest = fx.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO_ROOT / rel, dest)
        proc = subprocess.run(
            [sys.executable, str(fx.root / "_bmad/method/scripts/tickets.py"), "--project-root", str(fx.root), "status", str(fx.store / INIT)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertIn("epic-link", proc.stdout + proc.stderr)  # stock reads the linked epic; the scan would not have


class SkillInvocationTests(unittest.TestCase):
    def test_the_documented_commands_quote_the_skill_root_and_the_project_root(self):
        lines = [ln for ln in SKILL_MD.read_text().splitlines() if ln.startswith("uv run ")]
        self.assertGreaterEqual(len(lines), 2)
        for line in lines:
            self.assertIn('"{skill-root}/scripts/resolve_issue.py"', line)
            self.assertIn('--project-root "{project-root}"', line)
            self.assertEqual(line.count("{skill-root}"), 1)
            self.assertEqual(line.count("{project-root}"), 1)
        self.assertEqual(shlex.split(lines[1])[2], "{skill-root}/scripts/resolve_issue.py")
        self.assertEqual(shlex.split(lines[1])[-1], "{project-root}")


class StockHandoffTests(unittest.TestCase):
    def project(self):
        return Fixture(self, project=True).layout()

    def test_stock_find_agrees_for_a_planned_and_an_unplanned_ticket(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", status="in-progress"))
        planned = fx.run("#101", "--check-stock")
        unplanned = fx.run("#102", "--check-stock")
        self.assertEqual(planned[0], 0, planned[1])
        self.assertEqual(unplanned[0], 0, unplanned[1])
        # An entry that was never pulled has no tracker id in stock's answer; empty is not a conflict.
        self.assertEqual(
            planned[1]["stock_check"],
            {
                "checked": True,
                "agrees": True,
                "ref": "2.3",
                "dir": str((fx.store / INIT).resolve()),
                "stock_tracker_id": None,
                "plan_joined": "story-add-widget-plan.md",
                "plan_status": "in-progress",
            },
        )
        self.assertTrue(planned[1]["plan"]["exists"])
        self.assertFalse(unplanned[1]["plan"]["exists"])

    def test_project_config_supplies_the_store_the_repo_and_the_active_initiative(self):
        fx = self.project()
        code, out, _ = fx.run(f"https://github.com/{REPO}/issues/101")
        self.assertEqual(code, 0)
        self.assertEqual(out["handoff"]["active_initiative"], INIT)
        self.assertTrue(out["handoff"]["in_active_initiative"])
        self.assertEqual(out["handoff"]["bmad_build_input"], "2.3")  # the one case a bare reference is safe
        self.assertNotIn("note", out["handoff"])

    def test_a_ticket_outside_the_active_initiative_is_flagged_for_the_handoff(self):
        fx = self.project()
        fx.write("initiative-y/initiative-y.md", md(type="initiative", title='"Y"'))
        fx.write("initiative-y/tickets.toml", '[[epic]]\nid = 1\ntracker_id = "#20"\nslug = "epic-z"\ntitle = "Z"\n')
        fx.write("initiative-y/epic-z/epic-z.md", md(type="epic", title='"Z"', tracker_id='"#20"'))
        fx.write("initiative-y/epic-z/tickets.toml", toml_entries((1, "#401", "story", "Elsewhere")))
        code, out, _ = fx.run("#401", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertFalse(out["handoff"]["in_active_initiative"])
        self.assertIsNone(out["handoff"]["bmad_build_input"])
        self.assertEqual(out["handoff"]["scoped"], {"dir": str((fx.store / "initiative-y").resolve()), "ref": "1.1"})
        self.assertIn("initiative-y", out["handoff"]["stock_find"])
        self.assertIn("active initiative", out["handoff"]["note"])

    def test_without_an_active_initiative_the_handoff_is_folder_scoped_never_bare(self):
        fx = Fixture(self, project=True, active=None).layout()
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual(code, 0, out)
        handoff = out["handoff"]
        self.assertIsNone(handoff["bmad_build_input"])
        self.assertIsNone(handoff["in_active_initiative"])
        self.assertEqual(handoff["scoped"], {"dir": str((fx.store / INIT).resolve()), "ref": "2.3"})
        self.assertIn("no active initiative", handoff["note"])
        # The scoped command works as printed: stock finds the same ticket with the folder and no active initiative.
        argv = shlex.split(handoff["stock_find"])
        proc = subprocess.run([sys.executable, *argv[2:]], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["epic"], "epic-a")
        bare = subprocess.run(
            [sys.executable, str(fx.root / "_bmad/method/scripts/tickets.py"), "--project-root", str(fx.root), "find", "2.3"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(bare.returncode, 0)  # what a bare reference would have done

    def test_a_file_name_reference_is_never_offered_bare(self):
        fx = self.project()
        fx.write("backlog/bug-flaky.md", md(type="bug", title='"Flaky"', tracker_id='"#300"'))
        out = fx.run("#300", "--check-stock")[1]["handoff"]
        self.assertIsNone(out["bmad_build_input"])
        self.assertEqual(out["scoped"]["ref"], "bug-flaky.md")
        self.assertIn("file name", out["note"])

    def test_an_id_less_leaf_whose_name_exists_in_two_epics_is_scoped_and_stock_confirms_the_bare_lookup_is_ambiguous(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/bug-same.md", md(type="bug", title='"Same"', tracker_id='"#500"'))
        fx.write(f"{INIT}/epic-b/bug-same.md", md(type="bug", title='"Same"'))
        code, out, _ = fx.run("#500", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertIsNone(out["handoff"]["bmad_build_input"])
        self.assertEqual(out["handoff"]["scoped"], {"dir": str((fx.store / INIT / "epic-a").resolve()), "ref": "bug-same.md"})
        bare = subprocess.run(
            [sys.executable, str(fx.root / "_bmad/method/scripts/tickets.py"), "--project-root", str(fx.root), "find", "bug-same.md"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(bare.returncode, 0, bare.stdout)  # a bare lookup would not have named one ticket

    def test_a_bare_entry_reference_is_offered_only_when_stock_returns_this_ticket(self):
        fx = self.project()
        verified = fx.run("#101")[1]["handoff"]
        self.assertEqual(verified["bmad_build_input"], "2.3")
        result = fx.run("#101")[1]
        other_ticket = {"epic": "epic-b", "id": 1}
        for row in (other_ticket, {"epic": "epic-a", "id": 4}):
            with mock.patch.object(resolve_issue, "stock_row", return_value=row):
                handoff = resolve_issue.handoff(result, INIT, fx.store.resolve(), fx.root)
            self.assertIsNone(handoff["bmad_build_input"], row)
            self.assertIn("could not be verified", handoff["note"])
        with mock.patch.object(resolve_issue, "stock_row", side_effect=resolve_issue.Fail("stock_unreadable", "x")):
            self.assertIsNone(resolve_issue.handoff(result, INIT, fx.store.resolve(), fx.root)["bmad_build_input"])

    def test_generated_commands_are_shell_quoted_with_the_project_root(self):
        fx = Fixture(self, project=True, subdir="my proj (x) $HOME 'q'").layout()
        code, out, _ = fx.run("#101")
        self.assertEqual(code, 0, out)
        argv = shlex.split(out["handoff"]["stock_find"])
        self.assertEqual(
            argv,
            [
                "uv",
                "run",
                str((fx.root / "_bmad/method/scripts/tickets.py").resolve()),
                "--project-root",
                str(fx.root.resolve()),
                "find",
                str((fx.store / INIT).resolve()),
                "2.3",
            ],
        )

    def test_a_store_passed_by_hand_names_no_project_root_in_the_command(self):
        code, out, _ = Fixture(self).layout().run("#101")
        self.assertEqual(code, 0)
        self.assertNotIn("stock_find", out["handoff"])
        self.assertIsNone(out["handoff"]["bmad_build_input"])
        self.assertEqual(out["handoff"]["scoped"]["ref"], "2.3")

    def test_stock_that_cannot_see_the_plan_the_preflight_found_is_a_disagreement(self):
        fx = self.project()
        fx.write(f"{INIT}/plan-gh-101.md", md(type="feature", ticket="'#101'", status="draft"))
        self.assertEqual(fx.run("#101")[0], 0)
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual((code, out["code"]), (1, "stock_disagrees"), out)

    def test_a_defect_only_stock_reads_fails_with_check_stock_and_passes_without(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", status="nonsense", tracker_id='"#101"'))
        self.assertEqual(fx.run("#101")[0], 0)
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual((code, out["code"]), (1, "stock_unreadable"), out)

    def test_stock_reports_the_tracker_id_a_pulled_leaf_file_carries(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", title='"Add widget"', tracker_id='"#101"'))
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertEqual(out["stock_check"]["stock_tracker_id"], "#101")
        self.assertEqual(Path(out["plan"]["path"]).name, "story-add-widget-plan.md")

    def test_an_unlisted_leaf_agrees_with_stock_by_epic_and_id(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-late.md", md(id=7, type="story", title='"Late"', tracker_id='"#103"'))
        code, out, _ = fx.run("#103", "--check-stock")
        self.assertEqual((code, out["stock_check"]["ref"]), (0, "2.7"), out)

    def test_backlog_leaf_agrees_with_stock_by_file_name(self):
        fx = self.project()
        fx.write("backlog/bug-flaky.md", md(type="bug", title='"Flaky"', tracker_id='"#300"'))
        code, out, _ = fx.run("#300", "--check-stock")
        self.assertEqual((code, out["stock_check"]["ref"]), (0, "bug-flaky.md"), out)

    def test_duplicates_still_fail_when_stock_would_have_answered(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-b/tickets.toml", toml_entries((1, "#101", "story", "Other thing")))
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual((code, out["code"]), (1, "duplicate_tracker_id"), out)

    def stock_answer(self, fx, joined=None, **override):
        """check_stock with stock's answers faked, so a conflicting non-empty tracker id, status or join can be shown."""
        result = fx.run("#101")[1]
        found = {"tracker_id": "", "ref": "2.3", "epic": "epic-a", "id": 3, "plan": result["plan"]["path"], **override}
        fake = SimpleNamespace(returncode=0, stdout=json.dumps(found), stderr="")
        with mock.patch.object(resolve_issue.subprocess, "run", return_value=fake), mock.patch.object(
            resolve_issue, "stock_join", return_value=joined
        ):
            return resolve_issue.check_stock(fx.root, result)

    def test_empty_stock_tracker_id_is_accepted_and_a_conflicting_one_is_not(self):
        fx = self.project()
        self.assertTrue(self.stock_answer(fx)["agrees"])
        self.assertEqual(self.stock_answer(fx, tracker_id="#101")["stock_tracker_id"], "#101")
        with self.assertRaises(resolve_issue.Fail) as caught:
            self.stock_answer(fx, tracker_id="#999")
        self.assertEqual(caught.exception.code, "stock_disagrees")
        self.assertEqual(caught.exception.data["stock"]["tracker_id"], "#999")

    def test_a_different_stock_reference_epic_id_or_plan_is_a_disagreement(self):
        fx = self.project()
        for override in ({"ref": "2.4"}, {"epic": "epic-b"}, {"id": 4}, {"plan": str(fx.store / "elsewhere-plan.md")}):
            with self.assertRaises(resolve_issue.Fail, msg=override) as caught:
                self.stock_answer(fx, **override)
            self.assertEqual(caught.exception.code, "stock_disagrees", override)

    def test_stock_status_or_join_that_differs_from_an_existing_plan_is_a_disagreement(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3", status="in-progress"))
        joined = "story-add-widget-plan.md"
        self.assertEqual(self.stock_answer(fx, joined=joined, status="in-progress")["plan_status"], "in-progress")
        for kwargs in (
            {"joined": joined, "status": ""},  # stock joined it but read no status
            {"joined": joined, "status": "done"},
            {"joined": None, "status": "in-progress"},  # stock did not join it at all
            {"joined": "story-other-plan.md", "status": "in-progress"},
        ):
            with self.assertRaises(resolve_issue.Fail, msg=kwargs) as caught:
                self.stock_answer(fx, **kwargs)
            self.assertEqual(caught.exception.code, "stock_disagrees", kwargs)

    def test_stock_that_joined_a_plan_the_preflight_did_not_find_is_a_disagreement(self):
        fx = self.project()  # no plan on disk
        with self.assertRaises(resolve_issue.Fail) as caught:
            self.stock_answer(fx, joined="story-add-widget-plan.md")
        self.assertEqual(caught.exception.code, "stock_disagrees")

    def test_a_leaf_typed_plan_is_accepted_only_if_stock_really_joins_it(self):
        # The preflight treats a `-plan.md` with a `ticket` key as a plan whatever its type. The integrated stock reads
        # `type: story` as a leaf file, never joins the plan and reports no status; the check must then fail, not
        # trust the matching plan path. Which side stock is on is asked of stock itself, so the test holds for either.
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="story", ticket="3", status="in-progress"))
        plain = fx.run("#101")
        self.assertEqual((plain[0], plain[1]["plan"]["exists"], plain[1]["plan"]["status"]), (0, True, "in-progress"))
        script = fx.root / "_bmad" / "method" / "scripts" / "tickets.py"
        stock_joined = resolve_issue.stock_join(script, str(fx.store.resolve() / INIT), "2.3")
        code, out, _ = fx.run("#101", "--check-stock")
        if stock_joined is None:
            self.assertEqual((code, out["code"]), (1, "stock_disagrees"), out)
            self.assertTrue(out["preflight"]["plan_exists"])
            self.assertEqual(out["preflight"]["plan_joined"], "story-add-widget-plan.md")
            self.assertEqual(out["preflight"]["status"], "in-progress")
            self.assertIsNone(out["stock"]["plan_joined"])
            self.assertEqual(out["stock"]["status"], "")
        else:
            self.assertEqual((code, out["stock_check"]["plan_joined"]), (0, "story-add-widget-plan.md"), out)

    def test_a_correctly_typed_plan_with_no_status_key_agrees_and_reads_as_absent_not_missing(self):
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget-plan.md", md(type="feature", ticket="3"))
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["plan"]["exists"])
        self.assertIsNone(out["plan"]["status"])
        self.assertEqual(out["stock_check"]["plan_joined"], "story-add-widget-plan.md")
        self.assertEqual(out["stock_check"]["plan_status"], "")

    def test_no_plan_agrees_with_stock_joining_nothing(self):
        fx = self.project()
        code, out, _ = fx.run("#102", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertFalse(out["plan"]["exists"])
        self.assertIsNone(out["stock_check"]["plan_joined"])
        self.assertIsNone(out["stock_check"]["plan_status"])

    def test_a_pulled_leafs_own_status_does_not_count_against_a_missing_plan(self):
        # With no plan stock reports the leaf file's own status; the preflight has no plan status to compare.
        fx = self.project()
        fx.write(f"{INIT}/epic-a/story-add-widget.md", md(id=3, type="story", status="ready-for-dev", tracker_id='"#101"'))
        code, out, _ = fx.run("#101", "--check-stock")
        self.assertEqual(code, 0, out)
        self.assertFalse(out["plan"]["exists"])

    def test_check_stock_on_containers_succeeds_with_non_buildable_metadata(self):
        fx = self.project()
        for ref, layer in (("#10", "epic"), ("#1", "initiative")):
            code, out, _ = fx.run(ref, "--check-stock")
            self.assertEqual(code, 0, out)
            self.assertEqual((out["ok"], out["layer"], out["buildable"]), (True, layer, False))
            self.assertFalse(out["stock_check"]["checked"])
            self.assertIn("container", out["stock_check"]["reason"])
            self.assertNotIn("code", out)

    def test_stock_tracker_ids_in_any_numeric_form_agree_and_others_do_not(self):
        fx = self.project()
        for form in (101, "101", "#101", " #101 "):
            self.assertEqual(self.stock_answer(fx, tracker_id=form)["stock_tracker_id"], "#101", form)
        for form in (102, "#102", "abc", True, "#0"):
            with self.assertRaises(resolve_issue.Fail, msg=form) as caught:
                self.stock_answer(fx, tracker_id=form)
            self.assertEqual(caught.exception.code, "stock_disagrees", form)


if __name__ == "__main__":
    unittest.main()
