import { Link } from "@tanstack/react-router";
import {
  ArrowRightCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import {
  CreatedByCell,
  DecisionBadge,
  PriorityTag,
  ProjectBadge,
  RequestTypeBadge,
  StatusBadge,
} from "@/components/stakeholder/badges";
import { ClientRequestFormDrawer } from "@/components/stakeholder/client-request-form";
import { ClientRequestsKpis } from "@/components/stakeholder/client-requests-kpis";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useAssignClientRequestProject,
  useClientRequests,
  useProjects,
  useSoftDeleteItem,
  useUpdateItem,
} from "@/data/queries";
import {
  PRIORITIES,
  PRIORITY_RANK,
  REQUEST_TYPES,
  STAKEHOLDER_STATUSES,
  type ClientRequest,
  type ItemDraft,
  type Project,
  type RequestType,
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

type DateField = "requiredBy" | "willBeDoneBy";

const DATE_RANGE_FIELDS: { value: DateField; label: string }[] = [
  { value: "requiredBy", label: "Required By" },
  { value: "willBeDoneBy", label: "Will Be Done By" },
];

// Per the UI refinement spec's table (§4): Required By and Will Be Done By
// render as one "Will Be Done By" column, matching the reference screenshot
// -- not two. Required By is still filterable/sortable (see
// DATE_RANGE_FIELDS/SORT_FIELDS above) and still shown in the item detail
// drawer and edit form; it's just not a separate table column here.
const columns = [
  "Summary",
  "Project",
  "Request Type",
  "Description",
  "Status",
  "Priority",
  "Created By",
  "Date Added",
  "Will Be Done By",
  "Actions",
  "History",
];

const PAGE_SIZE = 20;

// Roughly matches each column's typical content width so the loading state
// doesn't visually jump into a different shape once real data arrives.
const SKELETON_WIDTHS = [
  "w-32", // Summary
  "w-24", // Project
  "w-20", // Request Type
  "w-40", // Description
  "w-16", // Status
  "w-14", // Priority
  "w-20", // Created By
  "w-20", // Date Added
  "w-20", // Will Be Done By
  "w-8", // Actions
  "w-8", // History
];

function fmtDate(at: string) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Inline-editable Request Type cell -- click the label to swap in a Select,
// commit via the same stakeholder_items_update RPC (through useUpdateItem)
// that item-form.tsx and items-table.tsx's InlineDateCell use for arbitrary
// field edits, keeping every other field on the draft untouched.
function InlineRequestTypeCell({ item }: { item: ClientRequest }) {
  const updateItem = useUpdateItem();
  const [editing, setEditing] = useState(false);

  function commit(next: RequestType) {
    setEditing(false);
    if (next === item.requestType) return;

    const draft: ItemDraft = {
      requestType: next,
      summary: item.summary,
      description: item.description,
      status: item.status,
      statusKind: item.statusKind,
      priority: item.priority,
      createdBy: item.createdBy,
      requiredBy: item.requiredBy,
      willBeDoneBy: item.willBeDoneBy,
    };

    updateItem.mutate(
      { id: item.id, draft },
      {
        onSuccess: () => toast.success("Request type updated"),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (editing) {
    return (
      <Select
        open
        {...(item.requestType ? { value: item.requestType } : {})}
        onValueChange={(v) => commit(v as RequestType)}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      >
        <SelectTrigger className="h-8 w-auto min-w-[140px]" autoFocus>
          <SelectValue placeholder="Select type" />
        </SelectTrigger>
        <SelectContent>
          {REQUEST_TYPES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="rounded hover:opacity-80">
      <RequestTypeBadge type={item.requestType} />
    </button>
  );
}

// Inline-editable Project cell for already-assigned (non-decision) requests.
// Reassignment reuses the same useAssignClientRequestProject mutation the
// "Assign Project" dialog uses for decisions, just against the full project
// list instead of the item's candidate projects.
function InlineProjectCell({ item, projects }: { item: ClientRequest; projects: Project[] }) {
  const assignProject = useAssignClientRequestProject();
  const [editing, setEditing] = useState(false);

  function commit(projectId: string) {
    setEditing(false);
    if (!projectId || projectId === item.projectId) return;
    const project = projects.find((p) => p.id === projectId);
    assignProject.mutate(
      { id: item.id, projectId, kind: item.kind },
      {
        onSuccess: () => toast.success(`Client request assigned to ${project?.name ?? "project"}`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (editing) {
    return (
      <Select
        open
        {...(item.projectId ? { value: item.projectId } : {})}
        onValueChange={commit}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      >
        <SelectTrigger className="h-8 w-auto min-w-[160px]" autoFocus>
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.code} {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        to="/projects/$projectId"
        params={{ projectId: item.projectId ?? "" }}
        className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted hover:underline"
      >
        <ProjectBadge code={item.projectCode ?? ""} />
        <span className="text-foreground">{item.projectName}</span>
      </Link>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Change project"
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Pencil className="size-3" />
      </button>
    </span>
  );
}

export function ClientRequestsTable() {
  const { data: requests, isLoading, isError } = useClientRequests();
  const { data: projects } = useProjects();
  const softDelete = useSoftDeleteItem();
  const assignProject = useAssignClientRequestProject();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [requestTypes, setRequestTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [dateField, setDateField] = useState<"requiredBy" | "willBeDoneBy" | null>("willBeDoneBy");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRequest | null>(null);
  const [viewing, setViewing] = useState<ClientRequest | null>(null);
  const [history, setHistory] = useState<ClientRequest | null>(null);
  const [deleting, setDeleting] = useState<ClientRequest | null>(null);
  const [assigning, setAssigning] = useState<ClientRequest | null>(null);

  const filtered = useMemo(
    () =>
      (requests ?? []).filter((it) => {
        if (search && !it.summary.toLowerCase().includes(search.toLowerCase())) return false;
        if (statuses.length && !statuses.includes(it.status)) return false;
        if (projectIds.length && (!it.projectId || !projectIds.includes(it.projectId)))
          return false;
        if (requestTypes.length && (!it.requestType || !requestTypes.includes(it.requestType)))
          return false;
        if (priorities.length && !priorities.includes(it.priority)) return false;
        if (dateField) {
          const value = it[dateField];
          if (from && (!value || value < from)) return false;
          if (to && (!value || value > to)) return false;
        }
        return true;
      }),
    [requests, search, statuses, projectIds, requestTypes, priorities, dateField, from, to],
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

  // Reset to the first page whenever the filters or sort change, so a
  // narrowed/reordered result set never leaves the user stranded on a page
  // past the end.
  useEffect(() => {
    setPage(1);
  }, [
    search,
    statuses,
    projectIds,
    requestTypes,
    priorities,
    dateField,
    from,
    to,
    sortField,
    sortDirection,
  ]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function toggleProject(id: string) {
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
      { id: deleting.id, projectId: deleting.projectId ?? "", kind: deleting.kind },
      {
        onSuccess: () => toast.success("Client request deleted"),
        onError: (err) => toast.error(err.message),
      },
    );
    setDeleting(null);
  }

  function confirmAssign(projectId: string, projectName: string) {
    if (!assigning) return;
    assignProject.mutate(
      { id: assigning.id, projectId, kind: assigning.kind },
      {
        onSuccess: () => toast.success(`Client request assigned to ${projectName}`),
        onError: (err) => toast.error(err.message),
      },
    );
    setAssigning(null);
  }

  const editingProject = editing ? projects?.find((p) => p.id === editing.projectId) : undefined;

  const multiSelects: MultiSelectFilterConfig[] = [
    {
      key: "status",
      label: "Status",
      emptyLabel: "All statuses",
      options: STAKEHOLDER_STATUSES.map((s) => ({ value: s, label: s })),
      selected: statuses,
      onToggle: toggleStatus,
    },
    {
      key: "project",
      label: "Project",
      emptyLabel: "All projects",
      options: (projects ?? []).map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
      selected: projectIds,
      onToggle: toggleProject,
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
      <ClientRequestsKpis requests={requests} isLoading={isLoading} />

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search client request summary…",
        }}
        multiSelects={multiSelects}
        dateRange={{
          fields: DATE_RANGE_FIELDS,
          field: dateField,
          from,
          to,
          onFieldChange: setDateField,
          onFromChange: setFrom,
          onToChange: setTo,
        }}
        sort={{
          field: sortField,
          direction: sortDirection,
          fields: SORT_FIELDS,
          onFieldChange: setSortField,
          onDirectionChange: setSortDirection,
        }}
        actions={
          <Button
            onClick={() => setAddOpen(true)}
            className="ml-auto h-9 gap-1.5 rounded-[6px] bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-hover"
          >
            <Plus className="size-4" /> Add Client Request
          </Button>
        }
      />

      <div className="table-shell">
        <div className="scroll-slim overflow-x-auto">
          <Table className="min-w-[1900px] text-sm">
            <TableHeader>
              <TableRow className="h-[38px] bg-surface hover:bg-surface">
                {columns.map((c) => (
                  <TableHead
                    key={c}
                    className={cn(
                      "h-[38px] text-left text-[11px] font-semibold tracking-[0.02em] text-[#667085] uppercase whitespace-nowrap",
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
                    {SKELETON_WIDTHS.map((w, ci) => (
                      <TableCell key={ci} className="py-3">
                        <Skeleton className={cn("h-4", w)} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-14 text-center">
                    <p className="font-medium text-destructive">Couldn't load client requests</p>
                    <p className="mt-1 text-sm text-muted-foreground">Please refresh the page.</p>
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    {requests && requests.length > 0 ? (
                      <EmptyState
                        icon={SearchX}
                        title="No client requests match your filters"
                        description="Adjust the filters or add a new request."
                      />
                    ) : (
                      <EmptyState
                        icon={Inbox}
                        title="No client requests yet"
                        description="Add one to get started."
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((it) => (
                  <TableRow
                    key={it.id}
                    className="h-[62px] border-b-[#EEF1F4] align-top hover:bg-surface"
                  >
                    <TableCell className="sticky left-0 z-10 max-w-[280px] bg-card px-3 py-2.5">
                      <button
                        onClick={() => setViewing(it)}
                        className="text-left text-[13px] leading-[18px] font-semibold text-[#101828] hover:text-brand hover:underline"
                      >
                        {it.summary}
                      </button>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">
                      {it.isDecision || !it.projectId ? (
                        <div className="flex flex-col items-start space-y-1">
                          <DecisionBadge />
                          <div className="max-w-[220px] text-xs text-muted-foreground">
                            {it.candidateProjects.map((p) => p.name).join(", ")}
                          </div>
                        </div>
                      ) : (
                        <InlineProjectCell item={it} projects={projects ?? []} />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">
                      <InlineRequestTypeCell item={it} />
                    </TableCell>
                    <TableCell className="max-w-[280px] px-3 py-2.5 text-[12px] leading-[17px] text-[#667085]">
                      <span className="line-clamp-2">{it.description || "—"}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <StatusBadge status={it.status} kind={it.statusKind} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <PriorityTag priority={it.priority} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">
                      <CreatedByCell name={it.createdBy} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">
                      {fmtDate(it.createdAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">
                      {it.willBeDoneBy || "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 rounded-[5px]"
                            aria-label="Row actions"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewing(it)}>
                            <Eye className="size-4" /> View
                          </DropdownMenuItem>
                          {it.isDecision ? (
                            <DropdownMenuItem onClick={() => setAssigning(it)}>
                              <ArrowRightCircle className="size-4" /> Assign Project
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setEditing(it)}>
                              <Pencil className="size-4" /> Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(it)}
                          >
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-[5px]"
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
        <div className="flex min-h-[46px] items-center justify-between border-t border-[#EEF1F4] px-3.5 py-0 text-xs text-[#667085]">
          <span>
            Showing {sorted.length} of {requests?.length ?? 0} client requests
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-[30px] rounded-[5px] border-[#DFE3E8]"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-[30px] rounded-[5px] border-[#DFE3E8]"
              aria-label="Next page"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ClientRequestFormDrawer
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => toast.success("Client request added")}
      />

      {editingProject && (
        <ItemFormDrawer
          open={!!editing}
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          project={editingProject}
          kind={editing!.kind}
          item={editing}
          onSaved={() => {
            toast.success("Client request updated");
            setEditing(null);
          }}
        />
      )}

      <ItemDetailDrawer
        item={viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        onEdit={(it) => {
          setViewing(null);
          setEditing(it as ClientRequest);
        }}
        onDelete={(it) => {
          setViewing(null);
          setDeleting(it as ClientRequest);
        }}
      />

      <ItemHistoryDrawer item={history} onOpenChange={(v) => !v && setHistory(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this client request?</AlertDialogTitle>
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

      <AlertDialog open={!!assigning} onOpenChange={(v) => !v && setAssigning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign to a project</AlertDialogTitle>
            <AlertDialogDescription>
              Choose which of the candidate projects “{assigning?.summary}” should be assigned to.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            {assigning?.candidateProjects.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="w-full justify-start"
                disabled={assignProject.isPending}
                onClick={() => confirmAssign(p.id, p.name)}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
