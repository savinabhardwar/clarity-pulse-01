import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { ChevronDown, Search, MessageSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AllocationBar,
  Avatar,
  Chip,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  SectionHeading,
} from "@/components/dashboard/primitives";
import { TicketList } from "@/components/dashboard/work";
import { people, projectById } from "@/data/dashboard";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  person: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/people")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "People — Workload, Delivery & Bandwidth" },
      {
        name: "description",
        content: "A complete view of every engineer: what they are working on, hours logged, bandwidth, velocity and risk flags.",
      },
      { property: "og:title", content: "People — Workload, Delivery & Bandwidth" },
      { property: "og:description", content: "What everyone is working on, and who has room for more." },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const { q, person } = Route.useSearch();
  const navigate = useNavigate({ from: "/people" });
  const query = q.toLowerCase();
  const filtered = people.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      p.role.toLowerCase().includes(query) ||
      p.team.toLowerCase().includes(query) ||
      p.allocations.some((a) => projectById(a.projectId).name.toLowerCase().includes(query)),
  );

  return (
    <div className="space-y-8">
      <PageHeader title="People" question="What is everyone working on, and who has room for more?">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => navigate({ search: (prev: { q: string; person: string }) => ({ ...prev, q: e.target.value }) })}
            placeholder="Search by name, role, team or project"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </PageHeader>

      <div className="space-y-4">
        {filtered.map((p) => (
          <PersonProfile
            key={p.id}
            personId={p.id}
            open={person === p.id}
            onToggle={() => navigate({ search: (prev: { q: string; person: string }) => ({ ...prev, person: person === p.id ? "" : p.id }) })}
          />
        ))}
        {filtered.length === 0 && <p className="card-soft p-8 text-center text-sm text-muted-foreground">No people match that search.</p>}
      </div>
    </div>
  );
}

function PersonProfile({ personId, open, onToggle }: { personId: string; open: boolean; onToggle: () => void }) {
  const p = people.find((x) => x.id === personId)!;
  return (
    <article className={cn("card-soft overflow-hidden transition-shadow", open && "shadow-lift")}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-5 px-5 py-4 text-left hover:bg-secondary/40">
        <Avatar person={p} size="lg" />
        <div className="min-w-[12rem] flex-1">
          <p className="font-semibold">{p.name}</p>
          <p className="text-sm text-muted-foreground">
            {p.role} · {p.team}
          </p>
        </div>
        <div className="w-44">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Utilisation</span>
            <span className="num">{p.utilisation}%</span>
          </div>
          <Meter value={p.utilisation} />
        </div>
        <div className="w-24">
          <p className="text-xs text-muted-foreground">Bandwidth</p>
          <p className={cn("num font-semibold", p.bandwidthHours < 0 ? "text-danger" : "text-success")}>{p.bandwidthHours}h</p>
        </div>
        <HealthBadge health={p.health} />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-8 border-t border-border bg-secondary/20 p-5">
          <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <KeyValue label="Hours logged" value={`${p.hoursLogged}h`} />
            <KeyValue label="Bandwidth" value={`${p.bandwidthHours}h`} tone={p.bandwidthHours < 0 ? "danger" : "success"} />
            <KeyValue label="Projects" value={p.allocations.length} />
            <KeyValue label="Velocity" value={`${p.velocity} pts`} />
            <KeyValue label="Estimate accuracy" value={`${p.estimateAccuracy}%`} tone={p.estimateAccuracy < 80 ? "warning" : "success"} />
          </section>

          <section className="grid gap-6 lg:grid-cols-3">
            <TicketList title="Working on" tickets={p.current} />
            <TicketList title="Completed this sprint" tickets={p.completed} />
            <TicketList title="Queued work" tickets={p.upcoming} />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <SectionHeading title="Project allocation" />
              <div className="card-soft p-5">
                <AllocationBar
                  height="h-4"
                  segments={p.allocations.map((a) => ({
                    label: projectById(a.projectId).name,
                    pct: a.pct,
                    hours: a.hours,
                    color: projectById(a.projectId).color,
                  }))}
                />
                <ul className="mt-4 space-y-2">
                  {p.allocations.map((a) => (
                    <li key={a.projectId} className="flex items-center gap-2 text-sm">
                      <span className="size-2 rounded-full" style={{ backgroundColor: projectById(a.projectId).color }} />
                      <span className="flex-1">{projectById(a.projectId).name}</span>
                      <span className="num font-semibold">{a.pct}%</span>
                      <span className="num w-14 text-right text-xs text-muted-foreground">{a.hours}h</span>
                    </li>
                  ))}
                </ul>
              </div>

              <SectionHeading title="Risk flags" className="mt-6" />
              <div className="card-soft p-5">
                {p.riskFlags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No risk flags. Estimates, worklogs and comments are all current.</p>
                ) : (
                  <ul className="space-y-2">
                    {p.riskFlags.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <SectionHeading title="Activity timeline" />
              <ol className="card-soft divide-y divide-border">
                {p.timeline.map((t, i) => (
                  <li key={i} className="px-5 py-3">
                    <p className="text-sm">{t.text}</p>
                    <p className="text-xs text-muted-foreground">{t.when}</p>
                  </li>
                ))}
              </ol>

              <SectionHeading title="Recent comments" className="mt-6" />
              <ul className="card-soft divide-y divide-border">
                {p.comments.map((c, i) => (
                  <li key={i} className="flex gap-3 px-5 py-3">
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-info" />
                    <div>
                      <p className="text-sm">{c.text}</p>
                      <p className="num text-xs text-muted-foreground">
                        {c.ticket} · {c.when}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <SectionHeading title="Recent updates" className="mt-6" />
              <div className="card-soft flex flex-wrap gap-2 p-5">
                {p.updates.map((u) => (
                  <Chip key={u} tone="info">
                    {u}
                  </Chip>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </article>
  );
}