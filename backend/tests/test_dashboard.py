"""Offline boundary tests: dashboard semantics, validation, and transport errors."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PERSON_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "22222222-2222-4222-8222-222222222222"


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.responses = []
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings(_env_file=None, supabase_url="https://db.example", supabase_anon_key="anon-test-key")

        def handle(request):
            self.requests.append(request)
            if not self.responses:
                raise AssertionError("Unexpected external call")
            response = self.responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        stack = ExitStack()
        self.addCleanup(stack.close)
        self.client = stack.enter_context(TestClient(create_app(settings, httpx.MockTransport(handle))))

    def reply(self, value):
        self.responses.append(httpx.Response(200, json=value))

    def test_latest_people_keep_database_order_and_raw_health(self):
        rows = [{"id": PERSON_ID, "health": "needs_attention", "utilisation_pct": 110}]
        self.reply(rows)
        self.assertEqual(self.client.get("/api/people").json(), rows)
        request = self.requests[-1]
        self.assertEqual(request.url.path, "/rest/v1/v_people_overview")
        self.assertEqual(request.url.params["order"], "utilisation_pct.desc")
        self.assertEqual(request.headers["authorization"], "Bearer anon-test-key")

    def test_historical_people_use_asof_rpc_and_same_sort(self):
        self.reply([{"id": PERSON_ID, "hours_logged": 12}])
        response = self.client.get("/api/people", params={"asOf": "2026-09-30T23:59:59Z"})
        self.assertEqual(response.status_code, 200)
        request = self.requests[-1]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/rest/v1/rpc/get_people_overview_asof")
        self.assertEqual(json.loads(request.content), {"p_asof": "2026-09-30T23:59:59+00:00"})
        self.assertEqual(request.url.params["order"], "utilisation_pct.desc")

    def test_person_and_project_detail_use_verified_rpc_inputs(self):
        self.reply({"id": PERSON_ID, "current": [], "upcoming": [], "completed": []})
        response = self.client.get(f"/api/people/{PERSON_ID}")
        self.assertEqual(response.json()["current"], [])
        self.assertEqual(json.loads(self.requests[-1].content), {"p_person_id": PERSON_ID})
        self.reply({"id": PROJECT_ID, "initiatives": [], "delivered": []})
        self.assertEqual(self.client.get("/api/projects/my-project").status_code, 200)
        self.assertEqual(self.requests[-1].url.path, "/rest/v1/rpc/get_project_detail")
        self.assertEqual(json.loads(self.requests[-1].content), {"p_slug": "my-project"})

    def test_missing_detail_keeps_null_rpc_response(self):
        self.reply(None)
        response = self.client.get(f"/api/people/{PERSON_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json())

    def test_allocations_apply_optional_person_and_project_scope(self):
        self.reply([])
        self.assertEqual(self.client.get("/api/allocations").json(), [])
        self.assertNotIn("person_id", self.requests[-1].url.params)
        self.reply([])
        self.client.get("/api/allocations", params={"personId": PERSON_ID, "projectId": PROJECT_ID})
        self.assertEqual(self.requests[-1].url.params["person_id"], f"eq.{PERSON_ID}")
        self.assertEqual(self.requests[-1].url.params["project_id"], f"eq.{PROJECT_ID}")

    def test_contributor_projection_does_not_fetch_allocation_labels(self):
        self.reply([])
        self.client.get("/api/project-contributors")
        self.assertEqual(self.requests[-1].url.params["select"], "person_id,project_id,pct,hours")

    def test_projects_blockers_hygiene_and_teams_preserve_sorting(self):
        for endpoint, table, order in [
            ("projects", "v_projects_overview", "hours_invested.desc"),
            ("blockers", "v_all_blockers", "days_blocked.desc"),
            ("ticket-hygiene", "v_ticket_hygiene", "person_name.asc"),
            ("teams", "teams", "name.asc"),
        ]:
            with self.subTest(endpoint=endpoint):
                self.reply([])
                self.assertEqual(self.client.get(f"/api/{endpoint}").json(), [])
                self.assertEqual(self.requests[-1].url.path, f"/rest/v1/{table}")
                self.assertEqual(self.requests[-1].url.params["order"], order)

    def test_metrics_require_exactly_one_row(self):
        self.reply([{"blocked_count": 3}])
        self.assertEqual(self.client.get("/api/org-metrics").json(), {"blocked_count": 3})
        for data in [[], [{}, {}]]:
            self.reply(data)
            self.assertEqual(self.client.get("/api/org-metrics").status_code, 502)

    def test_activity_default_and_date_filtered_limits(self):
        self.reply([])
        self.client.get("/api/recent-activity")
        params = self.requests[-1].url.params
        self.assertEqual(params["limit"], "15")
        self.assertNotIn("occurred_at", params)
        self.reply([])
        self.client.get("/api/recent-activity", params={"since": "2026-09-01T00:00:00Z"})
        params = self.requests[-1].url.params
        self.assertEqual(params["limit"], "100")
        self.assertEqual(params["occurred_at"], "gte.2026-09-01T00:00:00+00:00")
        self.assertEqual(params["order"], "occurred_at.desc")

    def test_count_uses_exact_head_request_and_open_risk_filter(self):
        self.responses.append(httpx.Response(200, headers={"Content-Range": "*/7"}))
        self.assertEqual(self.client.get("/api/sprint-overrun-count").json(), 7)
        request = self.requests[-1]
        self.assertEqual(request.method, "HEAD")
        self.assertEqual(request.headers["prefer"], "count=exact")
        self.assertEqual(request.url.params["category"], "eq.sprint_overrun")
        self.assertEqual(request.url.params["status"], "eq.open")

    def test_tracked_status_counts_tracked_sprints_and_overruns(self):
        self.responses.extend([httpx.Response(200, headers={"Content-Range": "*/5"}), httpx.Response(200, headers={"Content-Range": "*/2"})])
        self.assertEqual(self.client.get("/api/tracked-sprint-status").json(), {"total": 5, "overrunning": 2})
        self.assertEqual(self.requests[0].url.params["is_tracked"], "eq.true")
        self.assertEqual(self.requests[1].url.params["status"], "eq.open")

    def test_invalid_counts_are_errors_instead_of_false_zeroes(self):
        for headers in [{}, {"Content-Range": "*/unknown"}, {"Content-Range": "*/-1"}]:
            self.responses.append(httpx.Response(200, headers=headers))
            self.assertEqual(self.client.get("/api/sprint-overrun-count").status_code, 502)

    def test_bad_filters_and_ids_do_not_reach_database(self):
        for url in ["/api/people/not-a-uuid", "/api/people?asOf=bad", "/api/allocations?personId=bad", "/api/allocations?projectId=bad", "/api/recent-activity?since=bad"]:
            self.assertEqual(self.client.get(url).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_database_failures_do_not_expose_upstream_response(self):
        for status in [401, 403, 500]:
            self.responses.append(httpx.Response(status, text="private upstream credential details"))
            response = self.client.get("/api/people")
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("private", response.text)
        self.responses.append(httpx.ConnectError("private host"))
        self.assertEqual(self.client.get("/api/people").json(), {"detail": "Supabase is unavailable"})

    def test_malformed_database_json_or_row_shape_is_rejected(self):
        self.responses.append(httpx.Response(200, text="not json"))
        self.assertEqual(self.client.get("/api/people").status_code, 502)
        self.reply({"unexpected": "object"})
        self.assertEqual(self.client.get("/api/people").status_code, 502)

    def test_api_does_not_expose_arbitrary_rpc_or_mutation_routes(self):
        self.assertEqual(self.client.post("/api/people", json={}).status_code, 405)
        self.assertEqual(self.client.post("/api/rpc/arbitrary", json={}).status_code, 404)
        self.assertEqual(self.requests, [])

    def test_missing_configuration_keeps_health_available(self):
        # Preserve OS variables required by Windows/OpenSSL; only application
        # configuration is absent in this scenario.
        with patch.dict(os.environ):
            os.environ.pop("SUPABASE_URL", None)
            os.environ.pop("SUPABASE_ANON_KEY", None)
            with TestClient(create_app(Settings(_env_file=None))) as client:
                self.assertEqual(client.get("/api/health").json(), {"status": "ok"})
                self.assertEqual(client.get("/api/people").status_code, 503)

    def test_environment_is_backend_scoped_and_secret_is_redacted(self):
        path = Path(Settings.model_config["env_file"])
        self.assertEqual(path.parent.name, "backend")
        with patch.dict(os.environ, {"SUPABASE_URL": "https://override.example", "SUPABASE_ANON_KEY": "private-test-key"}, clear=True):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.supabase_url, "https://override.example")
        self.assertNotIn("private-test-key", repr(settings))
