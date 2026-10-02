import json
from unittest import TestCase

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PERSON = "11111111-1111-4111-8111-111111111111"
ROW = "22222222-2222-4222-8222-222222222222"
PAYLOAD = {"person_id": PERSON, "from_date": "2026-10-01", "to_date": "2026-10-02", "hours": 7, "notes": "fixture"}


class TeamPulseTests(TestCase):
    def setUp(self):
        self.requests = []
        self.response = httpx.Response(200, json=[{"id": ROW}])
        def handle(request):
            self.requests.append(request)
            return self.response
        settings = Settings(_env_file=None, supabase_url="https://fixture.example", supabase_anon_key="fixture-key",
                            github_actions_token="fixture-dispatch-token", github_actions_ref="abhi-imp")
        self.client = TestClient(create_app(settings, httpx.MockTransport(handle)))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_every_additional_read_uses_its_original_object(self):
        cases = [("tracked-sprints", "sprints"), ("adjustments", "adjustments"), ("open-tickets", "tickets"),
                 ("worklog-ticket-ids", "worklogs"), ("all-worklogs", "worklogs"),
                 ("planning-availability", "planning_availability"), ("next-sprint-tickets", "next_sprint_tickets"),
                 ("canonical-sprint", "v_canonical_sprint"), ("team-sprint-summaries", "v_team_sprint_summaries"),
                 ("org-sprint-summaries", "v_org_sprint_summaries")]
        for path, table in cases:
            with self.subTest(path=path):
                self.assertEqual(self.client.get("/api/" + path).json(), [{"id": ROW}])
                self.assertEqual(self.requests[-1].url.path, "/rest/v1/" + table)
                self.assertEqual(self.requests[-1].headers["authorization"], "Bearer fixture-key")
        self.client.get("/api/tracked-sprints")
        self.assertEqual(self.requests[-1].url.params["is_tracked"], "eq.true")
        self.client.get("/api/open-tickets")
        self.assertEqual(self.requests[-1].url.params["status_category"], "neq.done")

    def test_scoped_reads_preserve_dates_sprint_ids_and_history_limit(self):
        self.assertEqual(self.client.get("/api/sprint-done-tickets", params={"sprintIds": PERSON + "," + ROW}).status_code, 200)
        self.assertEqual(self.requests[-1].url.params["sprint_id"], f"in.({PERSON},{ROW})")
        self.assertEqual(self.requests[-1].url.params["status_category"], "eq.done")
        self.client.get("/api/sprint-worklogs", params={"since": "2026-10-01T00:00:00Z"})
        self.assertEqual(self.requests[-1].url.params["started_at"], "gte.2026-10-01T00:00:00+00:00")
        self.client.get("/api/person-history/" + PERSON)
        self.assertEqual(self.requests[-1].url.params["person_id"], "eq." + PERSON)
        self.assertEqual(self.requests[-1].url.params["limit"], "4")
        self.assertEqual(self.requests[-1].url.params["order"], "computed_at.desc")

    def test_invalid_scoping_never_reaches_supabase(self):
        for path in ["sprint-done-tickets?sprintIds=invalid", "sprint-done-tickets?sprintIds=", "sprint-worklogs?since=invalid", "person-history/invalid"]:
            self.assertEqual(self.client.get("/api/" + path).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_availability_create_edit_delete_use_scoped_anon_writes(self):
        self.assertEqual(self.client.post("/api/planning-availability", json=PAYLOAD).status_code, 201)
        self.assertEqual(json.loads(self.requests[-1].content), PAYLOAD)
        self.assertEqual(self.requests[-1].headers["prefer"], "return=representation")
        self.assertEqual(self.client.patch("/api/planning-availability/" + ROW, json=PAYLOAD).status_code, 200)
        self.assertEqual(self.requests[-1].url.params["id"], "eq." + ROW)
        self.assertEqual(self.requests[-1].method, "PATCH")
        self.assertEqual(self.client.delete("/api/planning-availability/" + ROW).status_code, 204)
        self.assertEqual(self.requests[-1].method, "DELETE")
        self.assertEqual(self.requests[-1].url.params["id"], "eq." + ROW)

    def test_invalid_availability_rejected_before_write(self):
        for invalid in [{"hours": 0}, {"hours": -1}, {"hours": "NaN"}, {"to_date": "2026-09-01"}, {"person_id": "invalid"}, {"id": ROW}, {"arbitrary": True}]:
            self.assertEqual(self.client.post("/api/planning-availability", json={**PAYLOAD, **invalid}).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_availability_missing_and_provider_failure_are_explicit(self):
        self.response = httpx.Response(200, json=[])
        self.assertEqual(self.client.patch("/api/planning-availability/" + ROW, json=PAYLOAD).status_code, 404)
        self.assertEqual(self.client.delete("/api/planning-availability/" + ROW).status_code, 404)
        self.response = httpx.Response(403, text="private provider message")
        result = self.client.post("/api/planning-availability", json=PAYLOAD)
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("private", result.text)

    def test_sync_dispatch_preserves_workflow_contract_without_exposing_token(self):
        self.response = httpx.Response(204)
        result = self.client.post("/api/jira-sync")
        self.assertEqual(result.status_code, 200)
        self.assertIn("triggeredAt", result.json())
        self.assertEqual(json.loads(self.requests[-1].content), {"ref": "abhi-imp", "inputs": {"sync_type": "incremental"}})
        self.assertIn("clarity-pulse-01/actions/workflows/jira-sync.yml/dispatches", str(self.requests[-1].url))
        self.response = httpx.Response(403, text="fixture-dispatch-token")
        result = self.client.post("/api/jira-sync")
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("fixture-dispatch-token", result.text)

    def test_unconfigured_sync_and_unsupported_writes(self):
        self.client.app.state.supabase.settings.github_actions_token = None
        self.assertEqual(self.client.post("/api/jira-sync").status_code, 503)
        self.assertEqual(self.client.post("/api/next-sprint-tickets", json={}).status_code, 405)
        self.assertEqual(self.requests, [])
