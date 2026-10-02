"""Start each Python worker in workerd; use only local bindings and HTTP."""

import argparse
import json
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from threading import Thread
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def request(url, method="GET", data=None, headers=None):
    try:
        with urlopen(Request(url, method=method, data=data, headers=headers or {}), timeout=10) as response:
            return response.status, response.read().decode()
    except HTTPError as error:
        return error.code, error.read().decode()


def runtime_checks(provider, roles=None):
    results = []
    for index, role in enumerate(roles or ["hello-world", "ingest-git", "ingest-jira", "ingest-requirements", "process-events"]):
        port = 8790 + index
        command = [str(ROOT / ".venv/Scripts/pywrangler.exe"), "dev", "--config", f"wrangler.{role}.jsonc", "--port", str(port), "--local"] if os.name == "nt" else ["uv", "run", "pywrangler", "dev", "--config", f"wrangler.{role}.jsonc", "--port", str(port), "--local"]
        if role in {"ingest-git", "ingest-jira", "ingest-requirements"}:
            variables = {"SUPABASE_URL": provider, "SUPABASE_SERVICE_ROLE_KEY": "fixture-key", "JIRA_BASE_URL": provider,
                         "JIRA_EMAIL": "fixture@example.com", "JIRA_API_TOKEN": "fixture-jira",
                         "GITHUB_WEBHOOK_SECRET": "fixture-webhook", "INGEST_TRIGGER_SECRET": "fixture-trigger",
                         "REQUIREMENTS_APP_SUPABASE_URL": provider, "REQUIREMENTS_APP_SUPABASE_KEY": "fixture-requirements"}
            for name, value in variables.items():
                command.extend(["--var", name + ":" + value])
        with tempfile.TemporaryFile(mode="w+b") as log:
            process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                                       start_new_session=os.name != "nt")
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(f"{role} failed to start: " + log.read().decode(errors="replace")[-2500:])
                    log.seek(0)
                    if "Ready on" in log.read().decode(errors="replace"):
                        break
                    time.sleep(.5)
                else:
                    raise RuntimeError(f"{role} did not become ready")
                base = f"http://127.0.0.1:{port}"
                if role == "process-events":
                    # Queue-only entrypoint: module load validates the SDK class.
                    results.append({"worker": role, "runtime_loaded": True, "http": "queue-only"})
                    continue
                assert request(base + "/health")[0] == 200
                status, body = request(base + "/", "POST" if role == "ingest-git" else "GET", b"{}" if role == "ingest-git" else None)
                assert status == (200 if role == "hello-world" else 401), (role, status, body)
                if role == "ingest-git":
                    payload = (ROOT / "db/seed/fixtures/github-push.json").read_bytes()
                    headers = {"x-hub-signature-256": "sha256=" + hmac.new(b"fixture-webhook", payload, hashlib.sha256).hexdigest(),
                               "x-github-event": "push", "x-github-delivery": "runtime-fixture", "content-type": "application/json"}
                    assert request(base + "/", "POST", payload, headers)[0] == 200
                elif role in {"ingest-jira", "ingest-requirements"}:
                    headers = {"x-ingest-trigger-secret": "fixture-trigger"}
                    for method in ["GET", "POST"]:
                        result = request(base + "/", method, headers=headers)
                        assert result == (200, '{"enqueued":1}'), (role, result)
                assert request(base + "/openapi.json")[0] == 200
                assert request(base + "/unknown")[0] == 404
                assert request(base + "/health", "DELETE")[0] == 405
                results.append({"worker": role, "runtime_loaded": True, "checks": ["health", "root", "openapi", "404", "405"] + (["authenticated ingestion", "SDK HTTP transport", "local queue send"] if role != "hello-world" else [])})
            except Exception:
                log.seek(0)
                print(log.read().decode(errors="replace")[-7000:].encode("ascii", errors="replace").decode())
                raise
            finally:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=15)
    return {"completed": True, "remote_requests": False, "workers": results}


def run(roles=None):
    fixtures = ROOT / "db/seed/fixtures"
    def load(name):
        return json.loads((fixtures / name).read_text(encoding="utf-8"))
    jira, item = load("jira-issue.json"), load("requirements-app-item.json")
    class Provider(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def handle(self):
            try:
                super().handle()
            except ConnectionResetError:
                pass

        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path.startswith("/rest/v1/projects"):
                result = [{"id": "00000000-0000-4000-8000-000000000001", "jira_project_key": jira["fields"]["project"]["key"], "requirements_project_id": item["project_id"]}]
            elif self.path.startswith("/rest/v1/stakeholder_items"):
                result = [item]
            elif self.path.startswith("/rest/api/3/search/jql"):
                result = {"issues": [jira]}
            else:
                self.send_error(404)
                return
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        return runtime_checks(f"http://127.0.0.1:{server.server_port}", roles)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run()
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
