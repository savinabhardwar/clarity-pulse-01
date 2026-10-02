"""Python scheduled Jira pipeline, using the same ordered stages as before."""

import argparse
import asyncio
import json
from pathlib import Path

import httpx
import psycopg2

from app.jobs.config import JobSettings
from app.jobs.database import Database
from app.jobs.jira_sync.core import assignee_project_counts, cluster_epics, iso_date, team_seed
from app.jobs.jira_sync.fetch import JiraFetcher
from app.jobs.jira_sync.maintenance import flag_inactive_people, purge_closed_sprint_tickets, purge_old_planning_availability, smoke_test
from app.jobs.jira_sync.narratives import generate_narratives
from app.jobs.jira_sync.next_sprint import sync_next_sprint
from app.jobs.jira_sync.snapshots import snapshot_closed_sprints
from app.jobs.jira_sync.stakeholders import sync_stakeholder_status
from app.jobs.jira_sync.sync import run_cached


def validate_settings(settings):
    fields = ["jira_base_url", "jira_email", "jira_api_token", "database_url"]
    missing = [name.upper() for name in fields if not getattr(settings, name)]
    if missing:
        raise RuntimeError("Missing required environment variable(s): " + ", ".join(missing))


async def connect_database(settings, connect=Database.connect, sleep=asyncio.sleep):
    """Retry initial pooler failures; never replay a partially executed pipeline."""
    for attempt in range(3):
        try:
            database = connect(settings)
            try:
                database.rows("SELECT 1 AS ready")
            except Exception:
                database.close()
                raise
            return database
        except psycopg2.OperationalError:
            if attempt == 2:
                raise
            await sleep(2 * 2 ** attempt)


def last_watermark(database):
    try:
        rows = database.rows("SELECT watermark_after FROM sync_runs WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1")
    except psycopg2.errors.UndefinedTable:
        return None
    value = rows[0]["watermark_after"] if rows else None
    return iso_date(value) if value else None


def derive_cache(cache_dir, generated_dir):
    cache_dir, generated_dir = Path(cache_dir), Path(generated_dir)
    def rows(name):
        return [json.loads(line) for line in (cache_dir / name).read_text(encoding="utf-8").splitlines() if line.strip()]
    counts = assignee_project_counts(rows("issues.raw.jsonl"))
    projects = cluster_epics(rows("epics.raw.jsonl"))
    teams = team_seed(counts)
    generated_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "assignee-project-counts.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    (generated_dir / "projects.json").write_text(json.dumps(projects, indent=2), encoding="utf-8")
    (generated_dir / "teams.seed.json").write_text(json.dumps(teams, indent=2), encoding="utf-8")


async def run_pipeline(database, fetcher, cache_dir, generated_dir, sync_type="manual"):
    watermark = last_watermark(database) if sync_type == "incremental" else None
    fetched = await fetcher.fetch_all(cache_dir, watermark)
    derive_cache(cache_dir, generated_dir)
    stages = {"fetch": {key: value for key, value in fetched.items() if key != "trackedSprints"}}
    stages["sync"] = run_cached(database, cache_dir, generated_dir, sync_type=sync_type)
    stages["narratives"] = generate_narratives(database)
    stages["snapshots"] = snapshot_closed_sprints(database)
    stages["inactivePeople"] = flag_inactive_people(database)
    stages["ticketCleanup"] = purge_closed_sprint_tickets(database)
    stages["leaveCleanup"] = purge_old_planning_availability(database)
    # These independent refreshes were nonfatal in the existing pipeline.
    # Keep their errors visible without exposing credentials/provider payloads.
    for name, job in [("stakeholders", sync_stakeholder_status), ("nextSprint", sync_next_sprint)]:
        try:
            stages[name] = await job(database, fetcher)
        except Exception as error:
            stages[name] = {"failed": True, "errorType": type(error).__name__}
    stages["health"] = smoke_test(database)
    if not stages["health"]["ok"]:
        raise RuntimeError("Sync smoke test failed: " + "; ".join(stages["health"]["problems"]))
    return stages


async def main(args):
    settings = JobSettings()
    validate_settings(settings)
    database = await connect_database(settings)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            stages = await run_pipeline(database, JiraFetcher(settings, client), args.cache_dir, args.generated_dir,
                                        "full" if args.full else "incremental" if args.incremental else "manual")
        # Counts/statuses only: do not log person names or provider data.
        stages["inactivePeople"] = {"flaggedCount": len(stages["inactivePeople"]["flagged"])}
        print(json.dumps(stages))
    finally:
        database.close()


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3] / "jobs/jira-sync"
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--full", action="store_true")
    mode.add_argument("--incremental", action="store_true")
    parser.add_argument("--cache-dir", type=Path, default=root / "cache")
    parser.add_argument("--generated-dir", type=Path, default=root / "generated")
    asyncio.run(main(parser.parse_args()))
