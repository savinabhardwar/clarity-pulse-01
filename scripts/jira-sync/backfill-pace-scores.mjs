// One-off backfill: recomputes pace_score for every existing
// person_sprint_summaries row under the NEW pace semantics (flat
// 7h/workday expectation through sprint end, leave-adjusted -- see the
// alignment in snapshot-sprint-summary.mjs), and rewrites overall_score
// since it averages pace in. Rows already matching are skipped, so the
// script is idempotent and safe to rerun.
//
// Known precision caveat: logged_hours is stored rounded to 0.1h while
// the original snapshot computed pace from unrounded hours, so a
// recomputed score can differ by 1 point purely from that rounding.
// Those rows still get rewritten (consistently) on each run.
import pg from "pg";

const SPRINT_DAILY_HOURS = 7;

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

function utcDayOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isWeekendUtc(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function buildLeaveByPersonDay(rows) {
  const byPerson = new Map();
  for (const r of rows) {
    const start = new Date(`${toDate(r.from_date).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${toDate(r.to_date).toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (end < start) continue;
    const personMap = byPerson.get(r.person_id) ?? new Map();
    byPerson.set(r.person_id, personMap);
    const cur = new Date(start);
    while (cur <= end) {
      personMap.set(cur.toISOString(), (personMap.get(cur.toISOString()) ?? 0) + Number(r.hours));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return byPerson;
}

function expectedHoursThroughSprintEnd(sprintStart, sprintEnd, leaveHoursByDay) {
  let expected = 0;
  const cur = utcDayOnly(toDate(sprintStart));
  const lastDay = utcDayOnly(toDate(sprintEnd));
  while (cur <= lastDay) {
    if (!isWeekendUtc(cur)) {
      const lost = leaveHoursByDay?.get(cur.toISOString()) ?? 0;
      expected += Math.max(SPRINT_DAILY_HOURS - lost, 0);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return expected;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
try {
  const { rows } = await pool.query(`select person_id, sprint_start, sprint_end, pace_score, estimate_score, hygiene_score, logging_score, overall_score, logged_hours, jira_qualifies from person_sprint_summaries`);
  const { rows: leaveRows } = await pool.query(`select person_id, from_date, to_date, hours from planning_availability`);
  const leaveByPersonDay = buildLeaveByPersonDay(leaveRows);

  let updated = 0;
  let alreadyCorrect = 0;
  for (const row of rows) {
    const expectedByNow = expectedHoursThroughSprintEnd(row.sprint_start, row.sprint_end, leaveByPersonDay.get(row.person_id));
    const paceScore = Math.min(100, Math.round((Number(row.logged_hours) / Math.max(expectedByNow, 1)) * 100));
    const otherTerms = [row.estimate_score, row.hygiene_score, row.logging_score].filter((s) => s !== null);
    const terms = [paceScore, ...otherTerms];
    const rawOverallScore = Math.round(terms.reduce((a, b) => a + b, 0) / terms.length);
    const overallScore = row.jira_qualifies ? rawOverallScore : Math.round(rawOverallScore * 0.5);

    if (paceScore === row.pace_score && overallScore === row.overall_score) {
      alreadyCorrect++;
      continue;
    }
    await pool.query(
      `update person_sprint_summaries set pace_score = $1, overall_score = $2 where person_id = $3 and sprint_start = $4`,
      [paceScore, overallScore, row.person_id, row.sprint_start],
    );
    updated++;
  }
  console.log(`[backfill-pace-scores] rows total: ${rows.length}, updated: ${updated}, already correct: ${alreadyCorrect}`);
} finally {
  await pool.end();
}
