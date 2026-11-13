"""Regression for #2252: the completed Epic 9 refactor sweep (entry 13, tracker #942) must resolve as done.

The resolver takes a joined plan's `status` over the entry's TOML `tracker_status`, so the plan has to say `done`
once the work has landed. The managed resolver under `_bmad/method/scripts` is run as shipped, against the real tree.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "_bmad" / "method" / "scripts" / "tickets.py"
EPIC = ROOT / "_bmad-output" / "initiative-rpgtoolkit-reawakened" / "epic-web-runner-packaging"
SWEEP_REF = "9.13"


def resolve(command: str) -> dict:
    run = subprocess.run(
        [sys.executable, str(RESOLVER), command, str(EPIC)], check=False, capture_output=True, encoding="utf-8"
    )
    if run.returncode != 0:
        raise AssertionError(run.stderr)
    return json.loads(run.stdout)


class RefactorSweepStatusTests(unittest.TestCase):
    def test_status_resolves_the_sweep_as_done(self):
        rows = [row for row in resolve("status")["tickets"] if row["ref"] == SWEEP_REF]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["state"], "done")

    def test_next_does_not_list_the_sweep_as_in_progress(self):
        refs = [row["ref"] for row in resolve("next")["in_progress"]]
        self.assertNotIn(SWEEP_REF, refs)


if __name__ == "__main__":
    unittest.main()
