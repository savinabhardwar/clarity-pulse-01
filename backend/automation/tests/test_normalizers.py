import json
from pathlib import Path
from unittest import TestCase

from ai_pm.events import normalize_jira, normalize_push, normalize_pull_request, normalize_requirement


class OriginalContractTests(TestCase):
    def test_original_provider_contracts(self):
        cases = json.loads((Path(__file__).parent / "fixtures/legacy_normalizers.json").read_text(encoding="utf-8"))
        functions = {"jira": normalize_jira, "push": lambda value: normalize_push(value, "fixture-delivery"),
                     "pr": lambda value: normalize_pull_request(value, "fixture-delivery"), "requirement": normalize_requirement}
        for case in cases:
            with self.subTest(operation=case["operation"], input=case["input"]):
                self.assertEqual(functions[case["operation"]](case["input"]), case["output"])
