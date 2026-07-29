import { workdaysBetween } from "./workdays.mjs";

const HOURS_PER_WORKDAY_SPRINT = 8; // 8h/workday -> 80h per person per 2-week (10-workday) sprint

function toDate(s) {
  return s ? new Date(s) : null;
}

function hasWord(status, word) {
  return status.toLowerCase().includes(word);
}

/**
 * @param {object} input
 * @param {Date} input.asOf
 * @param {Array} input.trackedSprints  [{jiraProjectKey, name, startDate, endDate}]
 * @param {Array} input.issues          in-window tickets across the 5 tracked sprints
 * @param {Map}   input.epicToProjectId jiraEpicKey -> project slug (or null)
 * @param {Array} input.teamSeed        [{accountId, name, team, guessed, guessReason}]
 * @param {object} input.adjustments    { [accountId]: { leaveDaysThisSprint, excluded } }
 */
export function computeMetrics({ asOf, trackedSprints, issues, epicToProjectId, teamSeed, adjustments = {} }) {
  const sprintByProject = new Map(trackedSprints.map((s) => [s.jiraProjectKey, s]));
  const teamByAccount = new Map(teamSeed.map((t) => [t.accountId, t]));

  // ---- Group issues by assignee ----
  const byAssignee = new Map();
  for (const issue of issues) {
    if (!issue.assignee) continue;
    const key = issue.assignee.accountId;
    if (!byAssignee.has(key)) byAssignee.set(key, []);
    byAssignee.get(key).push(issue);
  }

  const personMetrics = [];
  const risks = [];

  for (const [accountId, tickets] of byAssignee) {
    const adj = adjustments[accountId] || {};
    if (adj.excluded) continue;

    // A person has ONE job's worth of capacity, and each tracked sprint
    // is independently a full 8h/day commitment (not weighted down by
    // ticket count). When someone touches more than one currently-active
    // sprint, the one with the FEWEST remaining workdays is their
    // reference sprint -- the most conservative "one calendar" a person
    // actually has, until sprints across projects share the same
    // start/end dates.
    const ticketCountByProject = new Map();
    for (const t of tickets) ticketCountByProject.set(t.project, (ticketCountByProject.get(t.project) || 0) + 1);
    const projectsTouched = [...ticketCountByProject.keys()];
    const FALLBACK_SPRINT_WORKDAYS = 10; // assumed 2-week sprint when no tracked dates exist

    let referenceSprint = null; // {totalWorkdays, elapsedWorkdays, remainingWorkdays}
    for (const pk of projectsTouched) {
      const sprint = sprintByProject.get(pk);
      if (!sprint) continue;
      const start = toDate(sprint.startDate);
      const end = toDate(sprint.endDate);
      const totalWorkdays = workdaysBetween(start, end) || 1;
      const elapsedWorkdays = Math.min(workdaysBetween(start, asOf), totalWorkdays);
      const remainingWorkdays = Math.max(totalWorkdays - elapsedWorkdays, 0);
      if (!referenceSprint || remainingWorkdays < referenceSprint.remainingWorkdays) {
        referenceSprint = { totalWorkdays, elapsedWorkdays, remainingWorkdays };
      }
    }
    // Lower-confidence signal: none of this person's projects had tracked
    // sprint dates to prorate against, so their target is a flat guess
    // rather than derived from real sprint windows. Assumed "just
    // started" (full runway ahead) rather than "just ended", a neutral
    // default absent any real date to go on.
    const matchedAnySprint = referenceSprint !== null;
    const targetHoursIsFallback = !matchedAnySprint;
    const totalWorkdays = matchedAnySprint ? referenceSprint.totalWorkdays : FALLBACK_SPRINT_WORKDAYS;
    const elapsedWorkdays = matchedAnySprint ? referenceSprint.elapsedWorkdays : 0;
    const remainingWorkdays = matchedAnySprint ? referenceSprint.remainingWorkdays : FALLBACK_SPRINT_WORKDAYS;

    const leaveDaysTotal = Math.min(adj.leaveDaysThisSprint || 0, totalWorkdays);
    const leaveDaysToDate = Math.min(adj.leaveDaysThisSprint || 0, elapsedWorkdays);
    const leaveDaysRemaining = Math.max(leaveDaysTotal - leaveDaysToDate, 0);

    // Two targets, both surfaced, since they answer different questions:
    // - sprintTargetHours: the FULL sprint commitment -- "how much of my
    //   sprint commitment is done", the headline utilisation %.
    // - paceTargetHours: prorated to elapsed workdays so far -- "am I on
    //   pace right now", a secondary check meaningful mid-sprint.
    let sprintTargetHours = HOURS_PER_WORKDAY_SPRINT * Math.max(totalWorkdays - leaveDaysTotal, 0);
    let paceTargetHours = HOURS_PER_WORKDAY_SPRINT * Math.max(elapsedWorkdays - leaveDaysToDate, 0);
    if (sprintTargetHours === 0) sprintTargetHours = HOURS_PER_WORKDAY_SPRINT * FALLBACK_SPRINT_WORKDAYS;
    if (paceTargetHours === 0) paceTargetHours = sprintTargetHours; // sprint just started or fallback

    // ---- Remaining capacity: forward-looking, for bandwidth --
    // "how much spare room is there before sprint end, given what's
    // still outstanding" -- not "target minus logged so far". An
    // already-ended (overrun) sprint naturally contributes 0 here,
    // unlike the full-sprint target above.
    const remainingCapacityHours = HOURS_PER_WORKDAY_SPRINT * Math.max(remainingWorkdays - leaveDaysRemaining, 0);
    const assignedRemainingWorkHours = tickets
      .filter((t) => t.statusCategory !== "done")
      .reduce((s, t) => s + (t.remainingSeconds || 0) / 3600, 0);

    // ---- Hours logged: sum of worklog seconds credited to this person
    // as WORKLOG AUTHOR (not assignee), across ALL their worklogs on
    // ANY in-window ticket regardless of who it's assigned to. Scoped to
    // worklogs actually STARTED within that ticket's own tracked sprint
    // window -- a ticket sitting in the currently-open sprint can carry
    // months of old worklogs from earlier sprints, which would otherwise
    // all get credited to this sprint's utilisation. Tickets whose
    // project has no tracked sprint (fallback case, already flagged via
    // targetHoursIsFallback) count every worklog, since there's no
    // window to scope against. ----
    let hoursLogged = 0;
    let worklogCount = 0;
    let logLagDaysSum = 0;
    let logLagCount = 0;
    function inSprintWindow(t, wl) {
      const sprint = sprintByProject.get(t.project);
      if (!sprint) return true;
      const started = new Date(wl.started);
      return started >= toDate(sprint.startDate) && started <= asOf;
    }
    for (const t of tickets) {
      for (const wl of t.worklogs || []) {
        if (wl.authorAccountId !== accountId) continue;
        if (!inSprintWindow(t, wl)) continue;
        hoursLogged += wl.seconds / 3600;
        worklogCount++;
        const lag = workdaysBetween(new Date(wl.started), new Date(wl.created));
        logLagDaysSum += lag;
        logLagCount++;
      }
    }
    // Also pick up worklogs this person logged on tickets assigned to
    // OTHER people (still credited to them as the author).
    for (const other of issues) {
      if (other.assignee && other.assignee.accountId === accountId) continue;
      for (const wl of other.worklogs || []) {
        if (wl.authorAccountId !== accountId) continue;
        if (!inSprintWindow(other, wl)) continue;
        hoursLogged += wl.seconds / 3600;
        worklogCount++;
        const lag = workdaysBetween(new Date(wl.started), new Date(wl.created));
        logLagDaysSum += lag;
        logLagCount++;
      }
    }

    // ---- Ownership-bucket metrics: credited to ASSIGNEE ----
    const wip = tickets.filter((t) => t.statusCategory === "indeterminate");
    const done = tickets.filter((t) => t.statusCategory === "done");
    const todo = tickets.filter((t) => t.statusCategory === "new");
    const estimatedHours = tickets.reduce((s, t) => s + (t.estimateSeconds || 0), 0) / 3600;

    const withEstimateAndSpent = tickets.filter((t) => t.estimateSeconds > 0 && t.spentSeconds > 0);
    const estimateAccuracy =
      withEstimateAndSpent.length === 0
        ? null
        : Math.round(
            100 -
              (100 *
                withEstimateAndSpent.reduce(
                  (s, t) => s + Math.abs(t.spentSeconds - t.estimateSeconds) / t.estimateSeconds,
                  0,
                )) /
                withEstimateAndSpent.length,
          );
    const estimateCoverage = Math.round((100 * tickets.filter((t) => t.estimateSeconds > 0).length) / (tickets.length || 1));
    const closedWithoutLogging = done.filter((t) => (t.estimateSeconds || 0) > 0 && (t.spentSeconds || 0) === 0).length;

    let commentCount = 0;
    for (const t of tickets) commentCount += (t.comments || []).filter((c) => c.authorAccountId === accountId).length;

    // ---- Idle days: working days since this person's most recent
    // worklog OR comment on any of their in-window tickets. ----
    let lastActivity = null;
    for (const t of tickets) {
      for (const wl of t.worklogs || []) {
        if (wl.authorAccountId === accountId) {
          const d = new Date(wl.started);
          if (!lastActivity || d > lastActivity) lastActivity = d;
        }
      }
      for (const c of t.comments || []) {
        if (c.authorAccountId === accountId) {
          const d = new Date(c.created);
          if (!lastActivity || d > lastActivity) lastActivity = d;
        }
      }
    }
    const idleWorkdays = lastActivity ? workdaysBetween(lastActivity, asOf) : null;

    // ---- Dark WIP: in-progress ticket, assigned to them, with NO
    // worklog AND no comment since cutoff (nobody has said anything
    // about work they own). ----
    const darkWip = wip.filter((t) => {
      const hasWorklog = (t.worklogs || []).length > 0;
      const hasComment = (t.comments || []).length > 0;
      return !hasWorklog && !hasComment;
    });

    const utilisationPct = Math.round((100 * hoursLogged) / sprintTargetHours);
    const bandwidthHours = Math.round((remainingCapacityHours - assignedRemainingWorkHours) * 10) / 10;
    const pacePct = Math.round((100 * hoursLogged) / paceTargetHours);
    const avgLogLagDays = logLagCount ? Math.round((10 * logLagDaysSum) / logLagCount) / 10 : null;

    const riskFlags = [];
    if (utilisationPct > 100) riskFlags.push("Exceeded planned capacity");
    if (darkWip.length > 0) riskFlags.push(`Dark WIP on ${darkWip.length} ticket${darkWip.length > 1 ? "s" : ""}`);
    if (projectsTouched.length >= 3) riskFlags.push(`Split across ${projectsTouched.length} projects`);
    if (estimateCoverage < 80) riskFlags.push("Estimate coverage below 80%");
    if (idleWorkdays !== null && idleWorkdays >= 2) riskFlags.push(`${idleWorkdays} idle working day${idleWorkdays > 1 ? "s" : ""}`);
    const longBlocked = tickets.find((t) => hasWord(t.status, "block"));
    if (longBlocked) {
      const days = workdaysBetween(new Date(longBlocked.updated), asOf);
      if (days >= 5) riskFlags.push(`Blocked ${days} working days on ${longBlocked.key}`);
    }

    const highSeverityCount = riskFlags.filter((f) => f.includes("Exceeded") || f.includes("Blocked")).length;
    const health = highSeverityCount > 0 ? "at_risk" : riskFlags.length > 0 ? "needs_attention" : "on_track";

    // A concrete, human reason for crossing 100% -- someone touching
    // several projects still has one reference sprint's worth of target
    // (see above), so this is a plain single-target overage regardless
    // of project count. Pace is mentioned too since a full-sprint
    // overage can look very different from the day-by-day pace (e.g.
    // genuinely ahead of schedule vs. cramming).
    let overallocationReason = null;
    if (utilisationPct > 100) {
      const base =
        projectsTouched.length > 1
          ? `Logged ${Math.round(hoursLogged * 10) / 10}h against a ${Math.round(sprintTargetHours * 10) / 10}h target (reference sprint among ${projectsTouched.length} touched projects: ${projectsTouched.join(", ")})`
          : `Logged ${Math.round(hoursLogged * 10) / 10}h against a ${Math.round(sprintTargetHours * 10) / 10}h sprint target`;
      overallocationReason = `${base} (currently pacing at ${pacePct}% of plan for this point in the sprint)`;
    }

    const person = teamByAccount.get(accountId);

    personMetrics.push({
      accountId,
      name: person?.name || tickets[0]?.assignee?.name,
      team: person?.team ?? null,
      teamGuessed: person?.guessed ?? true,
      utilisationPct,
      bandwidthHours,
      pacePct,
      paceTargetHours: Math.round(paceTargetHours * 10) / 10,
      hoursLogged: Math.round(hoursLogged * 10) / 10,
      estimatedHours: Math.round(estimatedHours * 10) / 10,
      sprintTargetHours: Math.round(sprintTargetHours * 10) / 10,
      velocity: done.length,
      estimateAccuracy,
      estimateCoverage,
      closedWithoutLogging,
      worklogCount,
      commentCount,
      idleWorkdays: idleWorkdays ?? 0,
      darkWipCount: darkWip.length,
      avgLogLagDays,
      health,
      riskFlags,
      targetHoursIsFallback,
      overallocationReason,
      projectsTouched,
      wipCount: wip.length,
      todoCount: todo.length,
      doneCount: done.length,
    });

    if (utilisationPct > 100) {
      risks.push({
        category: "overallocated",
        severity: utilisationPct > 130 ? "high" : "medium",
        title: `${person?.name || accountId} is at ${utilisationPct}% of planned capacity`,
        recommendation: "Re-balance upcoming work or confirm the overage is expected for this sprint.",
        accountId,
        identifiedAt: asOf,
      });
    }
    if (darkWip.length > 0) {
      risks.push({
        category: "dark_wip",
        severity: darkWip.length >= 3 ? "high" : "medium",
        title: `${person?.name || accountId} has ${darkWip.length} in-progress ticket(s) with no worklog or comment`,
        recommendation: "Ask for a status update or worklog before relying on this ticket's progress.",
        accountId,
        identifiedAt: asOf,
      });
    }
  }

  // ---- Standouts: named strengths, not one collapsed score ----
  const standouts = [];
  const byVelocity = [...personMetrics].sort((a, b) => b.velocity - a.velocity);
  if (byVelocity[0]?.velocity > 0) {
    standouts.push({ title: "Most Tickets Closed", accountId: byVelocity[0].accountId, detail: `${byVelocity[0].velocity} tickets closed this window`, rank: 1 });
  }
  const byAccuracy = personMetrics.filter((p) => p.estimateAccuracy !== null).sort((a, b) => b.estimateAccuracy - a.estimateAccuracy);
  if (byAccuracy[0]) {
    standouts.push({ title: "Best Estimate Accuracy", accountId: byAccuracy[0].accountId, detail: `${byAccuracy[0].estimateAccuracy}% estimate accuracy`, rank: 1 });
  }
  const byHygiene = [...personMetrics].sort(
    (a, b) => b.estimateCoverage - a.estimateCoverage || a.darkWipCount - b.darkWipCount || b.commentCount - a.commentCount,
  );
  if (byHygiene[0]) {
    standouts.push({
      title: "Cleanest Jira",
      accountId: byHygiene[0].accountId,
      detail: `${byHygiene[0].estimateCoverage}% estimate coverage, ${byHygiene[0].darkWipCount} dark WIP, ${byHygiene[0].commentCount} comments`,
      rank: 1,
    });
  }
  const byHours = [...personMetrics].sort((a, b) => b.hoursLogged - a.hoursLogged);
  if (byHours[0]) {
    standouts.push({ title: "Highest Logged Effort", accountId: byHours[0].accountId, detail: `${byHours[0].hoursLogged}h logged this window`, rank: 1 });
  }

  // ---- Org-level board health ----
  const avgEstimateCoverage = Math.round(personMetrics.reduce((s, p) => s + p.estimateCoverage, 0) / (personMetrics.length || 1));
  const totalDarkWip = personMetrics.reduce((s, p) => s + p.darkWipCount, 0);
  const blockedTickets = issues.filter((t) => hasWord(t.status, "block") && t.statusCategory !== "done").length;
  const missingEstimates = issues.filter((t) => !t.estimateSeconds && t.statusCategory !== "done").length;
  const closedWithoutLogsTotal = personMetrics.reduce((s, p) => s + p.closedWithoutLogging, 0);
  const idleEngineers = personMetrics.filter((p) => p.idleWorkdays >= 2).length;
  const staleTickets = issues.filter((t) => {
    if (t.statusCategory === "done") return false;
    const lastTouch = [t.updated, ...(t.worklogs || []).map((w) => w.created), ...(t.comments || []).map((c) => c.created)]
      .map((d) => new Date(d))
      .sort((a, b) => b - a)[0];
    return workdaysBetween(lastTouch, asOf) >= 5;
  }).length;
  // Penalties are proportional to open-ticket volume, not raw counts --
  // a fixed "N points off per ticket" saturates its 100-point cap almost
  // immediately once a team has more than ~15-25 blocked/dark-WIP tickets
  // total, at which point the score stops reflecting reality no matter
  // how much worse things get (at this org's actual scale, both terms
  // were maxed out and the "board health" score was silently just
  // estimate coverage / 2 every single sync).
  const openTicketCount = issues.filter((t) => t.statusCategory !== "done").length || 1;
  const blockedRatioPct = (100 * blockedTickets) / openTicketCount;
  const darkWipRatioPct = (100 * totalDarkWip) / openTicketCount;
  const boardHealthScore = Math.round(
    avgEstimateCoverage * 0.5 + (100 - Math.min(100, blockedRatioPct)) * 0.25 + (100 - Math.min(100, darkWipRatioPct)) * 0.25,
  );

  const orgBoardHealth = {
    estimateCoveragePct: avgEstimateCoverage,
    blockedTickets,
    darkWip: totalDarkWip,
    missingEstimates,
    closedWithoutLogs: closedWithoutLogsTotal,
    idleEngineers,
    avgLogLagDays: (() => {
      const withLag = personMetrics.filter((p) => p.avgLogLagDays !== null);
      return withLag.length ? Math.round((10 * withLag.reduce((s, p) => s + p.avgLogLagDays, 0)) / withLag.length) / 10 : null;
    })(),
    staleTickets,
    boardHealthScore,
  };

  return { personMetrics, risks, standouts, orgBoardHealth };
}
