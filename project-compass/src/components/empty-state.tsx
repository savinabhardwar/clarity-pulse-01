import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared empty-state treatment (icon + title + optional description/action)
// so every list/table/panel in the app renders "intentionally empty" the
// same way, instead of each one improvising its own plain-text message.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 py-14 text-center", className)}
    >
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground/50">
        <Icon className="size-6" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
