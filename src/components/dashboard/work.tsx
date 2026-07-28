import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { people, projectById, type Ticket } from "@/data/dashboard";
import {
  AllocationBar,
  Avatar,
  Chip,
  HealthBadge,
  KeyValue,
  Meter,
  StatusPill,
  PriorityPill,
} from "./primitives";

export function TicketList({ title, tickets }: { title: string; tickets: Ticket[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.key} className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/15">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-xs font-semibold text-muted-foreground">{t.key}</span>
                <StatusPill status={t.status} />
                <PriorityPill priority={t.priority} />
              </div>
              <p className="mt-1.5 text-sm">{t.title}</p>
              <p className="num mt-1 text-xs text-muted-foreground">
                {projectById(t.projectId).name} · est {t.estimate ?? "—"}h · logged {t.logged}h · updated {t.updated}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PersonAllocationCard({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const p = people.find((x) => x.id === personId)!;
  return (
    <article className="card-soft card-hover">
      <div className="grid gap-5 p-5 lg:grid-cols-[16rem_1fr_14rem]">
        <div className="flex items-center gap-3">
          <Avatar person={p} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.name}</p>
            <p className="text-sm text-muted-foreground">{p.role}</p>
            <Chip className="mt-1">{p.team}</Chip>
          </div>
        </div>

        <div>
          <AllocationBar
            segments={p.allocations.map((a) => ({
              label: projectById(a.projectId).name,
              pct: a.pct,
              hours: a.hours,
              color: projectById(a.projectId).color,
            }))}
            height="h-4"
          />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {p.allocations.map((a) => (
              <li key={a.projectId} className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full" style={{ backgroundColor: projectById(a.projectId).color }} />
                <span className="flex-1 truncate">{projectById(a.projectId).name}</span>
                <span className="num font-semibold">{a.pct}%</span>
                <span className="num w-12 text-right text-xs text-muted-foreground">{a.hours}h</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Utilisation</span>
            <span className="num font-semibold">{p.utilisation}%</span>
          </div>
          <Meter value={p.utilisation} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bandwidth</span>
            <span className={cn("num font-semibold", p.bandwidthHours < 0 ? "text-danger" : "text-success")}>{p.bandwidthHours}h</span>
          </div>
          <HealthBadge health={p.health} />
          {p.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {p.riskFlags.map((f) => (
                <Chip key={f} tone="danger">
                  {f}
                </Chip>
              ))}
            </div>
          )}
          <Link to="/people" search={{ q: "", person: p.id }} className="inline-block pt-1 text-sm font-medium text-info hover:underline">
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
          <TicketList title="Current tickets" tickets={p.current} />
          <TicketList title="Upcoming work" tickets={p.upcoming} />
          <div className="space-y-4">
            <TicketList title="Recently completed" tickets={p.completed} />
            <div className="grid grid-cols-2 gap-3">
              <KeyValue label="Hours logged" value={`${p.hoursLogged}h`} />
              <KeyValue label="Estimated hours" value={`${p.estimatedHours}h`} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}