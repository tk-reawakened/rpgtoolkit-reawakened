"""Completed plans must not keep their tickets and dependants artificially unfinished (#2253)."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "_bmad" / "method" / "scripts" / "tickets.py"
INITIATIVE = ROOT / "_bmad-output" / "initiative-rpgtoolkit-reawakened"


def resolve(epic: str, command: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(RESOLVER), command, str(INITIATIVE / epic)],
        check=True, capture_output=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


class CompletedPlanStatusTests(unittest.TestCase):
    def test_completed_plans_resolve_done(self):
        for epic, refs in {
            "epic-board-rendering": ("4.38", "4.40", "4.41"),
            "epic-rpgcode-platform": ("19.21",),
            "epic-web-runner-packaging": ("9.14", "9.16", "9.19", "9.32"),
        }.items():
            rows = {row["ref"]: row for row in resolve(epic, "status")["tickets"]}
            for ref in refs:
                with self.subTest(ref=ref):
                    self.assertEqual(rows[ref]["state"], "done")

    def test_next_no_longer_waits_on_completed_live_player(self):
        result = resolve("epic-web-runner-packaging", "next")
        self.assertFalse({"9.14", "9.16"} & {row["ref"] for row in result["in_progress"]})
        for row in result["blocked"]:
            if row["ref"] in {"9.32", "9.33", "9.34", "9.35"}:
                self.assertNotIn(16, row["waiting_on"], row["ref"])


if __name__ == "__main__":
    unittest.main()
