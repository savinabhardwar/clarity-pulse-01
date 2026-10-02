// The 3 business-facing team buckets the whole UI is organized around.
// Real Jira boards map to 5 raw team names (see teamGroup() in emp-engine.ts) --
// this is the collapsed view every filter/rollup in this app uses.
export type Team = "Development" | "Infrastructure" | "Telephony";
export const TEAMS: Team[] = ["Development", "Infrastructure", "Telephony"];

// No longer on the team -- excluded org-wide (every rollup, filter option,
// manager action and hygiene entry), not just hidden from one view. Same
// roster engineering-ethos excludes.
export const EXCLUDED_PEOPLE = new Set([
  "Pablo Martinez",
  "Savina Bhardwar",
  "Vignesh Sivarajan",
  "Kenny Chan",
]);

// Sprint length/capacity are fixed business rules, not derived from data --
// 7h/day x a 10-workday sprint. Same constants engineering-ethos uses.
export const SPRINT_DAILY_HOURS = 7;
export const SPRINT_LENGTH_DAYS = 10;
export const SPRINT_CAPACITY_HOURS = SPRINT_DAILY_HOURS * SPRINT_LENGTH_DAYS;

// Tickets estimated above this need to be broken down before they can be
// tracked properly -- excluded from allocated/logged/remaining hours
// entirely and flagged instead. 5 workdays at the sprint's 7h/day rate: an
// original estimate alone exceeding a full working week is a planning
// smell, not something that belongs in one sprint's tracked hours.
export const OVERSIZED_TICKET_DAYS = 5;
export const OVERSIZED_TICKET_HOURS = OVERSIZED_TICKET_DAYS * SPRINT_DAILY_HOURS;
