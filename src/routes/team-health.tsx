import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Award, Gauge, Sparkles, ShieldCheck, Timer, Target } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Avatar,
  Chip,
  DateRangeFilter,
  dateRangeToIso,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  PriorityPill,
  SectionHeading,
  StatCard,
  StatusPill,
  UnconfirmedBadge,
  type DateRangeValue,
} from "@/components/dashboard/primitives";
import { QueryBoundary } from "@/components/dashboard/query-state";
import {
  useOrgMetrics,
  usePeople,
  useAllBlockers,
  useStandouts,
  useTicketHygiene,
  toHealth,
  toPriorityLabel,
  type OrgMetrics,
  type PersonRow,
  type BlockerRow,
  type TicketHygieneRow,
} from "@/data/queries";

const searchSchema = z.object({
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/team-health")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Team Health — Is Jira Trustworthy Enough to Plan With?" },
      {
        name: "description",
        content:
          "Estimate coverage, blocked work, dark WIP and Jira hygiene per engineer, plus recognition for different strengths.",
      },
      { property: "og:title", content: "Team Health — Is Jira Trustworthy Enough to Plan With?" },
      {
        property: "og:description",
        content: "Data quality, blocked work and hygiene signals behind every other number.",
      },
    ],
  }),
  component: TeamHealth,
});

interface StandoutRow {
  title: string;
  person_id: string;
  person_name: string;
  detail: string;
}

function personInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function TeamHealth() {
  const { from, to } = Route.useSearch();
  const navigate = useNavigate({ from: "/team-health" });
  const range: DateRangeValue = from || to ? { from, to } : null;
  const asOf = dateRangeToIso(range).to ?? dateRangeToIso(range).from;
  const orgMetrics = useOrgMetrics();
  const people = usePeople(asOf);
  const blockers = useAllBlockers();
  const standouts = useStandouts();
  const ticketHygiene = useTicketHygiene();

  const isLoading =
    orgMetrics.isLoading ||
    people.isLoading ||
    blockers.isLoading ||
    standouts.isLoading ||
    ticketHygiene.isLoading;
  const firstError =
    orgMetrics.error || people.error || blockers.error || standouts.error || ticketHygiene.error;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Team Health"
        question="Is our engineering data reliable enough to plan with?"
      >
        <DateRangeFilter
          value={range}
          onChange={(v) => navigate({ search: { from: v?.from ?? "", to: v?.to ?? "" } })}
        />
      </PageHeader>
      <p className="-mt-6 text-xs text-muted-foreground">
        {asOf
          ? `Showing the nearest synced snapshot at or before ${new Date(asOf).toLocaleString()}.`
          : "Current-sprint snapshot as of the last sync, not a historical trend."}
      </p>

      <QueryBoundary
        isLoading={isLoading}
        isError={!!firstError}
        error={firstError as Error | null}
      >
        {orgMetrics.data && people.data && blockers.data && standouts.data && ticketHygiene.data && (
          <TeamHealthBody
            m={orgMetrics.data}
            people={people.data}
            blockers={blockers.data}
            standouts={standouts.data}
            ticketHygiene={ticketHygiene.data}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

function TeamHealthBody({
  m,
  people,
  blockers,
  standouts,
  ticketHygiene,
}: {
  m: OrgMetrics;
  people: PersonRow[];
  blockers: BlockerRow[];
  standouts: StandoutRow[];
  ticketHygiene: TicketHygieneRow[];
}) {
  const personById = new Map(people.map((p) => [p.id, p]));

  const hygieneByPerson = new Map<string, TicketHygieneRow[]>();
  for (const t of ticketHygiene) {
    const key = t.person_name ?? "Unassigned";
    const list = hygieneByPerson.get(key) ?? [];
    list.push(t);
    hygieneByPerson.set(key, list);
  }
  const hygieneGroups = [...hygieneByPerson.entries()].sort((a, b) => b[1].length - a[1].length);

  function missingLabels(t: TicketHygieneRow) {
    const labels: string[] = [];
    if (t.missing_estimate) labels.push("No estimate");
    if (t.missing_epic) labels.push("No epic");
    if (t.missing_comments) labels.push("No comments");
    if (t.missing_worklog) labels.push("No worklog");
    return labels;
  }

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Estimate Coverage"
          value={`${m.estimate_coverage}%`}
          sub="Tickets with an estimate"
          tone={m.estimate_coverage > 85 ? "success" : "warning"}
          icon={<Gauge className="size-4" />}
        />
        <StatCard
          label="Blocked Tickets"
          value={m.blocked_count}
          sub="Across all projects"
          tone="danger"
          icon={<Timer className="size-4" />}
        />
        <StatCard
          label="Dark WIP"
          value={m.dark_wip}
          sub="In progress with no recent worklog"
          tone="warning"
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label="Closed Without Logs"
          value={m.closed_without_logs}
          sub="Closed with zero logged hours"
          tone="warning"
          icon={<ShieldCheck className="size-4" />}
        />
      </section>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="blocked">Blocked Work</TabsTrigger>
          <TabsTrigger value="hygiene">Jira Hygiene</TabsTrigger>
          <TabsTrigger value="standouts">Standouts</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => (
            <article key={p.id} className="card-soft card-hover p-5">
              <div className="flex items-start gap-3">
                <Avatar person={{ name: p.name, initials: personInitials(p.name) }} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold">{p.name}</p>
                    <HealthBadge health={toHealth(p.health)} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {p.role ?? "Engineer"} · {p.team ?? "Unassigned team"}
                  </p>
                  {p.team_guessed && <UnconfirmedBadge label="team assignment" className="mt-1" />}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Estimate coverage</span>
                  <span className="num">{p.estimate_coverage}%</span>
                </div>
                <Meter
                  value={p.estimate_coverage}
                  tone={
                    p.estimate_coverage > 85
                      ? "success"
                      : p.estimate_coverage > 70
                        ? "warning"
                        : "danger"
                  }
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <KeyValue label="Worklogs" value={p.worklog_count} />
                <KeyValue label="Comments" value={p.comment_count} />
                <KeyValue
                  label="Dark WIP"
                  value={p.dark_wip_count}
                  tone={p.dark_wip_count > 0 ? "warning" : "success"}
                />
              </div>
              <Link
                to="/people"
                search={{ q: "", person: p.id }}
                className="mt-4 inline-block text-sm font-medium text-info hover:underline"
              >
                Open profile
              </Link>
            </article>
          ))}
        </TabsContent>

        <TabsContent value="blocked" className="mt-6">
          <SectionHeading
            title="Blocked work"
            description="Sorted by how long the work has been stuck."
          />
          <div className="card-soft divide-y divide-border">
            {[...blockers]
              .sort((a, b) => b.days_blocked - a.days_blocked)
              .map((b) => (
                <div key={b.ticket_id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-[16rem] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs font-semibold text-muted-foreground">
                        {b.jira_key}
                      </span>
                      <PriorityPill priority={toPriorityLabel(b.priority)} />
                    </div>
                    <p className="mt-1 text-sm">{b.summary}</p>
                  </div>
                  <Chip>{b.project_name}</Chip>
                  <span className="w-32 text-sm">{b.owner_name ?? "Unassigned"}</span>
                  <div className="w-24">
                    <p className="text-xs text-muted-foreground">Days</p>
                    <p
                      className={cn(
                        "num text-sm font-semibold",
                        b.days_blocked > 10 ? "text-danger" : "text-warning",
                      )}
                    >
                      {b.days_blocked}
                    </p>
                  </div>
                  <div className="w-28">
                    <p className="text-xs text-muted-foreground">Last updated</p>
                    <p className="text-sm">{new Date(b.updated_at).toLocaleDateString()}</p>
                  </div>
                  <Link
                    to="/projects"
                    search={{ project: b.project_slug }}
                    className="ml-auto text-sm font-medium text-info hover:underline"
                  >
                    View project
                  </Link>
                </div>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="hygiene" className="mt-6">
          <SectionHeading
            title="Jira hygiene"
            description="Can we trust each person's board? Click a row to open their profile."
          />
          <div className="card-soft divide-y divide-border">
            <div className="hidden grid-cols-[1.6fr_1fr_.7fr_.7fr_.7fr_.7fr_1fr] gap-4 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Person</span>
              <span>Estimate coverage</span>
              <span>Worklogs</span>
              <span>Comments</span>
              <span>Idle days</span>
              <span>Dark WIP</span>
              <span>Risk level</span>
            </div>
            {people.map((p) => (
              <Link
                key={p.id}
                to="/people"
                search={{ q: "", person: p.id }}
                className="grid grid-cols-2 gap-4 px-5 py-4 text-sm transition-colors hover:bg-secondary/40 lg:grid-cols-[1.6fr_1fr_.7fr_.7fr_.7fr_.7fr_1fr] lg:items-center"
              >
                <span className="flex items-center gap-3">
                  <Avatar person={{ name: p.name, initials: personInitials(p.name) }} size="sm" />
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.team ?? "Unassigned team"}
                      {p.team_guessed && (
                        <span className="ml-1 font-semibold text-warning" title="Unconfirmed: team assignment">
                          ⚠ unconfirmed
                        </span>
                      )}
                    </span>
                  </span>
                </span>
                <span>
                  <Meter
                    value={p.estimate_coverage}
                    tone={
                      p.estimate_coverage > 85
                        ? "success"
                        : p.estimate_coverage > 70
                          ? "warning"
                          : "danger"
                    }
                  />
                  <span className="num mt-1 block text-xs text-muted-foreground">
                    {p.estimate_coverage}%
                  </span>
                </span>
                <span className="num">{p.worklog_count}</span>
                <span className="num">{p.comment_count}</span>
                <span className={cn("num", p.idle_workdays > 1 && "text-warning")}>
                  {p.idle_workdays}
                </span>
                <span className={cn("num", p.dark_wip_count > 0 && "text-warning")}>
                  {p.dark_wip_count}
                </span>
                <HealthBadge health={toHealth(p.health)} />
              </Link>
            ))}
          </div>

          <SectionHeading
            title="Tickets needing attention"
            description="Every ticket missing an estimate, an epic, comments, or a worklog — all four are required for a ticket to count as properly updated."
            className="mt-8"
          />
          {hygieneGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every ticket in the current sprint is fully updated.
            </p>
          ) : (
            <div className="space-y-6">
              {hygieneGroups.map(([personName, tickets]) => (
                <div key={personName} className="card-soft p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Avatar person={{ name: personName, initials: personInitials(personName) }} size="sm" />
                      <p className="font-semibold">{personName}</p>
                    </div>
                    <Chip tone="danger">
                      {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
                    </Chip>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {tickets.map((t) => (
                      <li
                        key={t.ticket_id}
                        className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/15"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="num text-xs font-semibold text-muted-foreground">
                            {t.jira_key}
                          </span>
                          <StatusPill status={t.status} />
                          {t.project_name && <Chip>{t.project_name}</Chip>}
                        </div>
                        <p className="mt-1.5 text-sm">{t.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {missingLabels(t).map((label) => (
                            <Chip key={label} tone="warning">
                              {label}
                            </Chip>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="standouts" className="mt-6">
          <SectionHeading
            title="Standouts"
            description="Different strengths, not a leaderboard of hours."
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {standouts.map((s) => {
              const p = personById.get(s.person_id);
              return (
                <article key={s.title} className="card-soft card-hover p-5">
                  <div className="flex items-center gap-2 text-info">
                    {s.title === "Best Estimate Accuracy" ? (
                      <Target className="size-4" />
                    ) : (
                      <Award className="size-4" />
                    )}
                    <p className="text-xs font-semibold uppercase tracking-wide">{s.title}</p>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Avatar
                      person={{ name: s.person_name, initials: personInitials(s.person_name) }}
                      size="lg"
                    />
                    <div>
                      <p className="font-semibold">{s.person_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {p?.role ?? "Engineer"} · {p?.team ?? "Unassigned team"}
                        {p?.team_guessed && (
                          <span className="ml-1 font-semibold text-warning">⚠ unconfirmed</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{s.detail}</p>
                  <Link
                    to="/people"
                    search={{ q: "", person: s.person_id }}
                    className="mt-4 inline-block text-sm font-medium text-info hover:underline"
                  >
                    Open profile
                  </Link>
                </article>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
