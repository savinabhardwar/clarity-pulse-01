"""Guard sync semantics while replacing the JavaScript implementation."""

import json
from pathlib import Path
import random
from legacy_fixtures import reference_run
import unittest

from app.jobs.jira_sync.core import (
    assignee_project_counts, cluster_epics, cluster_ticket_titles, js_round,
    similarity_ratio, team_seed, workdays_between, workdays_inclusive,
)
from app.jobs.jira_sync.metrics import compute_metrics


class EpicParityTests(unittest.TestCase):
    def test_epics_match_original_on_varied_workstreams(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/legacy_epics.json").read_text(encoding="utf-8"))
        actual = cluster_epics(fixture["input"])
        actual.pop("generatedAt")
        self.assertEqual(actual, fixture["output"])


class SyncCoreTests(unittest.TestCase):
    def test_workdays_exclude_weekends_and_preserve_endpoint_rules(self):
        self.assertEqual(workdays_between("2026-09-25", "2026-09-28"), 1)
        self.assertEqual(workdays_inclusive("2026-09-25", "2026-09-28"), 2)
        self.assertEqual(workdays_between("2026-09-28", "2026-09-25"), 0)
        self.assertEqual(workdays_between("2026-09-25T23:00:00Z", "2026-09-28T01:00:00Z"), 1)

    def test_rounding_keeps_js_half_rules(self):
        self.assertEqual(js_round(2.5), 3)
        self.assertEqual(js_round(-2.5), -2)

    def test_epics_merge_disciplines_but_not_generic_cross_team_work(self):
        def epic(key, summary, project="TEAM"):
            return {"key": key, "summary": summary, "project": project, "status": "To Do", "updated": "2026-09-20T00:00:00Z"}
        output = cluster_epics([
            epic("TEAM-1", "QIP Frontend"), epic("TEAM-2", "QIP Backend"),
            epic("TEAM-3", "Support Tickets"), epic("TI-1", "Support Tickets", "TI"),
            epic("TEAM-4", "WAAC"), epic("TEAM-5", "WAAC migration"),
        ], generated_at="2026-10-02")
        projects = output["projects"]
        self.assertEqual(len(projects), 5)
        qip = next(project for project in projects if project["id"] == "qip")
        self.assertEqual(qip["name"], "QIP")
        self.assertEqual(len(qip["epics"]), 2)
        self.assertEqual(len({project["id"] for project in projects}), 5)
        support = [project for project in projects if project["name"] == "Support Tickets"]
        self.assertEqual(len(support), 2)
        self.assertEqual({tuple(project["jiraProjects"]) for project in support}, {("TEAM",), ("TI",)})

    def test_counts_preserve_ties_and_team_guesses_remain_unconfirmed(self):
        issues = [{"project": project, "assignee": {"accountId": "alex", "name": "Alex"}} for project in ["TI", "TEAM", "TI", "TEAM"]]
        issues.append({"project": "TEAM", "assignee": None})
        counts = assignee_project_counts(issues)
        self.assertEqual(counts[0]["projectCounts"], [{"project": "TI", "count": 2}, {"project": "TEAM", "count": 2}])
        person = team_seed(counts)["people"][0]
        self.assertTrue(person["guessed"])
        self.assertIn("needs human confirmation", person["guessReason"])
        self.assertEqual(person["team"], "Team - Infrastructure")

    def test_empty_core_inputs_are_valid(self):
        self.assertEqual(assignee_project_counts([]), [])
        self.assertEqual(cluster_ticket_titles([]), [])
        self.assertEqual(cluster_epics([])["projects"], [])
        self.assertEqual(compute_metrics(as_of="2026-10-02", tracked_sprints=[], issues=[])["orgBoardHealth"]["boardHealthScore"], 50)

    def test_metrics_and_clustering_match_legacy_on_varied_fixtures(self):
        rng = random.Random(4621)
        cases, expected = [], []
        pairs = [("", ""), ("alpha", ""), ("a" * 300, "a" * 299 + "b"), ("😀 abc", "😀 xyz"), ("stakeholder upgrade", "stakeholder upgrade backend")]
        for pair in pairs:
            cases.append({"operation": "similarity", "data": pair})
            expected.append(similarity_ratio(*pair))
        titles = [{"summary": summary, "epicKey": epic} for summary, epic in [
            ("Customer Portal FE", "TEAM-1"), ("Customer Portal BE", "TEAM-2"),
            ("Billing migration", "TEAM-3"), ("Billing migration API", "TEAM-4"),
            ("", None), ("Support tickets", "TI-1"),
        ]]
        cases.append({"operation": "titles", "data": titles})
        expected.append(cluster_ticket_titles(titles))
        for scenario in range(60):
            sprint_rows = [{"jiraProjectKey": key, "name": key, "startDate": "2026-09-21T00:00:00Z", "endDate": end} for key, end in [
                ("TEAM", "2026-10-02T00:00:00Z"), ("TI", "2026-09-28T00:00:00Z"),
            ]]
            issues = []
            for index in range(rng.randrange(1, 18)):
                owner = rng.choice(["alex", "sam", None])
                logs = []
                for _ in range(rng.randrange(4)):
                    logs.append({"authorAccountId": rng.choice(["alex", "sam"]), "seconds": rng.choice([900, 3600, 7200, 36000]),
                                 "started": rng.choice(["2026-09-18T08:00:00Z", "2026-09-22T08:00:00Z", "2026-09-25T08:00:00Z", "2026-10-01T08:00:00Z"]), "created": "2026-10-02T09:00:00Z"})
                comments = [{"authorAccountId": rng.choice(["alex", "sam"]), "created": "2026-09-23T12:00:00Z"}] if rng.choice([True, False]) else []
                issues.append({"key": f"TEAM-{index}", "project": rng.choice(["TEAM", "TI", "NO_SPRINT"]),
                               "assignee": {"accountId": owner, "name": owner.title()} if owner else None,
                               "status": rng.choice(["To Do", "In Progress", "Blocked", "Testing", "Done"]),
                               "statusCategory": rng.choice(["new", "indeterminate", "done"]),
                               "estimateSeconds": rng.choice([None, 0, 3600, 18000]), "remainingSeconds": rng.choice([0, 7200, 90000]),
                               "spentSeconds": rng.choice([0, 7200, 18000]), "updated": "2026-09-23T00:00:00Z",
                               "worklogs": logs, "comments": comments})
            data = {"asOf": "2026-10-02T12:00:00.000Z", "trackedSprints": sprint_rows, "issues": issues,
                    "teamSeed": [{"accountId": "alex", "name": "Alex", "team": "Infrastructure", "guessed": False}],
                    "adjustments": {"alex": {"leaveDaysThisSprint": rng.choice([0, 2, 10])}, "sam": {"excluded": scenario % 7 == 0}}}
            cases.append({"operation": "metrics", "data": data})
            expected.append(compute_metrics(as_of=data["asOf"], tracked_sprints=data["trackedSprints"], issues=issues, team_seed=data["teamSeed"], adjustments=data["adjustments"]))
        result = reference_run("jira", input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=True)
        actual = json.loads(result.stdout)
        for index, (original, migrated) in enumerate(zip(actual, expected)):
            with self.subTest(case=index):
                self.assertEqual(original, migrated)
