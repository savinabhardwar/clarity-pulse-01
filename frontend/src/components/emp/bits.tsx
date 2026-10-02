import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "On Track" || status === "Improving" || status === "Active"
      ? "bg-success/12 text-success border-success/25"
      : status === "At Risk" ||
          status === "Declining" ||
          status === "Delayed" ||
          status === "Blocked"
        ? "bg-destructive/10 text-destructive border-destructive/25"
        : status === "Needs Attention" || status === "Discovery"
          ? "bg-warning/15 text-warning-foreground border-warning/35"
          : "bg-secondary text-secondary-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone,
      )}
    >
      {status}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: "High" | "Medium" | "Low" }) {
  return (
    <span
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        severity === "High" ? "bg-destructive" : severity === "Medium" ? "bg-warning" : "bg-info",
      )}
    />
  );
}

export function Metric({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="stat-label">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Bar({
  value,
  tone = "primary",
}: {
  value: number;
  tone?: "primary" | "warn" | "danger";
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          tone === "danger" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("panel p-5", className)}>{children}</section>;
}
