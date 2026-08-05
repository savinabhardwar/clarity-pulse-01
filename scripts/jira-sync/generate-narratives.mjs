// Populates project_narratives (one row per current project) and
// org_narrative (one new history row) for the Executive Compass
// dashboard (summit-read repo) -- a separate, Jira-jargon-free surface
// for CEOs/leadership that must never show ticket IDs, statuses,
// estimates or employee names.
//
// Heuristic, template-based (no LLM call): built entirely from existing
// columns/derived numbers already in the DB. This reads more mechanical
// than an LLM-generated narrative would -- an accepted tradeoff for not
// depending on an LLM API key/cost.
//
// "Hours this sprint" and "hours remaining" are computed here from raw
// worklog/comment activity on or after each project's own tracked-sprint
// start date (see fetchProjectSprintStart()) -- nothing hand-maintained,
// it rolls forward automatically as sync.mjs rotates tracked sprints.
// This is specific to Executive Compass; the main engineering dashboard
// (People/Projects/Team Health, v_projects_overview.hours_this_sprint)
// is untouched.
//
// Run standalone: `node scripts/jira-sync/generate-narratives.mjs`
// (needs DATABASE_URL). Wired into run-full-sync.mjs as a step after the
// main sync.
import { makePool, upsert, insertMany } from "./lib/db.mjs";

// Fallback sprint length when a project has no tracked sprint linked at
// all (e.g. a roadmap-sourced project with no epics under an active
// board sprint) -- a rolling 2-week window so nothing needs manual
// updating sprint to sprint.
const FALLBACK_SPRINT_DAYS = 14;
const MAX_DELIVERY_SPRINTS = 4;
const MAX_FEATURES_PER_SPRINT = 4;
// Tickets estimated above this are excluded from every hours/feature
// calculation and flagged as needing to be broken down instead -- a
// single ticket this large is a planning smell, not a real "feature".
const OVERSIZED_ESTIMATE_HOURS = 35;
const OVERSIZED_ESTIMATE_SECONDS = OVERSIZED_ESTIMATE_HOURS * 3600;

const TECH_LEADING_WORDS = /^(fix|bug|task|story|issue|investigate|p\d issue)\s*[:\-]\s*/i;
const TECH_TRAILING_PAREN = /\s*\([^)]*\)\s*$/;
const TECH_TRAILING_SUFFIX = /\s*[-:]\s*(ui|api|backend|frontend|be|fe|db)$/i;

// Best-effort plain-English cleanup, no LLM: strip Jira-status-ish
// prefixes, trailing "(ui, api, gateway)"-style technical asides, and
// trailing tech-suffix tags. Falls back to the original text if
// stripping would leave nothing.
function cleanFeatureName(summary) {
  let s = summary.trim();
  s = s.replace(/^\[[^\]]+\]\s*/, "");
  s = s.replace(TECH_LEADING_WORDS, "");
  s = s.replace(TECH_TRAILING_PAREN, "");
  s = s.replace(TECH_TRAILING_SUFFIX, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (!s) s = summary.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function buildTimeline(project) {
  const timeline = [];
  if (project.started_at) {
    timeline.push({ label: "Project Started", date: monthLabel(project.started_at), kind: "start" });
  }
  timeline.push({ label: "Current Sprint", date: project.sprint_goal ? "In progress" : "Current sprint", kind: "current" });
  if (project.roadmap_go_live) {
    timeline.push({ label: "Expected Go Live", date: project.roadmap_go_live, kind: "golive" });
  }
  return timeline;
}

function buildExecRisks(project, activity) {
  const risks = [];
  if (project.health === "at_risk") {
    risks.push({ text: `${project.name} is currently off track against plan.`, severity: "high" });
  } else if (project.health === "needs_attention") {
    risks.push({ text: `${project.name} needs attention to stay on track this sprint.`, severity: "medium" });
  }
  if (project.blocked_tickets > 0) {
    risks.push({
      text: `${project.name} has ${project.blocked_tickets} piece(s) of work blocked, slowing delivery.`,
      severity: project.blocked_tickets > 3 ? "high" : "medium",
    });
  }
  if (activity.needsBreakdown.length > 0) {
    risks.push({
      text: `${project.name} has ${activity.needsBreakdown.length} piece(s) of work too large to plan reliably and needs them broken down into smaller tasks.`,
      severity: activity.needsBreakdown.length > 2 ? "high" : "medium",
    });
  }
  if (activity.hoursRemainingSinceStart > 0) {
    risks.push({
      text: `${project.name} has ${Math.round(activity.hoursRemainingSinceStart)}h of work remaining on items active since the start of the sprint.`,
      severity: activity.hoursRemainingSinceStart > 60 ? "high" : "medium",
    });
  }
  return risks.slice(0, 3);
}

async function fetchDeliveryHistory(pool, project) {
  const sprintDeliveries = await pool.query(
    `select s.name as sprint_name, s.end_date, tk.summary
     from tickets tk
     join epics e on e.id = tk.epic_id
     join sprints s on s.id = tk.sprint_id
     where e.project_id = $1 and tk.status_category = 'done' and s.end_date is not null
       and (tk.original_estimate_seconds is null or tk.original_estimate_seconds <= $2)
     order by s.end_date desc, tk.resolved_at desc
     limit 200`,
    [project.id, OVERSIZED_ESTIMATE_SECONDS],
  );

  const sprintMap = new Map();
  for (const row of sprintDeliveries.rows) {
    if (!sprintMap.has(row.sprint_name)) sprintMap.set(row.sprint_name, []);
    const bucket = sprintMap.get(row.sprint_name);
    if (bucket.length < MAX_FEATURES_PER_SPRINT) bucket.push(cleanFeatureName(row.summary));
  }
  return [...sprintMap.entries()].slice(0, MAX_DELIVERY_SPRINTS);
}

// A project's "sprint start" is derived from its own tracked sprint(s)
// -- the earliest start_date among tracked sprints its tickets actually
// sit in -- rather than a hand-maintained date, so this rolls forward
// automatically every time sync.mjs rotates which sprint is tracked.
// Falls back to a rolling FALLBACK_SPRINT_DAYS window for projects with
// no tracked-sprint ticket at all (e.g. a roadmap-only project).
async function fetchProjectSprintStart(pool, projectId) {
  const { rows } = await pool.query(
    `select min(s.start_date) as sprint_start
     from tickets tk
     join epics e on e.id = tk.epic_id
     join sprints s on s.id = tk.sprint_id
     where e.project_id = $1 and s.is_tracked = true and s.start_date is not null`,
    [projectId],
  );
  if (rows[0]?.sprint_start) return rows[0].sprint_start;
  return new Date(Date.now() - FALLBACK_SPRINT_DAYS * 24 * 60 * 60 * 1000);
}

// "This sprint" for Executive Compass means: touched (worklog or
// comment) on/after the project's own sprint start (see
// fetchProjectSprintStart), independent of a hand-maintained date.
// Oversized tickets are excluded from hours and feature lists entirely
// and reported separately as needing breakdown.
async function fetchSprintActivity(pool, project, sprintStart) {
  const { rows } = await pool.query(
    `select
       tk.id, tk.jira_key, tk.summary, tk.status_category,
       tk.original_estimate_seconds, tk.remaining_estimate_seconds,
       coalesce((select sum(w.seconds) from worklogs w where w.ticket_id = tk.id and w.started_at >= $2), 0) as seconds_logged_since,
       exists(select 1 from worklogs w where w.ticket_id = tk.id and w.started_at >= $2) as has_worklog_since,
       exists(select 1 from ticket_comments c where c.ticket_id = tk.id and c.created_at >= $2) as has_comment_since
     from tickets tk
     join epics e on e.id = tk.epic_id
     where e.project_id = $1`,
    [project.id, sprintStart],
  );

  let hoursLoggedSinceStart = 0;
  let hoursRemainingSinceStart = 0;
  const needsBreakdown = [];
  const deliveredThisSprint = [];

  for (const t of rows) {
    hoursLoggedSinceStart += Number(t.seconds_logged_since) / 3600;

    const isOversized = t.original_estimate_seconds != null && t.original_estimate_seconds > OVERSIZED_ESTIMATE_SECONDS;
    if (isOversized) {
      if (t.status_category !== "done") needsBreakdown.push(t);
      continue; // excluded entirely from remaining hours and feature listing
    }

    const touchedSinceStart = t.has_worklog_since || t.has_comment_since;
    if (t.status_category !== "done" && touchedSinceStart) {
      hoursRemainingSinceStart += Number(t.remaining_estimate_seconds || 0) / 3600;
    }
    if (t.status_category === "done" && touchedSinceStart && deliveredThisSprint.length < MAX_FEATURES_PER_SPRINT) {
      deliveredThisSprint.push(cleanFeatureName(t.summary));
    }
  }

  return { hoursLoggedSinceStart, hoursRemainingSinceStart, needsBreakdown, deliveredThisSprint };
}

function buildNarrative(project, deliveryHistory, activity) {
  const benefit = project.roadmap_key_benefit || project.purpose || `Supports the ${project.name} workstream.`;
  const why = project.purpose || `${project.name} exists to move this workstream forward.`;
  const problem = project.roadmap_status || "Addressing an active business need.";
  const delivered =
    project.closed_tickets > 0
      ? `${project.closed_tickets} item(s) of work delivered to date.`
      : "No work delivered yet.";
  const thisSprint =
    activity.hoursLoggedSinceStart > 0
      ? `Active development this sprint (${Math.round(activity.hoursLoggedSinceStart)}h logged since the sprint started).`
      : "No active engineering investment this sprint.";
  const nextMilestone = project.roadmap_go_live
    ? `Targeting go-live: ${project.roadmap_go_live}.`
    : "Next milestone not yet scheduled.";

  return {
    project_id: project.id,
    benefit,
    why,
    problem,
    delivered,
    this_sprint: thisSprint,
    next_milestone: nextMilestone,
    delivered_features_this_sprint: activity.deliveredThisSprint,
    delivery_history: JSON.stringify(deliveryHistory.map(([sprint_name, features]) => ({ sprint_name, features }))),
    timeline: JSON.stringify(buildTimeline(project)),
    exec_risks: JSON.stringify(buildExecRisks(project, activity)),
    hours_logged_since_sprint_start: Math.round(activity.hoursLoggedSinceStart * 10) / 10,
    hours_remaining_since_sprint_start: Math.round(activity.hoursRemainingSinceStart * 10) / 10,
    needs_breakdown_count: activity.needsBreakdown.length,
    generated_at: new Date(),
  };
}

function buildOrgSummary(orgMetrics, projectRows) {
  const atRisk = projectRows.filter((p) => p.health !== "on_track").length;
  const sentences = [
    `Engineering utilised ${orgMetrics.avg_utilisation}% of available capacity this period.`,
    // projectRows.length, not orgMetrics.active_projects -- the latter
    // counts is_current rows across ALL project_spaces including infra
    // clusters, which this dashboard excludes from every other widget,
    // so the two numbers would otherwise disagree.
    `${projectRows.length} projects are currently active.`,
  ];
  if (atRisk > 0) {
    sentences.push(`${atRisk} project(s) require executive attention.`);
  } else {
    sentences.push("No projects currently require executive attention.");
  }
  sentences.push(`${orgMetrics.estimate_coverage}% of work has a documented estimate.`);
  if (orgMetrics.total_spillage_hours > 0) {
    sentences.push(`${Math.round(orgMetrics.total_spillage_hours)}h of committed work is projected to spill into the next sprint.`);
  }
  return sentences.join(" ");
}

async function main() {
  const pool = makePool();
  try {
    // project_space = 'infra' clusters are individual auto-clustered
    // ops/network/hardware tickets (e.g. "Spam investigaton", "Backlog -
    // Database"), not real product initiatives -- excluded here for the
    // same reason v_org_metrics already excludes them from spillage
    // (0020_project_space_telephony.sql). Their ticket summaries are
    // internal ops text (server alerts, helpdesk URLs) that has no
    // business on an executive dashboard.
    // A project with zero tickets ever (open + closed) is an empty
    // clustering artifact -- an epic with nothing under it -- not real
    // work, so it's excluded the same as infra clusters rather than
    // generating a narrative for a project with nothing to say.
    const { rows: projects } = await pool.query(
      `select v.*, p.roadmap_go_live, p.roadmap_status, p.roadmap_key_benefit
       from v_projects_overview v
       join projects p on p.id = v.id
       where v.is_current = true and v.project_space != 'infra'
         and (v.open_tickets + v.closed_tickets) > 0`,
    );
    console.log(`[generate-narratives] generating for ${projects.length} current project(s)`);

    const narrativeRows = [];
    for (const project of projects) {
      const sprintStart = await fetchProjectSprintStart(pool, project.id);
      const [deliveryHistory, activity] = await Promise.all([
        fetchDeliveryHistory(pool, project),
        fetchSprintActivity(pool, project, sprintStart),
      ]);
      narrativeRows.push(buildNarrative(project, deliveryHistory, activity));
      if (activity.needsBreakdown.length > 0) {
        console.log(
          `[generate-narratives] ${project.name}: ${activity.needsBreakdown.length} ticket(s) >${OVERSIZED_ESTIMATE_HOURS}h need breakdown -- ${activity.needsBreakdown.map((t) => t.jira_key).join(", ")}`,
        );
      }
    }

    if (narrativeRows.length > 0) {
      await upsert(pool, "project_narratives", narrativeRows, {
        conflictColumns: ["project_id"],
        updateColumns: Object.keys(narrativeRows[0]).filter((c) => c !== "project_id"),
      });
    }
    console.log(`[generate-narratives] wrote ${narrativeRows.length} project narrative(s)`);

    const { rows: orgMetricsRows } = await pool.query(`select * from v_org_metrics`);
    const topRisks = narrativeRows
      .flatMap((r) => {
        const project = projects.find((p) => p.id === r.project_id);
        return JSON.parse(r.exec_risks).map((risk) => ({
          project_name: project?.name ?? "Unknown project",
          risk_text: risk.text,
          severity: risk.severity,
        }));
      })
      .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity])
      .slice(0, 5);

    await insertMany(pool, "org_narrative", [
      {
        executive_summary: buildOrgSummary(orgMetricsRows[0], projects),
        top_risks: JSON.stringify(topRisks),
        generated_at: new Date(),
      },
    ]);
    console.log("[generate-narratives] org narrative done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[generate-narratives] FAILED", err);
  process.exit(1);
});
