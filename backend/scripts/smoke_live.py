"""Read-only live API parity and browser checks; never runs sync jobs."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import re
from pathlib import Path

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

        TICKET_FIELDS = "id,jira_key,summary,assignee_person_id,original_estimate_seconds,time_spent_seconds,sprint_id,is_blocked,status"
        for endpoint, table, params in [
            ("tracked-sprints", "sprints", {"select": "id,start_date", "is_tracked": "eq.true"}),
            ("adjustments", "adjustments", {"select": "person_id,leave_days_this_sprint,note"}),
            ("open-tickets", "tickets", {"select": TICKET_FIELDS, "status_category": "neq.done"}),
            ("worklog-ticket-ids", "worklogs", {"select": "ticket_id"}),
            ("all-worklogs", "worklogs", {"select": "ticket_id,author_person_id,started_at,seconds"}),
            ("planning-availability", "planning_availability", {"select": "id,person_id,from_date,to_date,hours,notes", "order": "from_date.desc"}),
            ("canonical-sprint", "v_canonical_sprint", {"select": "name,start_date,end_date", "limit": 1}),
            ("team-sprint-summaries", "v_team_sprint_summaries", {"order": "sprint_start.asc"}),
            ("org-sprint-summaries", "v_org_sprint_summaries", {"order": "sprint_start.asc"}),
            ("next-sprint-tickets", "next_sprint_tickets", {"select": "jira_key,jira_project_key,board_name,jira_sprint_id,sprint_name,sprint_start_date,sprint_end_date,sprint_goal,summary,issue_type,status,priority,assignee_person_id,assignee_name,original_estimate_seconds", "order": "jira_key.asc"}),
        ]:
            assert api(endpoint) == rows(table, **params), f"Data changed for {endpoint}"
            passed(f"Team Pulse {endpoint} query parity")
        sprint_ids = ",".join(row["id"] for row in api("tracked-sprints"))
        assert api("sprint-done-tickets", sprintIds=sprint_ids) == rows("tickets", select=TICKET_FIELDS, status_category="eq.done", sprint_id=f"in.({sprint_ids})")
        sprint_start = api("canonical-sprint")[0]["start_date"]
        normalized_start = datetime.fromisoformat(sprint_start.replace("Z", "+00:00")).isoformat()
        assert api("sprint-worklogs", since=sprint_start) == rows("worklogs", select="ticket_id,author_person_id,seconds", started_at=f"gte.{normalized_start}")
        assert api(f"person-history/{person['id']}") == rows("person_metrics_history", select="computed_at,pace_pct,bandwidth_hours,estimate_accuracy", person_id=f"eq.{person['id']}", order="computed_at.desc", limit=4)
        passed("Team Pulse sprint filters and person history parity")
        assert frontend.post("/api/clarity/planning-availability", json={}).status_code == 422
        assert frontend.post("/api/clarity/planning-availability", json={}, headers={"Origin": "https://untrusted.example"}).status_code == 403
        assert frontend.patch("/api/clarity/people", json={}).status_code == 405
        passed("availability validation and proxy origin/method boundaries")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            errors = []
            api_failures = []
            direct_database_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("response", lambda response: api_failures.append(response.status) if "/api/clarity/" in response.url and response.status >= 400 else None)
            page.on("request", lambda request: direct_database_requests.append(request.url) if config["SUPABASE_URL"] in request.url else None)
            for path, heading in [("/", "Sprint Dashboard"), ("/people", "People"), ("/projects", "Projects"), ("/planning", "Planning"), ("/next-sprint", "Next Sprint Planning"), ("/trends", "Trends")]:
                page.goto(f"{args.frontend_url}{path}")
                expect(page.get_by_role("heading", name=heading, exact=path != "/")).to_be_visible(timeout=30000)
                page.wait_for_load_state("networkidle")
                expect(page.get_by_text("Loading live data…", exact=True)).not_to_be_visible(timeout=30000)
                assert "Failed to load" not in page.locator("body").inner_text()
                passed(f"live browser page {path}")
            page.goto(f"{args.frontend_url}/people")
            page.locator("article > button").first.wait_for(timeout=30000)
            with page.expect_response(lambda response: "/api/clarity/people/" in response.url and response.status == 200):
                page.locator("article > button").first.click()
            page.wait_for_load_state("networkidle")
            page.goto(f"{args.frontend_url}/projects")
            page.locator("article > button").first.wait_for(timeout=30000)
            with page.expect_response(lambda response: "/api/clarity/projects/" in response.url and response.status == 200):
                page.locator("article > button").first.click()
            expect(page.get_by_role("heading", name="Engineering investment", exact=True)).to_be_visible(timeout=30000)
            page.wait_for_load_state("networkidle")
            assert not errors, "Browser runtime errors encountered"
            assert not api_failures, f"Browser API failures: {api_failures}"
            assert not direct_database_requests, "Browser still accessed Supabase directly"
            # Exercise the UI mutations with an in-memory provider; live rows are never changed.
            fixture_rows = []
            mutations = []

            def availability_fixture(route):
                method = route.request.method
                if method == "POST":
                    fixture_rows.append({"id": "11111111-1111-4111-8111-111111111111", **route.request.post_data_json})
                elif method == "PATCH":
                    fixture_rows[0].update(route.request.post_data_json)
                elif method == "DELETE":
                    fixture_rows.clear()
                if method != "GET":
                    mutations.append(method)
                route.fulfill(status=204 if method == "DELETE" else 201 if method == "POST" else 200,
                              content_type="application/json", body="" if method == "DELETE" else json.dumps(fixture_rows))

            page.route(re.compile(r"/api/clarity/planning-availability(?:/[^?]+)?(?:\?.*)?$"), availability_fixture)
            page.goto(f"{args.frontend_url}/planning")
            expect(page.get_by_text("No availability recorded.", exact=True)).to_be_visible(timeout=30000)
            page.get_by_role("combobox").last.click()
            page.get_by_role("option").first.click()
            dates = page.locator('input[type="date"]')
            dates.nth(0).fill("2027-01-04")
            dates.nth(1).fill("2027-01-05")
            page.get_by_placeholder("Hours", exact=True).fill("8")
            page.get_by_placeholder("Notes (optional)").fill("Browser verification fixture")
            page.get_by_role("button", name="Add", exact=True).click()
            expect(page.get_by_role("cell", name="8h", exact=True)).to_be_visible()
            expect(page.get_by_placeholder("Notes (optional)")).to_have_value("")
            expect(page.get_by_role("button", name="Add", exact=True)).to_be_enabled()
            page.get_by_role("button", name="Edit", exact=True).click()
            page.get_by_placeholder("Hours", exact=True).fill("4")
            page.get_by_role("button", name="Save changes", exact=True).click()
            expect(page.get_by_role("cell", name="4h", exact=True)).to_be_visible()
            page.get_by_role("row").filter(has_text="Browser verification fixture").get_by_role("button").last.click()
            expect(page.get_by_text("No availability recorded.", exact=True)).to_be_visible()
            assert mutations == ["POST", "PATCH", "DELETE"]
            assert not errors, "Browser runtime errors encountered during availability CRUD"
            passed("availability add/edit/delete UI with isolated browser fixtures")
            browser.close()
        passed("six Team Pulse pages and person/project detail in Chromium")
        passed("browser uses Python proxy without direct Supabase requests")
        if args.report:
            Path(args.report).write_text(json.dumps({"completed": True, "checked_at": datetime.now(timezone.utc).isoformat(), "passed": checks, "database_writes": 0}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-url", default="http://127.0.0.1:5174")
    parser.add_argument("--report")
    run(parser.parse_args())
