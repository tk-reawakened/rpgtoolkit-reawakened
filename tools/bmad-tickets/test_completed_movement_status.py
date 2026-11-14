"""Regression for #2254: the merged held-direction fix must not be offered as new work."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "_bmad" / "method" / "scripts" / "tickets.py"
EPIC = ROOT / "_bmad-output" / "initiative-rpgtoolkit-reawakened" / "epic-movement-triggers"
REF = "5.14"


def resolve(command):
    result = subprocess.run([sys.executable, str(RESOLVER), command, str(EPIC)], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


class CompletedMovementStatusTests(unittest.TestCase):
    def test_completed_fix_is_done_and_not_offered_as_work(self):
        rows = [row for row in resolve("status")["tickets"] if row["ref"] == REF]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["state"], "done")
        upcoming = resolve("next")
        for group in ("ready_to_refine", "ready_to_start", "in_progress", "blocked"):
            self.assertNotIn(REF, [row["ref"] for row in upcoming[group]], group)


if __name__ == "__main__":
    unittest.main()
