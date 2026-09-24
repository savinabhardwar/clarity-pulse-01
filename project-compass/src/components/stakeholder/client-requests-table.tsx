import { Link } from "@tanstack/react-router";
import { ArrowRightCircle, Clock, Eye, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DecisionBadge, PriorityTag, StatusBadge } from "@/components/stakeholder/badges";
import { ClientRequestFormDrawer } from "@/components/stakeholder/client-request-form";
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
} from "@/data/queries";
import {
  CLARIFICATION_NEEDED_STATUS,
  PRIORITIES,
  PRIORITY_RANK,
  requestTypeLabel,
  REQUEST_TYPES,
  STAKEHOLDER_STATUSES,
  type ClientRequest,
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
  "Project",
  "Request Type",
  "Description",
  "Status",
  "Priority",
  "Created By",
  "Date Added",
  "Required By Date",
  "Will Be Done By Date",
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRequest | null>(null);
  const [viewing, setViewing] = useState<ClientRequest | null>(null);
  const [history, setHistory] = useState<ClientRequest | null>(null);
  const [deleting, setDeleting] = useState<ClientRequest | null>(null);
  const [assigning, setAssigning] = useState<ClientRequest | null>(null);

  const filtersActive =
    !!search ||
    statuses.length > 0 ||
    projectIds.length > 0 ||
    requestTypes.length > 0 ||
    priorities.length > 0 ||
    !!from ||
    !!to;

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
        if (from && (!it.requiredBy || it.requiredBy < from)) return false;
        if (to && (!it.requiredBy || it.requiredBy > to)) return false;
        return true;
      }),
    [requests, search, statuses, projectIds, requestTypes, priorities, from, to],
  );

  // Items needing clarification always float to the top (most-recently-updated
  // first within that group); everything else is ordered by the chosen sort
  // field/direction. Applied after filtering, so filters keep working but
  // whatever's currently shown still surfaces clarification-needed items first.
  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aNeeds = a.status === CLARIFICATION_NEEDED_STATUS;
      const bNeeds = b.status === CLARIFICATION_NEEDED_STATUS;
      if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
      if (aNeeds && bNeeds) return b.updatedAt.localeCompare(a.updatedAt);

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
    setProjectIds([]);
    setRequestTypes([]);
    setPriorities([]);
    setFrom("");
    setTo("");
  }

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
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search client request summary…",
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
          <Button onClick={() => setAddOpen(true)} className="ml-auto">
            <Plus className="size-4" /> Add Client Request
          </Button>
        }
      />

      <div className="table-shell">
        <div className="scroll-slim overflow-x-auto">
          <Table className="min-w-[1900px] text-sm">
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
                    <p className="font-medium text-destructive">Couldn't load client requests</p>
                    <p className="mt-1 text-sm text-muted-foreground">Please refresh the page.</p>
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-14 text-center">
                    <p className="font-medium">
                      {requests && requests.length > 0
                        ? "No client requests match your filters"
                        : "No client requests yet"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {requests && requests.length > 0
                        ? "Adjust the filters or add a new request."
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
                    <TableCell className="whitespace-nowrap">
                      {it.isDecision || !it.projectId ? (
                        <div className="space-y-1">
                          <DecisionBadge />
                          <div className="max-w-[220px] text-xs text-muted-foreground">
                            {it.candidateProjects.map((p) => p.name).join(", ")}
                          </div>
                        </div>
                      ) : (
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: it.projectId }}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <span className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-brand">
                            {it.projectCode}
                          </span>
                          <span className="text-foreground">{it.projectName}</span>
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {requestTypeLabel(it.requestType)}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-muted-foreground">
                      <span className="line-clamp-2">{it.description || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={it.status} kind={it.statusKind} />
                    </TableCell>
                    <TableCell>
                      <PriorityTag priority={it.priority} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{it.createdBy}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(it.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{it.requiredBy || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{it.willBeDoneBy || "—"}</TableCell>
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
            Showing {sorted.length} of {requests?.length ?? 0} client requests
          </span>
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
