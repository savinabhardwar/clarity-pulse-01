import { createFileRoute } from "@tanstack/react-router";
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { AppShell } from "@/components/emp/shell";
import { Panel, SectionHeader } from "@/components/emp/bits";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import {
  useOrgSprintSummaries,
  useTeamSprintSummaries,
  type OrgSprintSummaryRow,
  type TeamSprintSummaryRow,
} from "@/data/queries";

const title = "Sprint Trends — Delivery Lens Engineering Management";
const description =
  "Historical capacity, utilisation and logged hours per team, sprint over sprint.";

export const Route = createFileRoute("/trends")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: TrendsPage,
});

// Fixed order, fixed hues -- Development/Infrastructure/Telephony are
// identities, not a ranking, so they always draw from the same chart-N
// token regardless of which teams are present in a given sprint.
const TEAM_CHART_CONFIG: ChartConfig = {
  Development: { label: "Development", color: "var(--chart-1)" },
  Infrastructure: { label: "Infrastructure", color: "var(--chart-2)" },
  Telephony: { label: "Telephony", color: "var(--chart-3)" },
};

const ORG_CHART_CONFIG: ChartConfig = {
  utilisation_pct: { label: "Utilisation (logged / capacity)", color: "var(--chart-2)" },
  capacity_used_pct: {
    label: "Capacity committed (allocated / capacity)",
    color: "var(--chart-1)",
  },
};

// Includes the year -- sprint history can span multiple years, and
// "Jul 14"/"Jul 6" with no year looks like a sort bug when one is 2025 and
// the other 2026 (it isn't; they're correctly ordered by full timestamp).
function sprintLabel(startIso: string) {
  return new Date(startIso).toLocaleDateString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function TrendsPage() {
  const org = useOrgSprintSummaries();
  const teams = useTeamSprintSummaries();
  const [view, setView] = useState<"chart" | "table">("chart");

  const orgRows = org.data ?? [];
  const teamRows = teams.data ?? [];

  // One column per org-sprint group_day, one series per team -- bucketing
  // by group_day (not each team's own sprint_start) keeps two teams'
  // slightly-different board sprint_start timestamps for the same org
  // sprint window on the same x-axis column instead of fragmenting it.
  const sprintDays = Array.from(new Set(teamRows.map((r) => r.group_day))).sort();
  const loggedHoursByTeam = sprintDays.map((day) => {
    const rowsForDay = teamRows.filter((r) => r.group_day === day);
    const row: Record<string, string | number> = {
      sprint: sprintLabel(rowsForDay[0]?.sprint_start ?? day),
    };
    for (const t of rowsForDay) {
      row[t.team] = t.logged_hours;
    }
    return row;
  });

  const orgTrend = orgRows.map((r) => ({
    sprint: sprintLabel(r.sprint_start),
    utilisation_pct: r.utilisation_pct,
    capacity_used_pct: r.capacity_used_pct,
  }));

  const isLoading = org.isLoading || teams.isLoading;
  const isError = org.isError || teams.isError;

  return (
    <AppShell title="Trends" description={description}>
      <div className="mb-4 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant={view === "chart" ? "default" : "outline"}
          onClick={() => setView("chart")}
        >
          Chart
        </Button>
        <Button
          size="sm"
          variant={view === "table" ? "default" : "outline"}
          onClick={() => setView("table")}
        >
          Table
        </Button>
      </div>

      {isLoading && (
        <Panel>
          <p className="text-sm text-muted-foreground">Loading sprint history…</p>
        </Panel>
      )}
      {isError && (
        <Panel>
          <p className="text-sm text-destructive">Couldn't load sprint history.</p>
        </Panel>
      )}

      {!isLoading && !isError && orgRows.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No sprint history yet -- this fills in as snapshot-sprint-summary.mjs runs after each
            sprint closes.
          </p>
        </Panel>
      )}

      {!isLoading && !isError && orgRows.length > 0 && (
        <div className="space-y-4">
          <Panel>
            <SectionHeader
              title="Org-wide capacity vs. utilisation"
              hint="Capacity committed = allocated hours / capacity ceiling. Utilisation = hours actually logged / capacity ceiling."
            />
            {view === "chart" ? (
              <ChartContainer config={ORG_CHART_CONFIG} className="aspect-auto h-72 w-full">
                <LineChart data={orgTrend} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis dataKey="sprint" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v: number) => `${v}%`}
                    width={40}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line
                    type="monotone"
                    dataKey="capacity_used_pct"
                    stroke="var(--color-capacity_used_pct)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="utilisation_pct"
                    stroke="var(--color-utilisation_pct)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <OrgTable rows={orgRows} />
            )}
          </Panel>

          <Panel>
            <SectionHeader
              title="Logged hours by team, per sprint"
              hint="Hours actually logged against tickets, credited to the worklog author's team."
            />
            {view === "chart" ? (
              <ChartContainer config={TEAM_CHART_CONFIG} className="aspect-auto h-72 w-full">
                <BarChart
                  data={loggedHoursByTeam}
                  margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis dataKey="sprint" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <RBar dataKey="Development" fill="var(--color-Development)" radius={4} />
                  <RBar dataKey="Infrastructure" fill="var(--color-Infrastructure)" radius={4} />
                  <RBar dataKey="Telephony" fill="var(--color-Telephony)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : (
              <TeamTable rows={teamRows} />
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  );
}

function OrgTable({ rows }: { rows: OrgSprintSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Sprint start</th>
            <th className="py-2 pr-4 font-medium">Headcount</th>
            <th className="py-2 pr-4 font-medium">Capacity (h)</th>
            <th className="py-2 pr-4 font-medium">Allocated (h)</th>
            <th className="py-2 pr-4 font-medium">Logged (h)</th>
            <th className="py-2 pr-4 font-medium">Capacity used</th>
            <th className="py-2 font-medium">Utilisation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sprint_start} className="border-b border-border/60">
              <td className="py-2 pr-4 tabular-nums">{sprintLabel(r.sprint_start)}</td>
              <td className="py-2 pr-4 tabular-nums">{r.person_count}</td>
              <td className="py-2 pr-4 tabular-nums">{r.total_productive_hours}</td>
              <td className="py-2 pr-4 tabular-nums">{r.allocated_hours}</td>
              <td className="py-2 pr-4 tabular-nums">{r.logged_hours}</td>
              <td className="py-2 pr-4 tabular-nums">{r.capacity_used_pct}%</td>
              <td className="py-2 tabular-nums">{r.utilisation_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamTable({ rows }: { rows: TeamSprintSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Sprint start</th>
            <th className="py-2 pr-4 font-medium">Team</th>
            <th className="py-2 pr-4 font-medium">Headcount</th>
            <th className="py-2 pr-4 font-medium">Capacity (h)</th>
            <th className="py-2 pr-4 font-medium">Allocated (h)</th>
            <th className="py-2 pr-4 font-medium">Logged (h)</th>
            <th className="py-2 font-medium">Utilisation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.sprint_start}-${r.team}`} className="border-b border-border/60">
              <td className="py-2 pr-4 tabular-nums">{sprintLabel(r.sprint_start)}</td>
              <td className="py-2 pr-4">{r.team}</td>
              <td className="py-2 pr-4 tabular-nums">{r.person_count}</td>
              <td className="py-2 pr-4 tabular-nums">{r.total_productive_hours}</td>
              <td className="py-2 pr-4 tabular-nums">{r.allocated_hours}</td>
              <td className="py-2 pr-4 tabular-nums">{r.logged_hours}</td>
              <td className="py-2 tabular-nums">{r.utilisation_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
