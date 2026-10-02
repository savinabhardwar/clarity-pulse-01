"""Refresh only linked Compass items; no Jira mutations."""

import re


async def sync_stakeholder_status(database, fetcher):
    links = database.rows("""
        SELECT l.jira_key, si.id AS item_id, si.status AS old_status
        FROM stakeholder_item_jira_links l JOIN stakeholder_items si ON si.id = l.item_id
        WHERE si.deleted_at IS NULL
    """)
    if not links:
        return {"updated": 0, "missing": []}
    keys = list(dict.fromkeys(link["jira_key"] for link in links))
    if any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*-\d+", key) for key in keys):
        raise ValueError("Invalid linked Jira key")
    statuses = {}
    for offset in range(0, len(keys), 50):
        chunk = keys[offset:offset + 50]
        issues = await fetcher.search(f"key in ({','.join(chunk)})", ["status"], max_results=len(chunk))
        for issue in issues:
            statuses[issue["key"]] = ((issue.get("fields") or {}).get("status") or {}).get("name")
    updated = 0
    with database.transaction():
        database.rows("SELECT set_config('app.current_actor', 'jira-sync', true)")
        for link in links:
            status = statuses.get(link["jira_key"])
            if status and status != link["old_status"]:
                updated += database.execute(
                    "UPDATE stakeholder_items SET status = %s, status_kind = 'jira', updated_at = now() WHERE id = %s AND deleted_at IS NULL AND status IS DISTINCT FROM %s",
                    [status, link["item_id"], status],
                )
    return {"updated": updated, "missing": [key for key in keys if key not in statuses]}
