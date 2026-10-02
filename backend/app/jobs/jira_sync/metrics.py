"""Capacity/risk derivation preserving the existing seven-hour workday policy."""

from collections import Counter

from app.jobs.jira_sync.core import iso_date, js_round, number, to_date, workdays_between


def compute_metrics(*, as_of, tracked_sprints, issues, epic_to_project_id=None, team_seed=None, adjustments=None):
    as_of = to_date(as_of)
    sprint_by_project = {row["jiraProjectKey"]: row for row in tracked_sprints}
    team_by_account = {row["accountId"]: row for row in team_seed or []}
    adjustments = adjustments or {}
    by_assignee = {}
    for issue in issues:
        if issue.get("assignee"):
            by_assignee.setdefault(issue["assignee"]["accountId"], []).append(issue)
    person_metrics, risks = [], []

    for account_id, tickets in by_assignee.items():
        adjustment = adjustments.get(account_id) or {}
        if adjustment.get("excluded"):
            continue
        projects_touched = list(dict.fromkeys(ticket["project"] for ticket in tickets))
        reference = None
        for key in projects_touched:
            sprint = sprint_by_project.get(key)
            if not sprint:
                continue
            total = workdays_between(sprint["startDate"], sprint["endDate"]) or 1
            elapsed = min(workdays_between(sprint["startDate"], as_of), total)
            remaining = max(total - elapsed, 0)
            if reference is None or remaining < reference[2]:
                reference = total, elapsed, remaining
        fallback = reference is None
        total_days, elapsed_days, remaining_days = reference or (10, 0, 10)
        leave = adjustment.get("leaveDaysThisSprint") or 0
        leave_total, leave_to_date = min(leave, total_days), min(leave, elapsed_days)
        leave_remaining = max(leave_total - leave_to_date, 0)
        target = 7 * max(total_days - leave_total, 0) or 70
        pace_target = 7 * max(elapsed_days - leave_to_date, 0) or target
        remaining_capacity = 7 * max(remaining_days - leave_remaining, 0)
        assigned_remaining = sum((ticket.get("remainingSeconds") or 0) / 3600 for ticket in tickets
                                 if ticket["statusCategory"] != "done" and (ticket.get("status") or "").lower() != "testing")

        hours, worklog_count, lag_sum, lag_count = 0, 0, 0, 0
        # Iterate the owner's tickets first, then all other tickets, matching
        # the original summation order as well as author attribution.
        others = [ticket for ticket in issues if not ticket.get("assignee") or ticket["assignee"]["accountId"] != account_id]
        for ticket in tickets + others:
            sprint = sprint_by_project.get(ticket["project"])
            for log in ticket.get("worklogs") or []:
                if log["authorAccountId"] != account_id:
                    continue
                started = to_date(log["started"])
                if sprint and not (to_date(sprint["startDate"]) <= started <= as_of):
                    continue
                hours += log["seconds"] / 3600
                worklog_count += 1
                lag_sum += workdays_between(started, log["created"])
                lag_count += 1

        wip = [ticket for ticket in tickets if ticket["statusCategory"] == "indeterminate"]
        done = [ticket for ticket in tickets if ticket["statusCategory"] == "done"]
        todo = [ticket for ticket in tickets if ticket["statusCategory"] == "new"]
        estimated = sum(ticket.get("estimateSeconds") or 0 for ticket in tickets) / 3600
        comparable = [ticket for ticket in tickets if (ticket.get("estimateSeconds") or 0) > 0 and (ticket.get("spentSeconds") or 0) > 0]
        accuracy = js_round(100 - 100 * sum(abs(ticket["spentSeconds"] - ticket["estimateSeconds"]) / ticket["estimateSeconds"] for ticket in comparable) / len(comparable)) if comparable else None
        coverage = js_round(100 * sum((ticket.get("estimateSeconds") or 0) > 0 for ticket in tickets) / len(tickets)) if tickets else None
        closed_without_logging = sum((ticket.get("estimateSeconds") or 0) > 0 and (ticket.get("spentSeconds") or 0) == 0 for ticket in done)
        comment_count = sum(comment["authorAccountId"] == account_id for ticket in tickets for comment in ticket.get("comments") or [])
        activity = [to_date(log["started"]) for ticket in tickets for log in ticket.get("worklogs") or [] if log["authorAccountId"] == account_id]
        activity += [to_date(comment["created"]) for ticket in tickets for comment in ticket.get("comments") or [] if comment["authorAccountId"] == account_id]
        idle = workdays_between(max(activity), as_of) if activity else None
        dark = [ticket for ticket in wip if not ticket.get("worklogs") and not ticket.get("comments")]
        utilisation = js_round(100 * hours / target)
        bandwidth = js_round((remaining_capacity - assigned_remaining) * 10) / 10
        pace = js_round(100 * hours / pace_target)
        lag = js_round(10 * lag_sum / lag_count) / 10 if lag_count else None
        flags = []
        if utilisation > 100:
            flags.append("Exceeded planned capacity")
        if dark:
            flags.append(f"Dark WIP on {len(dark)} ticket{'s' if len(dark) > 1 else ''}")
        if len(projects_touched) >= 3:
            flags.append(f"Split across {len(projects_touched)} projects")
        if coverage is not None and coverage < 80:
            flags.append("Estimate coverage below 80%")
        if idle is not None and idle >= 2:
            flags.append(f"{idle} idle working day{'s' if idle > 1 else ''}")
        blocked = next((ticket for ticket in tickets if "block" in ticket["status"].lower()), None)
        if blocked:
            days = workdays_between(blocked["updated"], as_of)
            if days >= 5:
                flags.append(f"Blocked {days} working days on {blocked['key']}")
        health = "at_risk" if any("Exceeded" in flag or "Blocked" in flag for flag in flags) else "needs_attention" if flags else "on_track"
        reason = None
        if utilisation > 100:
            base = f"Logged {number(js_round(hours * 10) / 10)}h against a {number(js_round(target * 10) / 10)}h"
            if len(projects_touched) > 1:
                base += f" target (reference sprint among {len(projects_touched)} touched projects: {', '.join(projects_touched)})"
            else:
                base += " sprint target"
            reason = f"{base} (currently pacing at {pace}% of plan for this point in the sprint)"
        person = team_by_account.get(account_id) or {}
        person_metrics.append({
            "accountId": account_id, "name": person.get("name") or tickets[0]["assignee"].get("name"),
            "team": person.get("team"), "teamGuessed": person.get("guessed", True),
            "utilisationPct": utilisation, "bandwidthHours": bandwidth, "pacePct": pace,
            "paceTargetHours": js_round(pace_target * 10) / 10, "hoursLogged": js_round(hours * 10) / 10,
            "estimatedHours": js_round(estimated * 10) / 10, "sprintTargetHours": js_round(target * 10) / 10,
            "velocity": len(done), "estimateAccuracy": accuracy, "estimateCoverage": coverage,
            "closedWithoutLogging": closed_without_logging, "worklogCount": worklog_count,
            "commentCount": comment_count, "idleWorkdays": idle or 0, "darkWipCount": len(dark),
            "avgLogLagDays": lag, "health": health, "riskFlags": flags,
            "targetHoursIsFallback": fallback, "overallocationReason": reason,
            "projectsTouched": projects_touched, "wipCount": len(wip), "todoCount": len(todo), "doneCount": len(done),
        })
        risk_name = person.get("name") or account_id
        if utilisation > 100:
            risks.append({"category": "overallocated", "severity": "high" if utilisation > 130 else "medium",
                          "title": f"{risk_name} is at {utilisation}% of planned capacity",
                          "recommendation": "Re-balance upcoming work or confirm the overage is expected for this sprint.",
                          "accountId": account_id, "identifiedAt": iso_date(as_of)})
        if dark:
            risks.append({"category": "dark_wip", "severity": "high" if len(dark) >= 3 else "medium",
                          "title": f"{risk_name} has {len(dark)} in-progress ticket(s) with no worklog or comment",
                          "recommendation": "Ask for a status update or worklog before relying on this ticket's progress.",
                          "accountId": account_id, "identifiedAt": iso_date(as_of)})

    standouts = []
    ranked = sorted(person_metrics, key=lambda person: -person["velocity"])
    if ranked and ranked[0]["velocity"] > 0:
        person = ranked[0]
        standouts.append({"title": "Most Tickets Closed", "accountId": person["accountId"], "detail": f"{person['velocity']} tickets closed this window", "rank": 1})
    ranked = sorted((person for person in person_metrics if person["estimateAccuracy"] is not None), key=lambda person: -person["estimateAccuracy"])
    if ranked:
        person = ranked[0]
        standouts.append({"title": "Best Estimate Accuracy", "accountId": person["accountId"], "detail": f"{person['estimateAccuracy']}% estimate accuracy", "rank": 1})
    covered = [person for person in person_metrics if person["estimateCoverage"] is not None]
    ranked = sorted(covered, key=lambda person: (-person["estimateCoverage"], person["darkWipCount"], -person["commentCount"]))
    if ranked:
        person = ranked[0]
        standouts.append({"title": "Cleanest Jira", "accountId": person["accountId"], "detail": f"{person['estimateCoverage']}% estimate coverage, {person['darkWipCount']} dark WIP, {person['commentCount']} comments", "rank": 1})
    ranked = sorted(person_metrics, key=lambda person: -person["hoursLogged"])
    if ranked:
        person = ranked[0]
        standouts.append({"title": "Highest Logged Effort", "accountId": person["accountId"], "detail": f"{number(person['hoursLogged'])}h logged this window", "rank": 1})
    avg_coverage = js_round(sum(person["estimateCoverage"] for person in covered) / len(covered)) if covered else None
    total_dark = sum(person["darkWipCount"] for person in person_metrics)
    blocked_count = sum("block" in ticket["status"].lower() and ticket["statusCategory"] != "done" for ticket in issues)
    missing_estimates = sum(not ticket.get("estimateSeconds") and ticket["statusCategory"] != "done" for ticket in issues)
    stale = 0
    for ticket in issues:
        if ticket["statusCategory"] == "done":
            continue
        touches = [to_date(ticket["updated"])]
        touches += [to_date(log["created"]) for log in ticket.get("worklogs") or []]
        touches += [to_date(comment["created"]) for comment in ticket.get("comments") or []]
        stale += workdays_between(max(touches), as_of) >= 5
    open_count = sum(ticket["statusCategory"] != "done" for ticket in issues) or 1
    with_lag = [person for person in person_metrics if person["avgLogLagDays"] is not None]
    org_health = {
        "estimateCoveragePct": avg_coverage, "blockedTickets": blocked_count,
        "darkWip": total_dark, "missingEstimates": missing_estimates,
        "closedWithoutLogs": sum(person["closedWithoutLogging"] for person in person_metrics),
        "idleEngineers": sum(person["idleWorkdays"] >= 2 for person in person_metrics),
        "avgLogLagDays": js_round(10 * sum(person["avgLogLagDays"] for person in with_lag) / len(with_lag)) / 10 if with_lag else None,
        "staleTickets": stale,
        "boardHealthScore": js_round((avg_coverage or 0) * 0.5 + (100 - min(100, 100 * blocked_count / open_count)) * 0.25 + (100 - min(100, 100 * total_dark / open_count)) * 0.25),
    }
    return {"personMetrics": person_metrics, "risks": risks, "standouts": standouts, "orgBoardHealth": org_health}
