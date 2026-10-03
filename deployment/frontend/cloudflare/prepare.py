"""Prepare an explicit Cloudflare frontend target after building Nitro."""
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[2]


def prepare(repository=REPOSITORY, environment=None):
    repository = Path(repository).resolve()
    environment = os.environ if environment is None else environment
    ref = environment.get("GITHUB_REF")
    target = {"refs/heads/main": "production", "refs/heads/staging": "staging"}.get(ref)
    if target is None or environment.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch"):
        raise ValueError("Frontend deployment requires a main or staging push/manual run")
    worker = environment.get("CLOUDFLARE_FRONTEND_WORKER_NAME", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", worker):
        raise ValueError("Set a valid environment-specific frontend Worker name")
    if worker.endswith("-staging") != (target == "staging"):
        raise ValueError("Only staging Worker names may end with -staging")
    account = environment.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ValueError("Set the Cloudflare account ID for this environment")
    url = environment.get("FRONTEND_BACKEND_URL", "").rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise ValueError("Backend URL must be an HTTPS service origin")
    settings = json.loads((HERE / "service.json").read_text())
    staging_url = settings["stagingBackendUrl"]
    if target == "staging" and url != staging_url:
        raise ValueError("Staging frontend must use its dedicated staging API")
    if target == "production" and (url == staging_url or "staging" in parsed.hostname or parsed.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("Production frontend cannot use a staging or local API")
    server = repository / "frontend/.output/server"
    public = repository / "frontend/.output/public"
    if not (server / "index.mjs").is_file() or not public.is_dir():
        raise ValueError("Build the Cloudflare frontend before preparing deployment")
    build = repository / "frontend/.output/nitro.json"
    if not build.is_file() or json.loads(build.read_text()).get("preset") != "cloudflare-module":
        raise ValueError("The frontend must be built for Cloudflare Workers")
    config = json.loads((HERE / "wrangler.json").read_text())
    config.update(name=worker, account_id=account)
    config["main"] = "index.mjs"
    config["assets"]["directory"] = "../public"
    config["vars"] = {settings["backendVariable"]: url}
    destination = server / ("wrangler." + target + ".json")
    destination.write_text(json.dumps(config, indent=2) + "\n")
    return destination


if __name__ == "__main__":
    try:
        print(prepare().relative_to(REPOSITORY).as_posix())
    except ValueError as error:
        raise SystemExit(str(error)) from None
