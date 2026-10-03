"""Materialize Vercel files only for the pinned staging branch and project."""
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[2]
FILES = {"vercel.json": "backend/vercel.json", "repository.vercelignore": ".vercelignore", "backend.vercelignore": "backend/.vercelignore"}


def prepare(repository=REPOSITORY, environment=None, clean=False):
    repository = Path(repository).resolve()
    environment = os.environ if environment is None else environment
    marker = repository / ".staging-deployment-overlay.json"
    if clean:
        if not marker.is_file():
            return
        for template, relative in FILES.items():
            destination = repository / relative
            if destination.is_file() and destination.read_bytes() == (HERE / template).read_bytes():
                destination.unlink()
        marker.unlink()
        return
    settings = json.loads((HERE / "project.json").read_text())
    if environment.get("GITHUB_REF") != "refs/heads/" + settings["branch"]:
        raise ValueError("Staging configuration requires the staging branch")
    if environment.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch"):
        raise ValueError("Unsupported staging deployment event")
    if environment.get("VERCEL_PROJECT_ID") != settings["projectId"]:
        raise ValueError("Refusing to use a different Vercel project for staging")
    linked = repository / ".vercel/project.json"
    if linked.is_file() and json.loads(linked.read_text()).get("projectId") != settings["projectId"]:
        raise ValueError("Local Vercel link points to a different project")
    for relative in FILES.values():
        if (repository / relative).exists():
            raise ValueError("Refusing to overwrite existing deployment configuration")
    for template, relative in FILES.items():
        destination = repository / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((HERE / template).read_bytes())
    marker.write_text(json.dumps({"projectId": settings["projectId"]}))


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--clean"]):
        raise SystemExit("Usage: prepare.py [--clean]")
    try:
        prepare(clean="--clean" in sys.argv)
    except ValueError as error:
        raise SystemExit(str(error)) from None
