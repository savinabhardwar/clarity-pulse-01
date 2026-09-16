import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { findJiraMatch, type JiraMatchCandidate } from "@/actions/find-jira-match";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useAddJiraLink,
  useAttachments,
  useCreateItem,
  useDeleteAttachment,
  useItemJiraLinks,
  useRemoveJiraLink,
  useUpdateItem,
  useUploadAttachment,
} from "@/data/queries";
import {
  JIRA_STATUSES,
  PRIORITIES,
  STAKEHOLDER_STATUSES,
  deriveJiraKey,
  formatSize,
  getIdentity,
  validateAttachment,
  type Attachment,
  type ItemDraft,
  type ItemKind,
  type Priority,
  type Project,
  type StakeholderItem,
  type StatusKind,
} from "@/lib/stakeholder-types";

const formSchema = z.object({
  summary: z.string().trim().min(1, "Summary is required."),
  description: z.string(),
  status: z.string(),
  statusKind: z.enum(["stakeholder", "jira"]),
  priority: z.enum(["High", "Medium", "Low"]),
  requiredBy: z.string().nullable(),
  willBeDoneBy: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

function emptyValues(): FormValues {
  return {
    summary: "",
    description: "",
    status: STAKEHOLDER_STATUSES[0],
    statusKind: "stakeholder",
    priority: "Medium",
    requiredBy: "",
    willBeDoneBy: "",
  };
}

function valuesFromItem(item: EditableItem): FormValues {
  return {
    summary: item.summary,
    description: item.description,
    status: item.status,
    statusKind: item.statusKind,
    priority: item.priority,
    requiredBy: item.requiredBy ?? "",
    willBeDoneBy: item.willBeDoneBy ?? "",
  };
}

const DEBOUNCE_MS = 600;
const MIN_SEARCH_LENGTH = 6;

function normalizeSummary(s: string) {
  return s.trim().toLowerCase();
}

// This form never reads/writes projectId (the project is always passed in
// separately via the `project` prop), so it accepts a ClientRequest --
// whose projectId can be null for an unresolved decision -- structurally,
// same as a plain StakeholderItem.
type EditableItem = Omit<StakeholderItem, "projectId"> & { projectId: string | null };

export function ItemFormDrawer({
  open,
  onOpenChange,
  project,
  kind,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: Project;
  kind: ItemKind;
  item?: EditableItem | null;
  onSaved: () => void;
}) {
  const label = kind === "feature" ? "Feature" : "Client Request";
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(),
  });

  // Attachments staged locally in create mode (no itemId to attach to yet).
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // Jira links staged locally in create mode, same reasoning.
  const [stagedJiraLinks, setStagedJiraLinks] = useState<{ jiraKey: string; jiraUrl: string }[]>(
    [],
  );
  const [manualJiraInput, setManualJiraInput] = useState("");

  // Jira auto-match state.
  const [jiraMatches, setJiraMatches] = useState<JiraMatchCandidate[]>([]);
  const [jiraLookupError, setJiraLookupError] = useState(false);
  const [jiraSearchAttempted, setJiraSearchAttempted] = useState(false);
  const [jiraSearching, setJiraSearching] = useState(false);
  // Tracks the last summary we actually searched for, so we only re-search
  // on material change. Set to the item's own summary on load when editing
  // an item that already has at least one linked ticket, so we skip the
  // initial search entirely.
  const lastSearchedRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attachmentsQuery = useAttachments(item?.id);
  const jiraLinksQuery = useItemJiraLinks(item?.id);
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();
  const addJiraLink = useAddJiraLink();
  const removeJiraLink = useRemoveJiraLink();

  const isPending = createItem.isPending || updateItem.isPending;

  useEffect(() => {
    if (!open) return;
    setStagedFiles([]);
    setStagedJiraLinks([]);
    setManualJiraInput("");
    setJiraMatches([]);
    setJiraLookupError(false);
    setJiraSearchAttempted(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (item) {
      form.reset(valuesFromItem(item));
      // Skip auto-search on load if this item already has a linked ticket
      // (only knowable if already cached from a prior view of this item).
      const alreadyLinked = (jiraLinksQuery.data?.length ?? 0) > 0;
      lastSearchedRef.current = alreadyLinked ? normalizeSummary(item.summary) : null;
    } else {
      form.reset(emptyValues());
      lastSearchedRef.current = null;
    }
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  const summaryValue = form.watch("summary");

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const normalized = normalizeSummary(summaryValue ?? "");
    if (normalized.length < MIN_SEARCH_LENGTH) return;
    if (normalized === lastSearchedRef.current) return;

    debounceRef.current = setTimeout(() => {
      lastSearchedRef.current = normalized;
      setJiraSearching(true);
      setJiraSearchAttempted(true);
      findJiraMatch({ data: { summary: summaryValue } })
        .then((result) => {
          setJiraLookupError(!!result.error);
          setJiraMatches(result.matches);
        })
        .catch(() => {
          setJiraLookupError(true);
          setJiraMatches([]);
        })
        .finally(() => setJiraSearching(false));
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [summaryValue, open]);

  function addLink(jiraKey: string, jiraUrl: string) {
    if (!jiraKey) return;
    if (item) {
      addJiraLink.mutate(
        { itemId: item.id, jiraKey, jiraUrl },
        { onError: (err) => toast.error(err.message) },
      );
    } else {
      setStagedJiraLinks((prev) =>
        prev.some((l) => l.jiraKey === jiraKey) ? prev : [...prev, { jiraKey, jiraUrl }],
      );
    }
  }

  function acceptMatch(match: JiraMatchCandidate) {
    addLink(match.key, match.url);
    if (match.status) {
      form.setValue("statusKind", "jira");
      form.setValue("status", match.status);
    }
    setJiraMatches((prev) => prev.filter((m) => m.key !== match.key));
  }

  function addManualLink() {
    const jiraUrl = manualJiraInput.trim();
    if (!jiraUrl) return;
    addLink(deriveJiraKey(jiraUrl), jiraUrl);
    setManualJiraInput("");
  }

  function removeStagedLink(jiraKey: string) {
    setStagedJiraLinks((prev) => prev.filter((l) => l.jiraKey !== jiraKey));
  }

  function removeLink(linkId: string) {
    if (!item) return;
    removeJiraLink.mutate(
      { id: linkId, itemId: item.id },
      { onError: (err) => toast.error(err.message) },
    );
  }

  function stageOrUploadFiles(files: FileList | null) {
    if (!files) return;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const err = validateAttachment(file);
      if (err) {
        toast.error(err);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    if (item) {
      for (const file of accepted) {
        uploadAttachment.mutate(
          { projectId: project.id, itemId: item.id, file },
          { onError: (err) => toast.error(err.message) },
        );
      }
    } else {
      setStagedFiles((prev) => [...prev, ...accepted]);
    }
  }

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeExistingAttachment(attachmentId: string, storagePath: string) {
    if (!item) return;
    deleteAttachment.mutate(
      { id: attachmentId, itemId: item.id, storagePath },
      { onError: (err) => toast.error(err.message) },
    );
  }

  function onSubmit(values: FormValues) {
    // "Created By" is never picked in the form -- it's the item's original
    // author (preserved as-is on edit) or, for a brand-new item, whoever is
    // currently signed in via the identity gate.
    const createdBy = item ? item.createdBy : (getIdentity()?.name ?? "Unknown");
    const draft: ItemDraft = {
      // Preserved as-is -- this form never lets requestType be picked or
      // cleared; it's only ever set at creation time by client-request-form.tsx.
      requestType: item ? item.requestType : null,
      summary: values.summary.trim(),
      description: values.description,
      status: values.status,
      statusKind: values.statusKind,
      priority: values.priority,
      createdBy,
      requiredBy: values.requiredBy || null,
      willBeDoneBy: values.willBeDoneBy || null,
    };

    if (item) {
      updateItem.mutate(
        { id: item.id, draft },
        {
          onSuccess: () => {
            onSaved();
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else {
      createItem.mutate(
        { projectId: project.id, kind, draft },
        {
          onSuccess: (newItem) => {
            for (const file of stagedFiles) {
              uploadAttachment.mutate(
                { projectId: project.id, itemId: newItem.id, file },
                { onError: (err) => toast.error(err.message) },
              );
            }
            for (const link of stagedJiraLinks) {
              addJiraLink.mutate(
                { itemId: newItem.id, jiraKey: link.jiraKey, jiraUrl: link.jiraUrl },
                { onError: (err) => toast.error(err.message) },
              );
            }
            onSaved();
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  const statusKind = form.watch("statusKind");
  const statusOptions = statusKind === "stakeholder" ? STAKEHOLDER_STATUSES : JIRA_STATUSES;

  const existingAttachments = attachmentsQuery.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{item ? `Edit ${label}` : `Add ${label}`}</SheetTitle>
          <SheetDescription>
            {item
              ? "Changes are recorded in the audit history."
              : `Create a new ${label.toLowerCase()} item for this module.`}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Summary *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Short, outcome-oriented title"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="What is being asked for, and why"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-1.5">
                <Label>Jira Ticket Links</Label>

                {(item ? (jiraLinksQuery.data ?? []) : []).map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <a
                      href={link.jiraUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-sm text-brand hover:underline"
                    >
                      {link.jiraKey}
                      <ExternalLink className="size-3.5" />
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${link.jiraKey}`}
                      onClick={() => removeLink(link.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {!item &&
                  stagedJiraLinks.map((link) => (
                    <div
                      key={link.jiraKey}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <span className="font-mono text-sm">{link.jiraKey}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${link.jiraKey}`}
                        onClick={() => removeStagedLink(link.jiraKey)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}

                <div className="flex gap-2">
                  <Input
                    placeholder="https://jira.company.com/browse/CXP-1042"
                    autoComplete="off"
                    value={manualJiraInput}
                    onChange={(e) => setManualJiraInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addManualLink();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addManualLink}>
                    Add
                  </Button>
                </div>

                {jiraSearching ? (
                  <p className="text-xs text-muted-foreground">Searching Jira…</p>
                ) : jiraLookupError ? (
                  <p className="text-xs text-muted-foreground">
                    Jira lookup unavailable right now.
                  </p>
                ) : jiraMatches.length > 0 ? (
                  <div className="space-y-1.5 rounded-md border border-border bg-surface p-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Possible Jira matches
                    </p>
                    <ul className="space-y-1">
                      {jiraMatches.map((m) => (
                        <li
                          key={m.key}
                          className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-1.5 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-mono font-medium">{m.key}</span>{" "}
                            <span className="text-muted-foreground">· {m.status}</span>
                            <p className="truncate text-muted-foreground">{m.summary}</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => acceptMatch(m)}
                          >
                            Use
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : jiraSearchAttempted ? (
                  <p className="text-xs text-muted-foreground">
                    No matching Jira ticket found — enter one manually.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Status type</Label>
                  <ToggleGroup
                    type="single"
                    value={statusKind}
                    onValueChange={(v) => {
                      if (!v) return;
                      const next = v as StatusKind;
                      form.setValue("statusKind", next);
                      const options = next === "stakeholder" ? STAKEHOLDER_STATUSES : JIRA_STATUSES;
                      if (!(options as readonly string[]).includes(form.getValues("status"))) {
                        form.setValue("status", options[0]);
                      }
                    }}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="stakeholder" className="text-xs">
                      Stakeholder status
                    </ToggleGroupItem>
                    <ToggleGroupItem value="jira" className="text-xs">
                      Jira status
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as Priority)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Created By</Label>
                  <p className="text-sm">
                    {item ? item.createdBy : (getIdentity()?.name ?? "Unknown")}
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="requiredBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required By Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="willBeDoneBy"
                render={({ field }) => (
                  <FormItem className="sm:w-1/2">
                    <FormLabel>Will Be Done By Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Label>Attach Document</Label>
                <div className="rounded-lg border border-dashed border-input bg-surface px-4 py-5 text-center">
                  <Paperclip className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Attach specs, mocks or review notes
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => fileRef.current?.click()}
                  >
                    Choose file
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      stageOrUploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {item && existingAttachments.length > 0 && (
                  <ul className="space-y-2">
                    {existingAttachments.map((a: Attachment) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.type} · {formatSize(a.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${a.name}`}
                          onClick={() => removeExistingAttachment(a.id, a.storagePath)}
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {!item && stagedFiles.length > 0 && (
                  <ul className="space-y-2">
                    {stagedFiles.map((f, i) => (
                      <li
                        key={`${f.name}-${f.size}-${i}`}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{f.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(f.name.split(".").pop() ?? "FILE").toUpperCase()} ·{" "}
                            {formatSize(f.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${f.name}`}
                          onClick={() => removeStagedFile(i)}
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
