"""Confluence schedule table format, dates and configured product folders."""

from datetime import date
import re

RELEASE_SCHEDULE_PAGE_ID = "529104897"
RELEASE_NOTES_ROOT_PAGE_ID = "523730946"
SPACE_ID = "73072653"
PRODUCTS = [
    {"product": name, "parentPageId": page, "jiraKey": key}
    for name, page, key in [
        ("QIP", "523894786", "QIP"), ("Amy", "524451841", "AMY"),
        ("CX Omni", "524484609", "CX"), ("Knowledge Hub", "523927555", "KH"),
        ("Agent Assist", "524288002", "AA"), ("Keyboardless Agent", "524550145", "KA"),
        ("AVANI", "523763714", "AV"), ("Forecasting", "524615681", "FR"),
        ("Automated MIS", "524386306", "MR"), ("ACX Improvements", "523960322", "ACX"),
        ("CX Pass", "523763734", "CP"), ("PBX Manager", "524681217", "PBX"),
        ("Billing", "524386326", "BL"),
    ]
]
COLUMNS = ["product", "jiraKey", "lastReleaseDate", "nextReleaseDate"]
MONTHS = "January February March April May June July August September October November December".split()


def product_config(name):
    return next((row for row in PRODUCTS if row["product"] == name), None)


def escape_html(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def parse_schedule(body):
    rows = []
    for matched in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", body):
        cells = [re.sub(r"<[^>]+>", "", cell).replace("&amp;", "&").strip()
                 for cell in re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", matched[1])]
        if cells:
            rows.append(cells)
    return [{column: "" if (value := cells[index].strip() if index < len(cells) else "") == "-" else value
             for index, column in enumerate(COLUMNS)} for cells in rows[1:]]


def render_table(rows):
    header = "<tr>" + "".join(f"<th><p>{name}</p></th>" for name in ["Product", "Jira Key", "Last Release Date", "Next Release Date"]) + "</tr>"
    body = "".join("<tr>" + "".join(f"<td><p>{escape_html(row.get(column) or '')}</p></td>" for column in COLUMNS) + "</tr>" for row in rows)
    return f'<table data-layout="default"><tbody>{header}{body}</tbody></table>'


def find_due_releases(rows, today):
    date.fromisoformat(today)
    due = []
    for row in rows:
        if not row["nextReleaseDate"] or row["nextReleaseDate"] > today or not row["lastReleaseDate"]:
            continue
        config = product_config(row["product"])
        if config:
            due.append({**config, "lastReleaseDate": row["lastReleaseDate"]})
    return due


def bullets_to_html(markdown):
    blocks, items = [], []
    def flush():
        if items:
            blocks.append("<ul>" + "".join(items) + "</ul>")
            items.clear()
    for line in (line.strip() for line in markdown.splitlines()):
        if not line:
            continue
        heading = re.match(r"^#{2,3}\s+(.*)$", line)
        if heading:
            flush()
            blocks.append(f"<h2>{escape_html(heading[1])}</h2>")
            continue
        bullet = re.match(r"^[-*]\s+\*\*(.+?)\*\*\s*[—:-]\s*(.*)$", line)
        if bullet:
            items.append(f"<li><p><strong>{escape_html(bullet[1])}</strong> — {escape_html(bullet[2])}</p></li>")
        else:
            items.append("<li><p>" + escape_html(re.sub(r"^[-*]\s*", "", line)) + "</p></li>")
    flush()
    return "".join(blocks)


def build_title(product, since, until):
    def short(value):
        parsed = date.fromisoformat(value)
        return f"{parsed.day} {MONTHS[parsed.month - 1]}"
    return f"{product} Release Notes: {short(since)} - {short(until)}"


def build_body_html(product, since, markdown):
    parsed = date.fromisoformat(since)
    long_date = f"{MONTHS[parsed.month - 1]} {parsed.day}, {parsed.year}"
    return f"<h1>{escape_html(product)} Release Notes</h1><h3>Since {long_date}</h3>" + bullets_to_html(markdown)


def completeness_note(issue):
    fields = issue["fields"]
    def done(other):
        return (((other.get("fields") or {}).get("status") or {}).get("statusCategory") or {}).get("key") == "done"
    notes = []
    subtasks = [row["key"] for row in fields.get("subtasks") or [] if not done(row)]
    if subtasks:
        notes.append("pending subtask(s): " + ", ".join(subtasks))
    linked = []
    for link in fields.get("issuelinks") or []:
        kind = link.get("type") or {}
        if kind.get("name") in {"Duplicate", "Cloners"}:
            continue
        other = link.get("inwardIssue") or link.get("outwardIssue")
        if other and not done(other):
            relation = kind.get("inward" if link.get("inwardIssue") else "outward") or "linked to"
            linked.append(f"{relation} {other['key']} (still open)")
    if linked:
        notes.append("; ".join(linked))
    return "; ".join(notes) or None
