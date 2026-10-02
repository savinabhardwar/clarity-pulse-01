"""Pure sync transformations; no network or database side effects."""

from collections import Counter
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import math
import re

UTC = timezone.utc
TITLE_TOKENS = {"fe", "be", "ui", "api", "frontend", "backend", "front-end", "back-end"}
EPIC_TOKENS = TITLE_TOKENS | {"front", "back", "design", "bugs", "bug", "testing", "tests", "test", "cases", "improvement", "improvements"}
PROJECT_NAMES = {
    "TEAM": "Team-PixelBlinders", "TI": "Team - Infrastructure", "TEAMSANKYA": "Team Sankya",
    "TT": "Team - Telephony", "TRG": "Team RUMA GPT", "QIP": "QIP", "PBX": "PBX Manager",
    "KA": "Keyboardless Agent", "CP": "CX Pass", "UM": "Usage Monitoring", "AMY": "Amy(17E Pro)",
    "CX": "CX Omnichannel", "ACX": "ACX", "AA": "Agent Assist", "KH": "Knowledge Hub",
    "AV": "AVANI", "LT": "Line Tester", "BL": "Billing", "MR": "MI Reporting", "FR": "Forecasting",
}


def js_round(value):
    """Preserve JS Math.round (Python round uses ties-to-even)."""
    return math.floor(value + 0.5)


def number(value):
    return format(value, ".15g")


def to_date(value):
    if isinstance(value, datetime):
        result = value
    elif value:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    else:
        return None
    return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)


def iso_date(value):
    return to_date(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def workdays_between(start, end):
    start, end = to_date(start), to_date(end)
    if not start or not end:
        raise ValueError("Workday calculation requires both dates")
    if end <= start:
        return 0
    current, end_day = start.date(), end.date()
    count = 0
    while current < end_day:
        current += timedelta(days=1)
        count += current.weekday() < 5
    return count


def workdays_inclusive(start, end):
    return workdays_between(to_date(start) - timedelta(days=1), end)


def similarity_ratio(first, second):
    # The original JS matcher indexes UTF-16 units. Keep that convention,
    # including supplementary characters, while using Python's difflib.
    def units(text):
        raw = text.encode("utf-16-le", errors="surrogatepass")
        return [raw[index:index + 2] for index in range(0, len(raw), 2)]
    return SequenceMatcher(None, units(first), units(second), autojunk=False).ratio()


def normalize_title(title, tokens=TITLE_TOKENS):
    return " ".join(word for word in re.sub(r"[^a-z0-9\s-]", " ", title.lower()).split() if word not in tokens)


def groups(rows, should_merge):
    parent = list(range(len(rows)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for first in range(len(rows)):
        for second in range(first + 1, len(rows)):
            if find(first) != find(second) and should_merge(rows[first], rows[second]):
                parent[find(first)] = find(second)
    result = {}
    for index, row in enumerate(rows):
        result.setdefault(find(index), []).append(row)
    return list(result.values())


def cluster_ticket_titles(tickets):
    normalized = [{**ticket, "_norm": normalize_title(ticket["summary"]) or ticket["summary"].lower()} for ticket in tickets]
    result = []
    for members in groups(normalized, lambda a, b: similarity_ratio(a["_norm"], b["_norm"]) >= 0.72):
        representative = min(members, key=lambda row: (len(row["summary"].strip()), row["summary"].casefold()))
        result.append({"name": representative["summary"].strip(), "tickets": members,
                       "epicKeys": list(dict.fromkeys(row["epicKey"] for row in members if row.get("epicKey")))})
    return result


def assignee_project_counts(issues):
    accounts = {}
    for issue in issues:
        assignee = issue.get("assignee")
        if not assignee:
            continue
        row = accounts.setdefault(assignee["accountId"], {"accountId": assignee["accountId"], "name": assignee.get("name"), "counts": Counter()})
        row["counts"][issue["project"]] += 1
    return [{"accountId": row["accountId"], "name": row["name"],
             "projectCounts": [{"project": project, "count": count} for project, count in sorted(row["counts"].items(), key=lambda pair: -pair[1])]}
            for row in accounts.values()]


def team_seed(counts):
    people = []
    for row in counts:
        total = sum(project["count"] for project in row["projectCounts"])
        if not total:
            raise ValueError("Cannot derive a team from empty project counts")
        top = row["projectCounts"][0]
        split = len(row["projectCounts"]) > 1 and top["count"] / total < 0.85
        if split:
            shares = ", ".join(f"{project['project']}:{project['count']}" for project in row["projectCounts"])
            reason = f"Ticket split across {shares} this sprint — team guessed from majority project, needs human confirmation"
        else:
            reason = f"All {total} of this sprint's tickets are in {top['project']} — team guessed from Jira project, needs human confirmation"
        person = {"accountId": row["accountId"], "name": row["name"], "guessed": True, "guessReason": reason}
        # JS omitted undefined team names when serializing unknown projects.
        if top["project"] in PROJECT_NAMES:
            person["team"] = PROJECT_NAMES[top["project"]]
        people.append(person)
    return {"note": "Every entry is a GUESS pending human correction — Jira has no team field.", "people": people}


def cluster_epics(epics, generated_at=None):
    normalized = []
    for epic in epics:
        core = normalize_title(epic["summary"], EPIC_TOKENS) or epic["summary"].lower().strip()
        generic = bool(re.search(r"^(?:support tickets?$|support ticket requests?$|backlog\b)", core, re.I))
        normalized.append({**epic, "core": core, "generic": generic, "clusterKey": f"{epic['project']}::{core}" if generic else core})
    clusters = groups(normalized, lambda a, b: a["clusterKey"] == b["clusterKey"] or (
        not a["generic"] and not b["generic"] and similarity_ratio(a["core"], b["core"]) >= 0.72))
    projects, used = [], set()
    for members in clusters:
        if len(members) > 1 and len({member["core"] for member in members}) == 1:
            names = []
            for token in members[0]["core"].split():
                votes = Counter()
                for member in members:
                    cleaned = re.sub(r"[^a-z0-9\s-]", " ", member["summary"].lower()).split()
                    original = member["summary"].split()
                    if token in cleaned:
                        index = cleaned.index(token)
                        if index < len(original):
                            votes[original[index]] += 1
                names.append(votes.most_common(1)[0][0] if votes else token.capitalize())
            display = " ".join(names)
        else:
            member = min(members, key=lambda row: (len(row["summary"].strip()), row["summary"].casefold()))
            display = " ".join(member["summary"].split())
        base = re.sub(r"[^a-z0-9]+", "-", display.lower()).strip("-")
        project_id, suffix = base or "project", 2
        while project_id in used:
            project_id = f"{base}-{suffix}"
            suffix += 1
        used.add(project_id)
        cutoff = to_date("2026-06-01T00:00:00Z")
        projects.append({"id": project_id, "name": display,
                         "current": any(member.get("updated") and to_date(member["updated"]) >= cutoff for member in members),
                         "jiraProjects": sorted({member["project"] for member in members}),
                         "epics": sorted([{key: member.get(key) for key in ("key", "summary", "status", "updated")} for member in members], key=lambda row: row["key"].casefold())})
    projects.sort(key=lambda row: (-len(row["epics"]), row["name"].casefold()))
    return {"generatedAt": iso_date(generated_at or datetime.now(UTC)), "similarityThreshold": 0.72, "overrides": {}, "projects": projects}
