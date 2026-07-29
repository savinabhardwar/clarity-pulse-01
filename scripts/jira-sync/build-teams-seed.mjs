import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const counts = JSON.parse(readFileSync(new URL("./cache/assignee-project-counts.json", import.meta.url), "utf8"));

const PROJECT_NAMES = {
  TEAM: "Team-PixelBlinders",
  TI: "Team - Infrastructure",
  TEAMSANKYA: "Team Sankya",
  TT: "Team - Telephony",
  TRG: "Team RUMA GPT",
};

const people = counts.map((c) => {
  const total = c.projectCounts.reduce((s, p) => s + p.count, 0);
  const top = c.projectCounts[0];
  const split = c.projectCounts.length > 1 && top.count / total < 0.85;
  return {
    accountId: c.accountId,
    name: c.name,
    team: PROJECT_NAMES[top.project],
    guessed: true,
    guessReason: split
      ? `Ticket split across ${c.projectCounts.map((p) => `${p.project}:${p.count}`).join(", ")} this sprint — team guessed from majority project, needs human confirmation`
      : `All ${total} of this sprint's tickets are in ${top.project} — team guessed from Jira project, needs human confirmation`,
  };
});

const OUT_PATH = new URL("../../src/data/generated/teams.seed.json", import.meta.url);
mkdirSync(new URL(".", OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify({ note: "Every entry is a GUESS pending human correction — Jira has no team field.", people }, null, 2) + "\n",
);
console.log(`Wrote ${people.length} guessed team entries.`);
