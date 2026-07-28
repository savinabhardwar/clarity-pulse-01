import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export function QueryLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function QueryError({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="card-soft flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertTriangle className="size-6 text-danger" />
      <p className="text-sm font-medium text-foreground">Couldn't load this data</p>
      <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
      {retry && (
        <button
          onClick={retry}
          className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Thin boundary so each route doesn't repeat isLoading/isError branching. */
export function QueryBoundary({
  isLoading,
  isError,
  error,
  retry,
  loadingLabel,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  retry?: () => void;
  loadingLabel?: string;
  children: ReactNode;
}) {
  if (isLoading) return <QueryLoading label={loadingLabel} />;
  if (isError) return <QueryError error={error ?? new Error("Unknown error")} retry={retry} />;
  return <>{children}</>;
}
