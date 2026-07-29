import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { usePeople, useProjects } from "@/data/queries";

// Plain fixed-position overlay + native <input>, not a Radix
// Dialog/cmdk command palette -- that stack was the only place in this
// entire app using Dialog, completely unverified, and turned out to be
// why global search silently didn't work. Same native-element pattern
// already proven on /people and /projects' own search boxes.
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data: people = [] } = usePeople();
  const { data: projects = [] } = useProjects();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Focus after the overlay actually mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Ticket- and feature-level search would need every person's/project's
  // full detail fetched up front (N+1 RPC calls) just to populate a
  // command palette that's opened occasionally. Not worth the network
  // cost -- search narrows to projects and people, which cover the
  // overwhelming majority of "jump to..." usage, and still resolves to
  // the same destination routes.
  const q = query.trim().toLowerCase();
  const matchedProjects = projects
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.purpose ?? "").toLowerCase().includes(q))
    .slice(0, 8);
  const matchedPeople = people
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.role ?? "").toLowerCase().includes(q) ||
        (p.team ?? "").toLowerCase().includes(q),
    )
    .slice(0, 8);

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 text-[10px] font-medium md:inline">
          ⌘K
        </kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]">
          <button
            aria-label="Close search"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <div className="relative w-full max-w-lg overflow-hidden rounded-lg border border-border bg-popover shadow-lift">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects and people…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {matchedProjects.length === 0 && matchedPeople.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No matches found.</p>
              )}
              {matchedProjects.length > 0 && (
                <div className="p-1">
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Projects</p>
                  {matchedProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        go(() => navigate({ to: "/projects", search: { project: p.slug, from: "", to: "", view: "development" } }))
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: p.color ?? undefined }}
                      />
                      <span>{p.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {p.health.replace("_", " ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {matchedPeople.length > 0 && (
                <div className="p-1">
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">People</p>
                  {matchedPeople.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => go(() => navigate({ to: "/people", search: { person: p.id, q: "", from: "", to: "" } }))}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span>{p.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {p.role ?? "Engineer"} · {p.utilisation_pct}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
