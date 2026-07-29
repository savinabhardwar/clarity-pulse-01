import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toPriorityLabel, usePersonDetail, type PersonRow } from "@/data/queries";
import {
  AllocationBar,
  Avatar,
  Chip,
  HealthBadge,
  KeyValue,
  LowConfidenceNote,
  Meter,
  StatusPill,
  PriorityPill,
  UnconfirmedBadge,
} from "./primitives";
import { QueryBoundary } from "./query-state";
import { toHealth } from "@/data/queries";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

interface DetailTicket {
  key: string;
  title: string;
  status: string;
  priority: string | null;
  estimate: number | null;
  logged?: number;
  updated?: string;
  projectName?: string;
}

export function TicketList({ title, tickets }: { title: string; tickets: DetailTicket[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li
              key={t.key}
              className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/15"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-xs font-semibold text-muted-foreground">{t.key}</span>
                <StatusPill status={t.status} />
                <PriorityPill priority={toPriorityLabel(t.priority)} />
              </div>
              <p className="mt-1.5 text-sm">{t.title}</p>
              <p className="num mt-1 text-xs text-muted-foreground">
                {t.projectName ?? "—"} · est {t.estimate ?? "—"}h · logged {t.logged ?? 0}h ·
                updated {t.updated ? new Date(t.updated).toLocaleDateString() : "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PersonAllocationCard({ person }: { person: PersonRow }) {
  const [open, setOpen] = useState(false);
  const detail = usePersonDetail(open ? person.id : undefined);
  const p = person;
  return (
    <article className="card-soft card-hover">
      <div className="grid gap-5 p-5 lg:grid-cols-[16rem_1fr_14rem]">
        <div className="flex items-center gap-3">
          <Avatar person={{ name: p.name, initials: initials(p.name) }} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.name}</p>
            <p className="text-sm text-muted-foreground">{p.role ?? "Engineer"}</p>
            <Chip className="mt-1">{p.team ?? "Unassigned"}</Chip>
            {p.team_guessed && <UnconfirmedBadge label="team assignment" className="mt-1" />}
            {p.target_hours_is_fallback && (
              <LowConfidenceNote reason="no tracked sprint dates — 80h flat guess" className="mt-1" />
            )}
            {p.overallocation_reason && (
              <p className="mt-1 text-xs text-muted-foreground">{p.overallocation_reason}</p>
            )}
          </div>
        </div>

        <div>
          {detail.data ? (
            <>
              <AllocationBar
                segments={detail.data.allocations.map((a) => ({
                  label: a.projectName,
                  pct: a.pct,
                  hours: a.hours,
                  color: a.color ?? "var(--chart-1)",
                }))}
                height="h-4"
              />
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {detail.data.allocations.map((a) => (
                  <li key={a.projectId} className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: a.color ?? undefined }}
                    />
                    <span className="flex-1 truncate">{a.projectName}</span>
                    <span className="num font-semibold">{a.pct}%</span>
                    <span className="num w-12 text-right text-xs text-muted-foreground">
                      {a.hours}h
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading allocation…</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Utilisation</span>
            <span className="num font-semibold">{p.utilisation_pct}%</span>
          </div>
          <Meter value={p.utilisation_pct} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bandwidth</span>
            <span
              className={cn(
                "num font-semibold",
                p.bandwidth_hours < 0 ? "text-danger" : "text-success",
              )}
            >
              {p.bandwidth_hours}h
            </span>
          </div>
          <HealthBadge health={toHealth(p.health)} />
          {p.risk_flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {p.risk_flags.map((f) => (
                <Chip key={f} tone="danger">
                  {f}
                </Chip>
              ))}
            </div>
          )}
          <Link
            to="/people"
            search={{ q: "", person: p.id }}
            className="inline-block pt-1 text-sm font-medium text-info hover:underline"
          >
            Full profile
          </Link>
        </div>
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      >
        {open ? "Hide detail" : "Show work detail"}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid gap-6 border-t border-border bg-secondary/20 p-5 lg:grid-cols-3">
          <QueryBoundary
            isLoading={detail.isLoading}
            isError={detail.isError}
            error={detail.error as Error | null}
            loadingLabel="Loading work detail…"
          >
            {detail.data && (
              <>
                <TicketList title="Current tickets" tickets={detail.data.current} />
                <TicketList title="Upcoming work" tickets={detail.data.upcoming} />
                <div className="space-y-4">
                  <TicketList title="Recently completed" tickets={detail.data.completed} />
                  <div className="grid grid-cols-2 gap-3">
                    <KeyValue label="Hours logged" value={`${p.hours_logged}h`} />
                    <KeyValue label="Estimated hours" value={`${p.estimated_hours}h`} />
                  </div>
                </div>
              </>
            )}
          </QueryBoundary>
        </div>
      )}
    </article>
  );
}
