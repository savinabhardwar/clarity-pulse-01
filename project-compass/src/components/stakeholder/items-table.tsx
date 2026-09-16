import {
  Clock,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PriorityTag, StatusBadge } from "@/components/stakeholder/badges";
import { ItemDetailDrawer } from "@/components/stakeholder/item-detail";
import { ItemFormDrawer } from "@/components/stakeholder/item-form";
import { ItemHistoryDrawer } from "@/components/stakeholder/item-history";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAttachments,
  useItemJiraLinks,
  useItems,
  useSoftDeleteItem,
  useUpdateItem,
} from "@/data/queries";
import {
  JIRA_STATUSES,
  STAKEHOLDER_STATUSES,
  type ItemDraft,
  type ItemKind,
  type Project,
  type StakeholderItem,
} from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

const columns = [
  "Summary",
  "Description",
  "Jira Ticket Links",
  "Status",
  "Priority",
  "Created By",
  "Date Added",
  "Required By Date",
  "Will Be Done By Date",
  "Attach Document",
  "Actions",
  "History",
];

function fmtDate(at: string) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function JiraLinksCell({ itemId }: { itemId: string }) {
  const { data: links } = useItemJiraLinks(itemId);
  if (!links || links.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((link) => (
        <a
          key={link.id}
          href={link.jiraUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
        >
          {link.jiraKey}
          <ExternalLink className="size-3" />
        </a>
      ))}
    </div>
  );
}

function AttachmentsCell({ itemId }: { itemId: string }) {
  const { data: attachments } = useAttachments(itemId);
  if (!attachments || attachments.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap">
      <Paperclip className="size-3.5 text-muted-foreground" />
      {attachments.length === 1 ? attachments[0]!.name : `${attachments.length} files`}
    </span>
  );
}

const DATE_FIELD_LABEL: Record<"requiredBy" | "willBeDoneBy", string> = {
  requiredBy: "Required by",
  willBeDoneBy: "Will be done by",
};

function InlineDateCell({
  item,
  field,
}: {
  item: StakeholderItem;
  field: "requiredBy" | "willBeDoneBy";
}) {
  const updateItem = useUpdateItem();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item[field] ?? "");

  function startEditing() {
    setValue(item[field] ?? "");
    setEditing(true);
  }

  function save() {
    const nextValue = value || null;
    setEditing(false);
    if (nextValue === (item[field] ?? null)) return;

    const draft: ItemDraft = {
      requestType: item.requestType,
      summary: item.summary,
      description: item.description,
      status: item.status,
      statusKind: item.statusKind,
      priority: item.priority,
      createdBy: item.createdBy,
      requiredBy: item.requiredBy,
      willBeDoneBy: item.willBeDoneBy,
      [field]: nextValue,
    };

    updateItem.mutate(
      { id: item.id, draft },
      {
        onSuccess: () => toast.success(`${DATE_FIELD_LABEL[field]} date updated`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (editing) {
    return (
      <Input
        type="date"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="h-8 w-[150px]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="rounded px-1 py-0.5 text-left hover:bg-muted hover:underline"
    >
      {item[field] || "—"}
    </button>
  );
}

export function ItemsTable({ project, kind }: { project: Project; kind: ItemKind }) {
  const { data: items, isLoading, isError } = useItems(project.id, kind);
  const softDelete = useSoftDeleteItem();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StakeholderItem | null>(null);
  const [viewing, setViewing] = useState<StakeholderItem | null>(null);
  const [history, setHistory] = useState<StakeholderItem | null>(null);
  const [deleting, setDeleting] = useState<StakeholderItem | null>(null);

  const label = kind === "feature" ? "Feature" : "Client Request";
  const filtersActive = !!search || statuses.length > 0 || !!from || !!to;

  const filtered = useMemo(
    () =>
      (items ?? []).filter((it) => {
        if (search && !it.summary.toLowerCase().includes(search.toLowerCase())) return false;
        if (statuses.length && !statuses.includes(it.status)) return false;
        if (from && (!it.requiredBy || it.requiredBy < from)) return false;
        if (to && (!it.requiredBy || it.requiredBy > to)) return false;
        return true;
      }),
    [items, search, statuses, from, to],
  );

  function clearFilters() {
    setSearch("");
    setStatuses([]);
    setFrom("");
    setTo("");
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function confirmDelete() {
    if (!deleting) return;
    softDelete.mutate(
      { id: deleting.id, projectId: project.id, kind },
      {
        onSuccess: () => toast.success(`${label} deleted`),
        onError: (err) => toast.error(err.message),
      },
    );
    setDeleting(null);
  }

  const jiraOnly = JIRA_STATUSES.filter(
    (s) => !(STAKEHOLDER_STATUSES as readonly string[]).includes(s),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-raised">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label htmlFor="search" className="text-xs text-muted-foreground">
            Search summary
          </Label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()} summary…`}
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-w-[170px] justify-between font-normal">
                {statuses.length ? `${statuses.length} selected` : "All statuses"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <div className="max-h-72 overflow-y-auto p-2">
                <p className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Stakeholder statuses
                </p>
                {STAKEHOLDER_STATUSES.map((s) => (
                  <label
                    key={`f-stk-${s}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={statuses.includes(s)}
                      onCheckedChange={() => toggleStatus(s)}
                    />
                    {s}
                  </label>
                ))}
                <p className="px-2 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Jira statuses
                </p>
                {jiraOnly.map((s) => (
                  <label
                    key={`f-jira-${s}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={statuses.includes(s)}
                      onCheckedChange={() => toggleStatus(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Required by — from</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>

        <Button
          variant="ghost"
          onClick={clearFilters}
          disabled={!filtersActive}
          className="text-muted-foreground"
        >
          <X className="size-4" /> Clear filters
        </Button>

        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="ml-auto"
        >
          <Plus className="size-4" /> Add {label}
        </Button>
      </div>

      <div className="table-shell">
        <div className="scroll-slim overflow-x-auto">
          <Table className="min-w-[1750px] text-sm">
            <TableHeader>
              <TableRow className="bg-surface hover:bg-surface">
                {columns.map((c) => (
                  <TableHead
                    key={c}
                    className={cn(
                      "h-10 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase whitespace-nowrap",
                      c === "Summary" && "sticky left-0 z-10 bg-surface",
                    )}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-14 text-center">
                    <p className="font-medium text-destructive">
                      Couldn't load {label.toLowerCase()} items
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">Please refresh the page.</p>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-14 text-center">
                    <p className="font-medium">
                      {items && items.length > 0
                        ? `No ${label.toLowerCase()} items match your filters`
                        : `No ${label.toLowerCase()} items yet`}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {items && items.length > 0
                        ? "Adjust the filters or add a new item."
                        : "Add one to get started."}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((it) => (
                  <TableRow key={it.id} className="align-top">
                    <TableCell className="sticky left-0 z-10 max-w-[280px] bg-card">
                      <button
                        onClick={() => setViewing(it)}
                        className="text-left font-medium text-foreground hover:text-brand hover:underline"
                      >
                        {it.summary}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[320px] text-muted-foreground">
                      <span className="line-clamp-2">{it.description || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <JiraLinksCell itemId={it.id} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={it.status} kind={it.statusKind} />
                    </TableCell>
                    <TableCell>
                      <PriorityTag priority={it.priority} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{it.createdBy}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(it.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <InlineDateCell item={it} field="requiredBy" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <InlineDateCell item={it} field="willBeDoneBy" />
                    </TableCell>
                    <TableCell>
                      <AttachmentsCell itemId={it.id} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Row actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewing(it)}>
                            <Eye className="size-4" /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(it);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(it)}
                          >
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="View audit history"
                        title="View audit history"
                        onClick={() => setHistory(it)}
                      >
                        <Clock className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-surface px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing {filtered.length} of {items?.length ?? 0} {label.toLowerCase()} items
          </span>
        </div>
      </div>

      <ItemFormDrawer
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditing(null);
        }}
        project={project}
        kind={kind}
        item={editing}
        onSaved={() => {
          toast.success(editing ? `${label} updated` : `${label} added`);
          setEditing(null);
        }}
      />

      <ItemDetailDrawer
        item={viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        onEdit={(it) => {
          // Items in this table are always scoped to `project` (from
          // useItems), so projectId is never null here.
          setViewing(null);
          setEditing(it as StakeholderItem);
          setFormOpen(true);
        }}
        onDelete={(it) => {
          setViewing(null);
          setDeleting(it as StakeholderItem);
        }}
      />

      <ItemHistoryDrawer item={history} onOpenChange={(v) => !v && setHistory(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {label.toLowerCase()} item?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.summary}” will be removed from the list. Its audit history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
