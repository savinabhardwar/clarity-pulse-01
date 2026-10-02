from datetime import date
import json
from pathlib import Path
import random
from legacy_fixtures import reference_run
from unittest import TestCase

from app.jobs.jira_sync.snapshots import build_leave_by_person_day, compute_for_person, expected_hours


class SnapshotTests(TestCase):
    def test_leave_is_inclusive_additive_weekend_safe_and_capped_per_day(self):
        leave = build_leave_by_person_day([
            {"person_id": "p", "from_date": "2026-09-25", "to_date": "2026-09-28", "hours": "4"},
            {"person_id": "p", "from_date": "2026-09-28", "to_date": "2026-09-28", "hours": "8"},
            {"person_id": "p", "from_date": "2026-09-30", "to_date": "2026-09-29", "hours": "7"},
        ])
        self.assertEqual(leave["p"][date(2026, 9, 28)], 12)
        self.assertEqual(expected_hours("2026-09-25", "2026-09-28", leave["p"]), 3)

    def test_snapshot_scores_match_legacy_across_varied_fixtures(self):
        rng = random.Random(3017)
        cases, expected = [], []
        stamps = ["2026-09-18T08:00:00Z", "2026-09-23T08:00:00Z", "2026-09-25T08:00:00Z"]
        comment_texts = ["", "@Alex please review", "TBD this ticket still needs attention", "Customer portal now works correctly after the rendering fix", "Identical detailed update copied into several separate tickets", "Landscape irrigation requires inspection before the rain arrives tomorrow"]
        for _ in range(60):
            tickets, logs, comments = [], [], []
            for index in range(rng.randrange(0, 15)):
                ticket_id = str(index)
                tickets.append({"id": ticket_id, "jira_key": f"KH-{index}", "summary": "Customer portal rendering",
                                "assignee_person_id": rng.choice(["p", "q", None]), "qa_assignee_person_id": rng.choice(["p", "q", None]),
                                "qa_planned_seconds": rng.choice([0, 1800, 3600]), "sprint_id": "s", "epic_id": rng.choice([None, "epic"]),
                                "original_estimate_seconds": rng.choice([None, 0, 3600, 7200, 200000]),
                                "time_spent_seconds": rng.choice([0, 3600, 10000]), "is_blocked": rng.choice([True, False]),
                                "status_category": rng.choice(["new", "indeterminate", "done"]),
                                "created_at": stamps[0], "updated_at": rng.choice(stamps), "resolved_at": rng.choice([None, *stamps])})
                for _ in range(rng.randrange(3)):
                    logs.append({"ticket_id": ticket_id, "author_person_id": rng.choice(["p", "q"]), "seconds": rng.choice([600, 3600, 8000]), "started_at": rng.choice(stamps)})
                if rng.choice([True, False]):
                    comments.append({"ticket_id": ticket_id, "author_person_id": rng.choice(["p", "q"]), "created_at": rng.choice(stamps), "body_excerpt": rng.choice(comment_texts)})
            window_logs = [row for row in logs if row["started_at"] >= "2026-09-21"]
            window_comments = [row for row in comments if row["created_at"] >= "2026-09-21"]
            leave_hours = rng.choice([0, 3, 7, 12])
            meta = {row["id"]: {"jiraKey": row["jira_key"], "summary": row["summary"]} for row in tickets}
            data = {"personId": "p", "tickets": tickets, "worklogs": window_logs, "allWorklogsForTickets": logs,
                    "comments": comments, "commentsInWindow": window_comments, "ticketMetaById": meta,
                    "sprintStart": "2026-09-21T00:00:00Z", "sprintEnd": "2026-09-25T23:00:00Z",
                    "nameBySprintId": {"s": "Sprint fixture"}, "leaveByPersonDay": {"p": {"2026-09-23T00:00:00.000Z": leave_hours}}}
            cases.append({"operation": "snapshot", "data": data})
            expected.append(compute_for_person(person_id="p", tickets=tickets, worklogs=window_logs,
                                              all_worklogs_for_tickets=logs, comments=comments, comments_in_window=window_comments,
                                              ticket_meta_by_id=meta, sprint_start=data["sprintStart"], sprint_end=data["sprintEnd"],
                                              name_by_sprint_id={"s": "Sprint fixture"}, leave_by_person_day={"p": {date(2026, 9, 23): leave_hours}}))
        result = reference_run("jira", input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=True)
        actual = json.loads(result.stdout)
        self.assertEqual(len(actual), len(expected))
        for index, (original, migrated) in enumerate(zip(actual, expected)):
            with self.subTest(case=index):
                self.assertEqual(original, migrated)
