"""FastAPI HTTP endpoints shared by local development and Python Workers."""

import hmac
import json

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
import httpx

from ai_pm.config import Config
from ai_pm.events import normalize_pull_request, normalize_push, verify_signature
from ai_pm.service import ProviderFailure, Service, Unconfigured


def create_app(config=None, *, queue=None, kv=None, transport=None, client_factory=None, role=None):
    config = config or Config()
    application = FastAPI(title="ClarityPulse automation", version="0.1.0")

    async def service(request: Request):
        env = request.scope.get("env")
        active_config = Config.from_bindings(env) if env is not None else config
        active_queue = queue
        if env is not None:
            from ai_pm.worker_transport import BindingQueue
            active_queue = BindingQueue(env.EVENTS_QUEUE)
        factory = client_factory or (lambda: httpx.AsyncClient(timeout=30, transport=transport))
        async with factory() as client:
            yield Service(active_config, client, active_queue)

    @application.exception_handler(Unconfigured)
    async def unavailable(request, error):
        return PlainTextResponse("service is not configured", status_code=503)

    @application.exception_handler(ProviderFailure)
    async def upstream(request, error):
        return PlainTextResponse("upstream operation failed", status_code=502)

    @application.exception_handler(httpx.HTTPError)
    async def network(request, error):
        return PlainTextResponse("upstream unavailable", status_code=502)

    @application.exception_handler(Exception)
    async def unexpected(request, error):
        # Report exception type and code locations, without provider responses
        # or credentials that exception messages can contain.
        import traceback
        frames = traceback.extract_tb(error.__traceback__)
        print("Unexpected " + type(error).__name__ + ": " + " -> ".join(frame.name + ":" + str(frame.lineno) for frame in frames))
        return PlainTextResponse("internal server error", status_code=500)

    @application.get("/health", tags=["health"])
    async def health():
        return {"status": "ok"}

    async def hello(request: Request):
        binding = request.scope.get("env")
        namespace = binding.FEATURE_FLAGS if binding is not None else kv
        status = await namespace.get("status") if namespace is not None else None
        return PlainTextResponse("ai-pm-platform hello-world: " + (status if status is not None else "(no 'status' key set in KV)"))

    async def ingest_git(request: Request, backend: Service = Depends(service)):
        body = await request.body()
        if not backend.config.github_webhook_secret:
            raise HTTPException(503, "GitHub webhook secret is not configured")
        if not verify_signature(body, backend.config.github_webhook_secret, request.headers.get("x-hub-signature-256")):
            return PlainTextResponse("invalid signature", status_code=401)
        event_type, delivery = request.headers.get("x-github-event"), request.headers.get("x-github-delivery")
        if not event_type or not delivery:
            return PlainTextResponse("missing GitHub event headers", status_code=400)
        if event_type == "ping":
            return PlainTextResponse("pong")
        if event_type not in {"push", "pull_request"}:
            return PlainTextResponse("ignored event type: " + event_type)
        try:
            payload = json.loads(body)
            normalized = normalize_push(payload, delivery) if event_type == "push" else [normalize_pull_request(payload, delivery)]
        except (ValueError, TypeError, KeyError, AttributeError):
            return PlainTextResponse("invalid GitHub payload", status_code=400)
        for event in normalized:
            project_id = await backend.resolve_project(event["source"], event["projectHint"])
            if project_id is not None:
                try:
                    await backend.enqueue(event, project_id)
                except ValueError:
                    return PlainTextResponse("invalid GitHub event", status_code=400)
        return PlainTextResponse("ok")

    async def authorize_poll(request, backend):
        secret = backend.config.ingest_trigger_secret
        if not secret:
            raise HTTPException(503, "Ingest trigger secret is not configured")
        supplied = request.headers.get("x-ingest-trigger-secret", "")
        if not hmac.compare_digest(supplied.encode(), secret.encode()):
            raise HTTPException(401, "unauthorized")

    async def ingest_jira(request: Request, window_minutes: int = Query(10, alias="windowMinutes", ge=1, le=10080), backend: Service = Depends(service)):
        await authorize_poll(request, backend)
        return await backend.poll_jira(window_minutes)

    async def ingest_requirements(request: Request, window_minutes: int = Query(10, alias="windowMinutes", ge=1, le=10080), backend: Service = Depends(service)):
        await authorize_poll(request, backend)
        return await backend.poll_requirements(window_minutes)

    if role is None:
        application.add_api_route("/hello", hello, methods=["GET"])
        application.add_api_route("/ingest/git", ingest_git, methods=["POST"])
        for method in ["GET", "POST"]:
            application.add_api_route("/ingest/jira", ingest_jira, methods=[method], operation_id="ingest_jira_" + method.lower())
            application.add_api_route("/ingest/requirements", ingest_requirements, methods=[method], operation_id="ingest_requirements_" + method.lower())
    else:
        handler = {"hello-world": hello, "ingest-git": ingest_git, "ingest-jira": ingest_jira,
                   "ingest-requirements": ingest_requirements}.get(role)
        if handler is None:
            raise ValueError("Unknown HTTP worker role")
        methods = ["GET"] if role == "hello-world" else ["POST"] if role == "ingest-git" else ["GET", "POST"]
        for method in methods:
            application.add_api_route("/", handler, methods=[method], operation_id=role.replace("-", "_") + "_" + method.lower())
    return application
