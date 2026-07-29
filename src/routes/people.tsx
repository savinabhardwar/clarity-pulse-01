import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { ChevronDown, Search, MessageSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AllocationBar,
  Avatar,
  DateRangeFilter,
  HealthBadge,
  KeyValue,
  LowConfidenceNote,
  Meter,
  PageHeader,
  SectionHeading,
  UnconfirmedBadge,
} from "@/components/dashboard/primitives";
import { TicketList } from "@/components/dashboard/work";
import { QueryBoundary } from "@/components/dashboard/query-state";
import { usePeople, usePersonDetail, toHealth, type PersonRow } from "@/data/queries";

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
        content:
          "A complete view of every engineer: what they are working on, hours logged, bandwidth, velocity and risk flags.",
      },
      { property: "og:title", content: "People — Workload, Delivery & Bandwidth" },
      {
        property: "og:description",
        content: "What everyone is working on, and who has room for more.",
      },
    ],
  }),
  component: PeoplePage,
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function PeoplePage() {
  const { q, person } = Route.useSearch();
  const navigate = useNavigate({ from: "/people" });
  const people = usePeople();

  const query = q.toLowerCase();
  // v_people_overview doesn't carry per-person project names (it's a flat
  // rollup), so searching by project would mean an N+1 allocation fetch
  // across every person just to filter a list. Search is name/role/team only.
  const filtered = (people.data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.role ?? "").toLowerCase().includes(query) ||
      (p.team ?? "").toLowerCase().includes(query),
  );

  return (
    <div className="space-y-8">
      <PageHeader title="People" question="What is everyone working on, and who has room for more?">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            value={null}
            onChange={() => {}}
            disabled
            disabledReason="Utilisation/bandwidth here are a live snapshot recomputed on every sync, not stored history — there's no past date to filter into."
          />
          <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) =>
                navigate({
                  search: (prev: { q: string; person: string }) => ({ ...prev, q: e.target.value }),
                })
              }
              placeholder="Search by name, role or team"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </PageHeader>
      <p className="-mt-6 text-xs text-muted-foreground">
        Current-sprint snapshot as of the last sync, not a historical trend.
      </p>

      <QueryBoundary
        isLoading={people.isLoading}
        isError={people.isError}
        error={people.error as Error | null}
      >
        <div className="space-y-4">
          {filtered.map((p) => (
            <PersonProfile
              key={p.id}
              person={p}
              open={person === p.id}
              onToggle={() =>
                navigate({
                  search: (prev: { q: string; person: string }) => ({
                    ...prev,
                    person: person === p.id ? "" : p.id,
                  }),
                })
              }
            />
          ))}
          {filtered.length === 0 && (
            <p className="card-soft p-8 text-center text-sm text-muted-foreground">
              No people match that search.
            </p>
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}

function PersonProfile({
  person,
  open,
  onToggle,
}: {
  person: PersonRow;
  open: boolean;
  onToggle: () => void;
}) {
  const p = person;
  const detail = usePersonDetail(open ? p.id : undefined);

  return (
    <article className={cn("card-soft overflow-hidden transition-shadow", open && "shadow-lift")}>
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-5 px-5 py-4 text-left hover:bg-secondary/40"
      >
        <Avatar person={{ name: p.name, initials: initials(p.name) }} size="lg" />
        <div className="min-w-[12rem] flex-1">
          <p className="font-semibold">{p.name}</p>
          <p className="text-sm text-muted-foreground">
            {p.role ?? "Engineer"} · {p.team ?? "Unassigned team"}
          </p>
          {p.team_guessed && <UnconfirmedBadge label="team assignment" className="mt-1" />}
        </div>
        <div className="w-44">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Utilisation</span>
            <span className="num">{p.utilisation_pct}%</span>
          </div>
          <Meter value={p.utilisation_pct} />
          {p.target_hours_is_fallback && (
            <LowConfidenceNote reason="no tracked sprint dates — 60h flat guess" className="mt-1" />
          )}
          {p.overallocation_reason && (
            <p className="mt-1 text-xs text-muted-foreground">{p.overallocation_reason}</p>
          )}
        </div>
        <div className="w-24">
          <p className="text-xs text-muted-foreground">Bandwidth</p>
          <p
            className={cn(
              "num font-semibold",
              p.bandwidth_hours < 0 ? "text-danger" : "text-success",
            )}
          >
            {p.bandwidth_hours}h
          </p>
        </div>
        <HealthBadge health={toHealth(p.health)} />
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-8 border-t border-border bg-secondary/20 p-5">
          <QueryBoundary
            isLoading={detail.isLoading}
            isError={detail.isError}
            error={detail.error as Error | null}
            loadingLabel="Loading profile…"
          >
            {detail.data && (
              <>
                <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  <KeyValue label="Hours logged" value={`${p.hours_logged}h`} />
                  <KeyValue
                    label="Bandwidth"
                    value={`${p.bandwidth_hours}h`}
                    tone={p.bandwidth_hours < 0 ? "danger" : "success"}
                  />
                  <KeyValue label="Projects" value={detail.data.allocations.length} />
                  <KeyValue label="Velocity" value={`${p.velocity} pts`} />
                  <KeyValue
                    label="Estimate accuracy"
                    value={p.estimate_accuracy !== null ? `${p.estimate_accuracy}%` : "—"}
                    tone={
                      p.estimate_accuracy !== null && p.estimate_accuracy < 80
                        ? "warning"
                        : "success"
                    }
                  />
                </section>

                <section className="grid gap-6 lg:grid-cols-3">
                  <TicketList title="Working on" tickets={detail.data.current} />
                  <TicketList title="Completed this sprint" tickets={detail.data.completed} />
                  <TicketList title="Queued work" tickets={detail.data.upcoming} />
                </section>

                <section className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <SectionHeading title="Project allocation" />
                    <div className="card-soft p-5">
                      <AllocationBar
                        height="h-4"
                        segments={detail.data.allocations.map((a) => ({
                          label: a.projectName,
                          pct: a.pct,
                          hours: a.hours,
                          color: a.color ?? "var(--chart-1)",
                        }))}
                      />
                      <ul className="mt-4 space-y-2">
                        {detail.data.allocations.map((a) => (
                          <li key={a.projectId} className="flex items-center gap-2 text-sm">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: a.color ?? undefined }}
                            />
                            <span className="flex-1">{a.projectName}</span>
                            <span className="num font-semibold">{a.pct}%</span>
                            <span className="num w-14 text-right text-xs text-muted-foreground">
                              {a.hours}h
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <SectionHeading title="Risk flags" className="mt-6" />
                    <div className="card-soft p-5">
                      {p.risk_flags.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No risk flags. Estimates, worklogs and comments are all current.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {p.risk_flags.map((f) => (
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
                    {/* get_person_detail has no timeline/updates feed (those were
                        mock-only fields) — recent comments is the real activity
                        signal the RPC returns, so it stands alone here. */}
                    <SectionHeading title="Recent comments" />
                    <ul className="card-soft divide-y divide-border">
                      {detail.data.comments.length === 0 ? (
                        <li className="px-5 py-3 text-sm text-muted-foreground">
                          No recent comments.
                        </li>
                      ) : (
                        detail.data.comments.map((c, i) => (
                          <li key={i} className="flex gap-3 px-5 py-3">
                            <MessageSquare className="mt-0.5 size-4 shrink-0 text-info" />
                            <div>
                              <p className="text-sm">{c.text}</p>
                              <p className="num text-xs text-muted-foreground">
                                {c.ticket} · {new Date(c.when).toLocaleDateString()}
                              </p>
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </section>
              </>
            )}
          </QueryBoundary>
        </div>
      )}
    </article>
  );
}
