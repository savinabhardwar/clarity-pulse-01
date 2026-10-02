import json
from pathlib import Path
from legacy_fixtures import reference_run
from unittest import TestCase

from app.jobs.jira_sync.narratives import build_narrative, build_org_summary, clean_feature_name, sprint_activity


class NarrativeTests(TestCase):
    def test_activity_preserves_oversized_logging_and_excludes_delivery_names(self):
        rows = [{"summary": "Fix: Customer portal - FE", "status_category": "done", "original_estimate_seconds": 3600,
                 "remaining_estimate_seconds": 0, "seconds_logged_since": "1800", "has_worklog_since": True, "has_comment_since": False},
                {"summary": "Large feature", "status_category": "indeterminate", "original_estimate_seconds": 200000,
                 "remaining_estimate_seconds": 200000, "seconds_logged_since": "3600", "has_worklog_since": True, "has_comment_since": False},
                {"summary": "Untouched", "status_category": "indeterminate", "original_estimate_seconds": 3600,
                 "remaining_estimate_seconds": 3600, "seconds_logged_since": 0, "has_worklog_since": False, "has_comment_since": False}]
        activity = sprint_activity(rows)
        self.assertEqual(activity["hoursLoggedSinceStart"], 1.5)
        self.assertEqual(activity["hoursRemainingSinceStart"], 0)
        self.assertEqual(activity["deliveredThisSprint"], ["Customer portal"])
        self.assertEqual(len(activity["needsBreakdown"]), 1)

    def test_narratives_match_original_templates_and_risk_priority(self):
        cases, expected = [], []
        for health in ["on_track", "needs_attention", "at_risk"]:
            for logged in [0, 1.5, 30.2]:
                project = {"id": "fixture", "name": "Portal", "health": health, "blocked_tickets": 4,
                           "closed_tickets": 3, "started_at": "2026-09-01", "sprint_goal": None,
                           "purpose": None, "roadmap_status": None, "roadmap_go_live": "October", "roadmap_key_benefit": None}
                activity = {"hoursLoggedSinceStart": logged, "hoursRemainingSinceStart": 80,
                            "needsBreakdown": [{}, {}, {}], "deliveredThisSprint": ["Portal"]}
                metrics = {"avg_utilisation": 72.5, "estimate_coverage": None, "total_spillage_hours": 12.5}
                names = ["[Backend] fix: portal rendering (gateway)", "Task: User  portal - API", "(ui)", ""]
                data = {"project": project, "activity": activity, "metrics": metrics,
                        "history": [["Sprint 1", ["Portal"]]], "projects": [project], "names": names}
                result = build_narrative(project, data["history"], activity)
                del result["generated_at"]
                expected.append({"narrative": result, "org": build_org_summary(metrics, [project]), "names": [clean_feature_name(name) for name in names]})
                cases.append({"operation": "narrative", "data": data})
        result = reference_run("jira", input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertEqual(json.loads(result.stdout), expected)
