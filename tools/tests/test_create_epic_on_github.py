"""Project status names and option IDs are different GitHub values."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "create-epic-on-github.py"
spec = importlib.util.spec_from_file_location("create_epic", path)
epic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(epic)


class ParentStatusTest(unittest.TestCase):
    def test_unchanged_and_changed_status(self):
        item = {"fieldValues": {"nodes": [{"field": {"id": epic.STATUS_FIELD_ID}, "name": "in-progress"}]}}
        self.assertFalse(epic.parent_status_needs_update(item, "in-progress"))
        self.assertTrue(epic.parent_status_needs_update(item, "backlog"))
        self.assertEqual(epic.project_option("backlog"), epic.STATUS_OPTION_IDS["draft"])


if __name__ == "__main__":
    unittest.main()
