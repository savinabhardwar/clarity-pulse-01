import {
  Clock,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  FilterBar,
  type MultiSelectFilterConfig,
  type SortDirection,
} from "./table-filter-controls";
import {
  useAttachments,
  useItemJiraLinks,
  useItems,
  useSoftDeleteItem,
  useUpdateItem,
} from "@/data/queries";
import {
  JIRA_STATUSES,
  PRIORITIES,
  PRIORITY_RANK,
  REQUEST_TYPES,
  STAKEHOLDER_STATUSES,
  type ItemDraft,
  type ItemKind,
  type Project,
  type StakeholderItem,
} from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

type SortField = "createdAt" | "updatedAt" | "requiredBy" | "willBeDoneBy" | "priority";

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: "createdAt", label: "Date Added" },
  { value: "updatedAt", label: "Last Updated" },
  { value: "requiredBy", label: "Required By Date" },
  { value: "willBeDoneBy", label: "Will Be Done By Date" },
  { value: "priority", label: "Priority" },
];

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
  const [requestTypes, setRequestTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StakeholderItem | null>(null);
  const [viewing, setViewing] = useState<StakeholderItem | null>(null);
  const [history, setHistory] = useState<StakeholderItem | null>(null);
  const [deleting, setDeleting] = useState<StakeholderItem | null>(null);

  const label = kind === "feature" ? "Feature" : "Client Request";
  const filtersActive =
    !!search ||
    statuses.length > 0 ||
    requestTypes.length > 0 ||
    priorities.length > 0 ||
    !!from ||
    !!to;

  const filtered = useMemo(
    () =>
      (items ?? []).filter((it) => {
        if (search && !it.summary.toLowerCase().includes(search.toLowerCase())) return false;
        if (statuses.length && !statuses.includes(it.status)) return false;
        if (requestTypes.length && (!it.requestType || !requestTypes.includes(it.requestType)))
          return false;
        if (priorities.length && !priorities.includes(it.priority)) return false;
        if (from && (!it.requiredBy || it.requiredBy < from)) return false;
        if (to && (!it.requiredBy || it.requiredBy > to)) return false;
        return true;
      }),
    [items, search, statuses, requestTypes, priorities, from, to],
  );

  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === "priority") {
        return dir * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      }
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      if (!aVal && !bVal) return 0;
      if (!aVal) return 1;
      if (!bVal) return -1;
      return dir * aVal.localeCompare(bVal);
    });
  }, [filtered, sortField, sortDirection]);

  function clearFilters() {
    setSearch("");
    setStatuses([]);
    setRequestTypes([]);
    setPriorities([]);
    setFrom("");
    setTo("");
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function toggleRequestType(t: string) {
    setRequestTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function togglePriority(p: string) {
    setPriorities((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
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

  const multiSelects: MultiSelectFilterConfig[] = [
    {
      key: "status",
      label: "Status",
      emptyLabel: "All statuses",
      groups: [
        {
          label: "Stakeholder statuses",
          options: STAKEHOLDER_STATUSES.map((s) => ({ value: s, label: s })),
        },
        { label: "Jira statuses", options: jiraOnly.map((s) => ({ value: s, label: s })) },
      ],
      selected: statuses,
      onToggle: toggleStatus,
    },
    {
      key: "requestType",
      label: "Request Type",
      emptyLabel: "All request types",
      width: "min-w-[190px]",
      options: REQUEST_TYPES.map((r) => ({ value: r.value, label: r.label })),
      selected: requestTypes,
      onToggle: toggleRequestType,
    },
    {
      key: "priority",
      label: "Priority",
      emptyLabel: "All priorities",
      width: "min-w-[150px]",
      options: PRIORITIES.map((p) => ({ value: p, label: p })),
      selected: priorities,
      onToggle: togglePriority,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: `Search ${label.toLowerCase()} summary…`,
        }}
        multiSelects={multiSelects}
        dateRange={{ label: "Required by", from, to, onFromChange: setFrom, onToChange: setTo }}
        sort={{
          field: sortField,
          direction: sortDirection,
          fields: SORT_FIELDS,
          onFieldChange: setSortField,
          onDirectionChange: setSortDirection,
        }}
        filtersActive={filtersActive}
        onClear={clearFilters}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="ml-auto"
          >
            <Plus className="size-4" /> Add {label}
          </Button>
        }
      />

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
              ) : sorted.length === 0 ? (
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
                sorted.map((it) => (
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
            Showing {sorted.length} of {items?.length ?? 0} {label.toLowerCase()} items
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
