import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, Gauge, Sparkles, ShieldCheck, Timer, Target } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Avatar,
  Chip,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  PriorityPill,
  SectionHeading,
  StatCard,
} from "@/components/dashboard/primitives";
import { allBlockers, orgMetrics, people, personById, standouts } from "@/data/dashboard";

export const Route = createFileRoute("/team-health")({
  head: () => ({
    meta: [
      { title: "Team Health — Is Jira Trustworthy Enough to Plan With?" },
      {
        name: "description",
        content: "Estimate coverage, blocked work, dark WIP and Jira hygiene per engineer, plus recognition for different strengths.",
      },
      { property: "og:title", content: "Team Health — Is Jira Trustworthy Enough to Plan With?" },
      { property: "og:description", content: "Data quality, blocked work and hygiene signals behind every other number." },
    ],
  }),
  component: TeamHealth,
});

function TeamHealth() {
  const m = orgMetrics;
  return (
    <div className="space-y-8">
      <PageHeader title="Team Health" question="Is our engineering data reliable enough to plan with?" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Estimate Coverage"
          value={`${m.estimateCoverage}%`}
          sub="Tickets with an estimate"
          tone={m.estimateCoverage > 85 ? "success" : "warning"}
          icon={<Gauge className="size-4" />}
        />
        <StatCard label="Blocked Tickets" value={m.blocked} sub="Across all projects" tone="danger" icon={<Timer className="size-4" />} />
        <StatCard label="Dark WIP" value={m.darkWip} sub="In progress with no recent worklog" tone="warning" icon={<Sparkles className="size-4" />} />
        <StatCard
          label="Closed Without Logs"
          value={m.closedWithoutLogs}
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
                <Avatar person={p} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold">{p.name}</p>
                    <HealthBadge health={p.health} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {p.role} · {p.team}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Estimate coverage</span>
                  <span className="num">{p.estimateCoverage}%</span>
                </div>
                <Meter value={p.estimateCoverage} tone={p.estimateCoverage > 85 ? "success" : p.estimateCoverage > 70 ? "warning" : "danger"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <KeyValue label="Worklogs" value={p.worklogs} />
                <KeyValue label="Comments" value={p.commentCount} />
                <KeyValue label="Dark WIP" value={p.darkWip} tone={p.darkWip > 0 ? "warning" : "success"} />
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
          <SectionHeading title="Blocked work" description="Sorted by how long the work has been stuck." />
          <div className="card-soft divide-y divide-border">
            {[...allBlockers]
              .sort((a, b) => b.days - a.days)
              .map((b) => (
                <div key={b.ticket} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-[16rem] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs font-semibold text-muted-foreground">{b.ticket}</span>
                      <PriorityPill priority={b.priority} />
                    </div>
                    <p className="mt-1 text-sm">{b.title}</p>
                  </div>
                  <Chip>{b.projectName}</Chip>
                  <span className="w-32 text-sm">{b.owner}</span>
                  <div className="w-32">
                    <p className="text-xs text-muted-foreground">Blocked since</p>
                    <p className="text-sm">{b.since}</p>
                  </div>
                  <div className="w-24">
                    <p className="text-xs text-muted-foreground">Days</p>
                    <p className={cn("num text-sm font-semibold", b.days > 10 ? "text-danger" : "text-warning")}>{b.days}</p>
                  </div>
                  <div className="w-28">
                    <p className="text-xs text-muted-foreground">Last updated</p>
                    <p className="text-sm">{b.lastUpdated}</p>
                  </div>
                  <Link
                    to="/projects"
                    search={{ project: b.projectId }}
                    className="ml-auto text-sm font-medium text-info hover:underline"
                  >
                    View project
                  </Link>
                </div>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="hygiene" className="mt-6">
          <SectionHeading title="Jira hygiene" description="Can we trust each person's board? Click a row to open their profile." />
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
                  <Avatar person={p} size="sm" />
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.team}</span>
                  </span>
                </span>
                <span>
                  <Meter value={p.estimateCoverage} tone={p.estimateCoverage > 85 ? "success" : p.estimateCoverage > 70 ? "warning" : "danger"} />
                  <span className="num mt-1 block text-xs text-muted-foreground">{p.estimateCoverage}%</span>
                </span>
                <span className="num">{p.worklogs}</span>
                <span className="num">{p.commentCount}</span>
                <span className={cn("num", p.idleDays > 1 && "text-warning")}>{p.idleDays}</span>
                <span className={cn("num", p.darkWip > 0 && "text-warning")}>{p.darkWip}</span>
                <HealthBadge health={p.health} />
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="standouts" className="mt-6">
          <SectionHeading title="Standouts" description="Different strengths, not a leaderboard of hours." />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {standouts.map((s) => {
              const p = personById(s.personId);
              return (
                <article key={s.title} className="card-soft card-hover p-5">
                  <div className="flex items-center gap-2 text-info">
                    {s.title === "Best Estimate Accuracy" ? <Target className="size-4" /> : <Award className="size-4" />}
                    <p className="text-xs font-semibold uppercase tracking-wide">{s.title}</p>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Avatar person={p} size="lg" />
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {p.role} · {p.team}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{s.detail}</p>
                  <Link
                    to="/people"
                    search={{ q: "", person: p.id }}
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
    </div>
  );
}