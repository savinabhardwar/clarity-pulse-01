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
import { people, projects } from "@/data/dashboard";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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

  const tickets = people.flatMap((p) =>
    [...p.current, ...p.upcoming, ...p.completed].map((t) => ({ ...t, owner: p.name })),
  );
  const features = projects.flatMap((p) => p.delivered.map((d) => ({ ...d, projectId: p.id, projectName: p.name })));

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
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 text-[10px] font-medium md:inline">⌘K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search projects, people, tickets and features…" />
        <CommandList>
          <CommandEmpty>No matches found.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.purpose}`}
                onSelect={() => go(() => navigate({ to: "/projects", search: { project: p.id } }))}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.health}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="People">
            {people.map((p) => (
              <CommandItem
                key={p.id}
                value={`person ${p.name} ${p.role} ${p.team}`}
                onSelect={() => go(() => navigate({ to: "/people", search: { person: p.id, q: "" } }))}
              >
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {p.role} · {p.utilisation}%
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Features delivered">
            {features.map((f) => (
              <CommandItem
                key={`${f.projectId}-${f.name}`}
                value={`feature ${f.name} ${f.projectName}`}
                onSelect={() => go(() => navigate({ to: "/projects", search: { project: f.projectId } }))}
              >
                <span>{f.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {f.projectName} · {f.sprint}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Tickets">
            {tickets.map((t) => (
              <CommandItem
                key={`${t.key}-${t.owner}`}
                value={`ticket ${t.key} ${t.title} ${t.owner}`}
                onSelect={() => go(() => navigate({ to: "/projects", search: { project: t.projectId } }))}
              >
                <span className="num text-xs font-semibold text-muted-foreground">{t.key}</span>
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t.status}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}