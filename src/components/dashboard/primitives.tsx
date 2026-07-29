import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Health, Person } from "@/data/dashboard";

export type DateRangeValue = { from: string; to: string } | null;

export function dateRangeToIso(range: DateRangeValue): { from: string | null; to: string | null } {
  if (!range) return { from: null, to: null };
  return {
    from: range.from ? new Date(range.from + "T00:00:00").toISOString() : null,
    to: range.to ? new Date(range.to + "T23:59:59").toISOString() : null,
  };
}

// Plain <input type="date"> + <button>, deliberately not a dropdown/popover
// component — this is the same native-element pattern already proven to
// work elsewhere in this app (the /projects project picker, /people
// search box), rather than a portal-based widget with no in-app precedent.
export function DateRangeFilter({
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const from = value?.from ?? "";
  const to = value?.to ?? "";
  return (
    <div
      className="flex items-center gap-1.5"
      title={disabled ? disabledReason : undefined}
    >
      <input
        type="date"
        value={from}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || to ? { from: e.target.value, to } : null)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <input
        type="date"
        value={to}
        disabled={disabled}
        onChange={(e) => onChange(from || e.target.value ? { from, to: e.target.value } : null)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      />
      {value && !disabled && (
        <button
          onClick={() => onChange(null)}
          className="text-sm font-medium text-info hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// Deliberately loud, not a quiet "(guessed)" suffix — one wrong
// auto-guess (team assignment, project clustering) reads as a data
// error and erodes trust in every other number on the page unless it's
// visually impossible to miss.
export function UnconfirmedBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning",
        className,
      )}
      title="Auto-derived, not human-confirmed"
    >
      <span className="size-1.5 rounded-full bg-warning" />
      Unconfirmed: {label}
    </span>
  );
}

export function LowConfidenceNote({ reason, className }: { reason: string; className?: string }) {
  return (
    <p className={cn("text-xs font-medium text-warning", className)} title={reason}>
      ⚠ Low-confidence number — {reason}
    </p>
  );
}

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const map: Record<Health, string> = {
    "On Track": "bg-success-soft text-success border-success/20",
    "Needs Attention": "bg-warning-soft text-warning border-warning/25",
    "At Risk": "bg-danger-soft text-danger border-danger/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        map[health],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {health}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground border-border",
    success: "bg-success-soft text-success border-success/20",
    warning: "bg-warning-soft text-warning border-warning/25",
    danger: "bg-danger-soft text-danger border-danger/20",
    info: "bg-info-soft text-info border-info/20",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Blocked" ? "danger" : status === "Done" ? "success" : status === "QA" || status === "In Review" ? "info" : "neutral";
  return <Chip tone={tone as "danger"}>{status}</Chip>;
}

export function PriorityPill({ priority }: { priority: string }) {
  const tone = priority === "Critical" ? "danger" : priority === "High" ? "warning" : "neutral";
  return <Chip tone={tone as "danger"}>{priority}</Chip>;
}

export function Avatar({ person, size = "md" }: { person: Pick<Person, "initials" | "name">; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-12 text-sm" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        sizes[size],
      )}
      title={person.name}
    >
      {person.initials}
    </span>
  );
}

export function AvatarStack({ people, max = 5 }: { people: Pick<Person, "initials" | "name">[]; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex -space-x-2">
      {shown.map((p) => (
        <span
          key={p.name}
          title={p.name}
          className="inline-flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-semibold text-secondary-foreground"
        >
          {p.initials}
        </span>
      ))}
      {people.length > max && (
        <span className="inline-flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
          +{people.length - max}
        </span>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
  footer,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  icon?: ReactNode;
  footer?: ReactNode;
}) {
  const valueTone = {
    neutral: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];
  return (
    <div className="card-soft card-hover p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className={cn("num mt-2 text-2xl font-semibold", valueTone)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      {footer && <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function Meter({ value, tone, className }: { value: number; tone?: "success" | "warning" | "danger"; className?: string }) {
  const t = tone ?? (value > 100 ? "danger" : value > 90 ? "warning" : "success");
  const bg = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[t];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", bg)} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function AllocationBar({
  segments,
  height = "h-3",
}: {
  segments: { label: string; pct: number; color: string; hours: number }[];
  height?: string;
}) {
  const total = Math.max(100, segments.reduce((s, x) => s + x.pct, 0));
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", height)}>
      {segments.map((s) => (
        <div
          key={s.label}
          className="h-full transition-all first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(s.pct / total) * 100}%`, backgroundColor: s.color }}
          title={`${s.label} · ${s.pct}% · ${s.hours}h`}
        />
      ))}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "warning" | "success" }) {
  const toneClass = tone ? { danger: "text-danger", warning: "text-warning", success: "text-success" }[tone] : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-base font-semibold", toneClass)}>{value}</p>
    </div>
  );
}

export function PageHeader({ title, question, children }: { title: string; question: string; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{question}</p>
      </div>
      {children}
    </header>
  );
}