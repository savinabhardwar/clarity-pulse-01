import hashlib
import hmac
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
import httpx

from ai_pm.api import create_app
from ai_pm.config import Config
from ai_pm.events import normalize_jira, normalize_pull_request, normalize_push, normalize_requirement, verify_signature
from ai_pm.service import Service, backoff_seconds, process_batch

PROJECT_ID = "00000000-0000-4000-8000-000000000001"
FIXTURES = Path(__file__).resolve().parents[1] / "db/seed/fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def config(**extra):
    values = {"supabase_url": "https://automation.example", "supabase_service_role_key": "fixture-service",
              "github_webhook_secret": "fixture-secret", "ingest_trigger_secret": "fixture-trigger",
              "jira_base_url": "https://jira.example", "jira_email": "fixture@example.com", "jira_api_token": "fixture-token",
              "requirements_app_supabase_url": "https://compass.example", "requirements_app_supabase_key": "fixture-anon"}
    return Config(**{**values, **extra})


def signed(body):
    return "sha256=" + hmac.new(b"fixture-secret", body, hashlib.sha256).hexdigest()


class AutomationAPITests(IsolatedAsyncioTestCase):
    def test_every_http_endpoint_and_documentation_is_registered(self):
        with TestClient(create_app(config())) as client:
            for path in ["/health", "/hello", "/docs", "/redoc", "/openapi.json"]:
                self.assertEqual(client.get(path).status_code, 200, path)
            spec = client.get("/openapi.json").json()
            for path, methods in {"/health": ["get"], "/hello": ["get"], "/ingest/git": ["post"], "/ingest/jira": ["get", "post"], "/ingest/requirements": ["get", "post"]}.items():
                self.assertTrue(set(methods).issubset(spec["paths"][path]), path)
            self.assertEqual(client.get("/ingest/git").status_code, 405)

    def test_hello_reads_configured_kv_and_has_missing_key_fallback(self):
        with TestClient(create_app(config(), kv=SimpleNamespace(get=AsyncMock(return_value="shadow")))) as client:
            self.assertEqual(client.get("/hello").text, "ai-pm-platform hello-world: shadow")
        with TestClient(create_app(config())) as client:
            self.assertIn("no 'status' key", client.get("/hello").text)

    def test_invalid_signature_rejects_before_json_parsing_or_provider_access(self):
        queue = AsyncMock()
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(lambda request: self.fail("unauthorized provider access")))) as client:
            for signature in [None, "sha1=abc", "sha256=xyz", "sha256=" + "a" * 64]:
                headers = {"x-hub-signature-256": signature} if signature else {}
                self.assertEqual(client.post("/ingest/git", content=b"not-json", headers=headers).status_code, 401)
        queue.send.assert_not_awaited()

    def test_signed_ping_ignored_events_missing_headers_and_malformed_payload(self):
        body = b"not-json"
        transport = httpx.MockTransport(lambda request: self.fail("ping/ignored event accessed provider"))
        with TestClient(create_app(config(), transport=transport)) as client:
            headers = {"x-hub-signature-256": signed(body)}
            self.assertEqual(client.post("/ingest/git", content=body, headers=headers).status_code, 400)
            headers.update({"x-github-delivery": "delivery", "x-github-event": "ping"})
            self.assertEqual(client.post("/ingest/git", content=body, headers=headers).text, "pong")
            headers["x-github-event"] = "issues"
            self.assertEqual(client.post("/ingest/git", content=body, headers=headers).status_code, 200)
            headers["x-github-event"] = "push"
            self.assertEqual(client.post("/ingest/git", content=body, headers=headers).status_code, 400)

    def test_signed_push_and_pull_request_enqueue_only_configured_projects(self):
        queue, requests = AsyncMock(), []
        def handler(request):
            requests.append(request)
            self.assertEqual(request.url.params["limit"], "1")
            self.assertEqual(request.headers["apikey"], "fixture-service")
            return httpx.Response(200, json=[{"id": PROJECT_ID}])
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(handler))) as client:
            for kind, name in [("push", "github-push.json"), ("pull_request", "github-pull-request.json")]:
                body = json.dumps(fixture(name), ensure_ascii=False).encode("utf-8")
                headers = {"x-hub-signature-256": signed(body), "x-github-delivery": "delivery", "x-github-event": kind}
                self.assertEqual(client.post("/ingest/git", content=body, headers=headers).status_code, 200)
        self.assertEqual(queue.send.await_count, len(fixture("github-push.json")["commits"]) + 1)
        for call in queue.send.call_args_list:
            self.assertEqual(call.args[0]["projectId"], PROJECT_ID)
            self.assertEqual(call.args[0]["source"], "github")
        empty = AsyncMock()
        body = json.dumps(fixture("github-push.json")).encode()
        with TestClient(create_app(config(), queue=empty, transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[])))) as client:
            self.assertEqual(client.post("/ingest/git", content=body, headers={"x-hub-signature-256": signed(body), "x-github-delivery": "d", "x-github-event": "push"}).status_code, 200)
        empty.send.assert_not_awaited()

    def test_missing_secret_or_queue_fails_closed(self):
        with TestClient(create_app(Config())) as client:
            self.assertEqual(client.post("/ingest/git").status_code, 503)
            self.assertEqual(client.post("/ingest/jira").status_code, 503)
        body = json.dumps(fixture("github-push.json")).encode()
        with TestClient(create_app(config(), transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[{"id": PROJECT_ID}])))) as client:
            self.assertEqual(client.post("/ingest/git", content=body, headers={"x-hub-signature-256": signed(body), "x-github-event": "push", "x-github-delivery": "d"}).status_code, 503)

    def test_poll_authorization_and_window_validation_for_both_methods(self):
        with TestClient(create_app(config(), transport=httpx.MockTransport(lambda request: self.fail("unauthorized polling")))) as client:
            for path in ["/ingest/jira", "/ingest/requirements"]:
                for method in [client.get, client.post]:
                    self.assertEqual(method(path).status_code, 401)
                    for invalid in ["0", "-1", "nan", "1.5", "10081"]:
                        self.assertEqual(method(path + "?windowMinutes=" + invalid, headers={"x-ingest-trigger-secret": "fixture-trigger"}).status_code, 422)

    def test_jira_poll_paginated_get_and_post_enqueue_snapshots(self):
        queue, requests = AsyncMock(), []
        issue = fixture("jira-issue.json")
        def handler(request):
            requests.append(request)
            if request.url.host == "automation.example":
                return httpx.Response(200, json=[{"id": PROJECT_ID, "jira_project_key": "LT"}])
            self.assertIn("updated >= -15m", request.url.params["jql"])
            if "nextPageToken" not in request.url.params:
                return httpx.Response(200, json={"issues": [issue], "nextPageToken": "page-2"})
            return httpx.Response(200, json={"issues": [], "isLast": True})
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(handler))) as client:
            for method in [client.get, client.post]:
                response = method("/ingest/jira?windowMinutes=15", headers={"x-ingest-trigger-secret": "fixture-trigger"})
                self.assertEqual(response.json(), {"enqueued": 1})
        self.assertEqual(queue.send.await_count, 2)
        self.assertEqual(queue.send.call_args.args[0]["providerEventId"], issue["id"] + ":" + issue["fields"]["updated"])

    def test_requirements_poll_get_and_post_maps_project_and_uses_own_connection(self):
        queue = AsyncMock()
        item = fixture("requirements-app-item.json")
        def handler(request):
            if request.url.host == "automation.example":
                return httpx.Response(200, json=[{"id": PROJECT_ID, "requirements_project_id": item["project_id"]}])
            self.assertEqual(request.url.host, "compass.example")
            self.assertEqual(request.headers["apikey"], "fixture-anon")
            self.assertEqual(request.url.params["project_id"], 'in.("' + item["project_id"] + '")')
            return httpx.Response(200, json=[item, {**item, "project_id": None}])
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(handler))) as client:
            for method in [client.get, client.post]:
                self.assertEqual(method("/ingest/requirements", headers={"x-ingest-trigger-secret": "fixture-trigger"}).json(), {"enqueued": 1})
        self.assertEqual(queue.send.await_count, 2)

    def test_upstream_failures_are_sanitized_and_no_empty_poll_writes(self):
        queue = AsyncMock()
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(lambda request: httpx.Response(500, text="private service-key detail")))) as client:
            response = client.get("/ingest/jira", headers={"x-ingest-trigger-secret": "fixture-trigger"})
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("private", response.text)
        with TestClient(create_app(config(), queue=queue, transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[])))) as client:
            for path in ["/ingest/jira", "/ingest/requirements"]:
                self.assertEqual(client.get(path, headers={"x-ingest-trigger-secret": "fixture-trigger"}).json(), {"enqueued": 0})
        queue.send.assert_not_awaited()

    def test_individual_workers_keep_root_paths_and_method_contracts(self):
        for role in ["hello-world", "ingest-git", "ingest-jira", "ingest-requirements"]:
            with TestClient(create_app(config(), role=role)) as client:
                self.assertEqual(client.get("/health").status_code, 200)
                self.assertIn("/", client.get("/openapi.json").json()["paths"])

    async def test_queue_processor_calls_atomic_rpc_and_handles_duplicates(self):
        requests = []
        responses = iter([True, False])
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json=next(responses))
        event = {**normalize_jira(fixture("jira-issue.json")), "projectId": PROJECT_ID}
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = Service(config(), client, None)
            self.assertEqual(await service.process(event), {"processed": True})
            self.assertEqual(await service.process(event), {"processed": False})
        self.assertTrue(all(request.url.path.endswith("/rpc/process_queued_event") for request in requests))
        self.assertEqual(json.loads(requests[0].content)["p_event"], event)

    async def test_queue_batch_isolates_failure_and_applies_explicit_backoff(self):
        service = SimpleNamespace(process=AsyncMock(side_effect=[RuntimeError("bad event"), {"processed": True}]))
        messages = [SimpleNamespace(id=str(index), attempts=2, body={}, ack=AsyncMock(), retry=AsyncMock()) for index in range(2)]
        # The runtime's ack/retry methods are synchronous; use plain mocks.
        from unittest.mock import Mock
        for message in messages:
            message.ack, message.retry = Mock(), Mock()
        outcomes = await process_batch(messages, service)
        messages[0].retry.assert_called_once_with(60)
        messages[0].ack.assert_not_called()
        messages[1].ack.assert_called_once()
        self.assertEqual(outcomes[1]["acknowledged"], True)
        self.assertEqual(backoff_seconds(20), 900)

    def test_signature_checks_exact_utf8_bytes_and_secret_repr_is_redacted(self):
        body = '{"message":"café"}'.encode("utf-8")
        self.assertTrue(verify_signature(body, "fixture-secret", signed(body)))
        self.assertFalse(verify_signature(body + b" ", "fixture-secret", signed(body)))
        self.assertNotIn("fixture-secret", repr(config()))
        self.assertNotIn("fixture-token", repr(config()))
