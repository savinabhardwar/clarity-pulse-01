"""Read-only live API parity and browser checks; never runs sync jobs."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from urllib.parse import urlencode

from dotenv import dotenv_values
import httpx
from playwright.sync_api import sync_playwright, expect


def run(args):
    config = dotenv_values(Path(__file__).resolve().parents[1] / ".env.local")
    key = config["SUPABASE_ANON_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    checks = []

    def passed(name):
        checks.append(name)
        print(f"PASS {name}", flush=True)

    with httpx.Client(base_url=args.frontend_url, timeout=40) as frontend, httpx.Client(
        base_url=f"{config['SUPABASE_URL'].rstrip('/')}/rest/v1/", headers=headers, timeout=30,
    ) as database:
        def api(path, **params):
            response = frontend.get(f"/api/clarity/{path}", params=params)
            assert response.status_code == 200, f"API {path} failed: {response.status_code}"
            return response.json()

        def rows(resource, **params):
            response = database.get(resource, params={"select": "*", **params})
            assert response.status_code == 200, f"Baseline {resource} failed: {response.status_code}"
            return response.json()

        for endpoint, view, params in [
            ("people", "v_people_overview", {"order": "utilisation_pct.desc"}),
            ("projects", "v_projects_overview", {"order": "hours_invested.desc"}),
            ("allocations", "v_person_allocations", {}),
            ("standouts", "v_standouts", {}),
            ("blockers", "v_all_blockers", {"order": "days_blocked.desc"}),
            ("ticket-hygiene", "v_ticket_hygiene", {"order": "person_name.asc"}),
            ("recent-activity", "v_recent_activity", {"order": "occurred_at.desc", "limit": 15}),
            ("top-risks", "v_top_risks", {}),
            ("teams", "teams", {"order": "name.asc"}),
            ("project-contributors", "v_person_allocations", {"select": "person_id,project_id,pct,hours"}),
        ]:
            assert api(endpoint) == rows(view, **params), f"Data changed for {endpoint}"
            passed(f"{endpoint} matches original Supabase query")
        assert api("org-metrics") == rows("v_org_metrics")[0]
        passed("organization metrics match original Supabase query")

        people = api("people")
        projects = api("projects")
        assert people and projects, "Live detail checks need existing people and projects"
        person = people[0]
        project = next((row for row in projects if row["is_current"]), projects[0])
        for path, rpc, payload in [
            (f"people/{person['id']}", "get_person_detail", {"p_person_id": person["id"]}),
            (f"projects/{project['slug']}", "get_project_detail", {"p_slug": project["slug"]}),
        ]:
            response = database.post(f"rpc/{rpc}", json=payload)
            assert response.status_code == 200
            assert api(path) == response.json()
        passed("person and project detail RPC parity")
        assert api("allocations", personId=person["id"]) == rows("v_person_allocations", person_id=f"eq.{person['id']}")
        assert api("allocations", projectId=project["id"]) == rows("v_person_allocations", project_id=f"eq.{project['id']}")
        passed("person and project allocation scoping")

        as_of = (datetime.now(timezone.utc) - timedelta(days=5)).replace(microsecond=0).isoformat()
        response = database.post("rpc/get_people_overview_asof", json={"p_asof": as_of}, params={"order": "utilisation_pct.desc"})
        assert response.status_code == 200
        assert api("people", asOf=as_of) == response.json()
        assert api("recent-activity", since=as_of) == rows("v_recent_activity", occurred_at=f"gte.{as_of}", order="occurred_at.desc", limit=100)
        passed("historical people and date-filtered activity parity")

        def count(table, **filters):
            response = database.head(table, params={"select": "*", **filters}, headers={"Prefer": "count=exact"})
            assert response.status_code == 200
            return int(response.headers["Content-Range"].rsplit("/", 1)[1])

        overruns = count("risks", category="eq.sprint_overrun", status="eq.open")
        assert api("sprint-overrun-count") == overruns
        assert api("tracked-sprint-status") == {"total": count("sprints", is_tracked="eq.true"), "overrunning": overruns}
        passed("exact sprint and overrun counts")

        for path in ["people?asOf=bad", "people/not-a-uuid", "allocations?personId=bad"]:
            assert frontend.get(f"/api/clarity/{path}").status_code == 422
        assert frontend.get("/api/clarity/rpc/arbitrary").status_code == 404
        assert frontend.post("/api/clarity/people", json={}).status_code == 405
        passed("validation and read-only proxy boundary")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            errors = []
            api_failures = []
            direct_database_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("response", lambda response: api_failures.append(response.status) if "/api/clarity/" in response.url and response.status >= 400 else None)
            page.on("request", lambda request: direct_database_requests.append(request.url) if config["SUPABASE_URL"] in request.url else None)
            for path, heading in [("/", "Overview"), ("/people", "People"), ("/projects", "Projects"), ("/resource-planning", "Resource Planning"), ("/team-health", "Team Health")]:
                page.goto(f"{args.frontend_url}{path}")
                expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible(timeout=30000)
                expect(page.get_by_text("Couldn't load this data", exact=True)).not_to_be_visible()
                page.wait_for_load_state("networkidle")
            page.goto(f"{args.frontend_url}/people?{urlencode({'person': person['id']})}")
            expect(page.get_by_role("heading", name="Project allocation", exact=True)).to_be_visible(timeout=30000)
            page.wait_for_load_state("networkidle")
            page.goto(f"{args.frontend_url}/projects?{urlencode({'project': project['slug'], 'view': project['project_space']})}")
            expect(page.get_by_role("heading", name=project["name"], exact=True)).to_be_visible(timeout=30000)
            page.wait_for_load_state("networkidle")
            assert not errors, "Browser runtime errors encountered"
            assert not api_failures, f"Browser API failures: {api_failures}"
            assert not direct_database_requests, "Browser still accessed Supabase directly"
            browser.close()
        passed("five dashboard pages and person/project detail in Chromium")
        passed("browser uses Python proxy without direct Supabase requests")
        if args.report:
            Path(args.report).write_text(json.dumps({"completed": True, "checked_at": datetime.now(timezone.utc).isoformat(), "passed": checks, "database_writes": 0}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-url", default="http://127.0.0.1:5174")
    parser.add_argument("--report")
    run(parser.parse_args())
