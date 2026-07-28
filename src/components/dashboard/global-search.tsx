import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePeople, useProjects } from "@/data/queries";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: people = [] } = usePeople();
  const { data: projects = [] } = useProjects();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Ticket- and feature-level search would need every person's/project's
  // full detail fetched up front (N+1 RPC calls) just to populate a
  // command palette that's opened occasionally. Not worth the network
  // cost -- search narrows to projects and people, which cover the
  // overwhelming majority of "jump to..." usage, and still resolves to
  // the same destination routes.

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
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search projects and people…" />
        <CommandList>
          <CommandEmpty>No matches found.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.purpose ?? ""}`}
                onSelect={() =>
                  go(() => navigate({ to: "/projects", search: { project: p.slug } }))
                }
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: p.color ?? undefined }}
                />
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {p.health.replace("_", " ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="People">
            {people.map((p) => (
              <CommandItem
                key={p.id}
                value={`person ${p.name} ${p.role ?? ""} ${p.team ?? ""}`}
                onSelect={() =>
                  go(() => navigate({ to: "/people", search: { person: p.id, q: "" } }))
                }
              >
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {p.role ?? "Engineer"} · {p.utilisation_pct}%
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
