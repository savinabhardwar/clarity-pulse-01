import { Download, ExternalLink, Paperclip, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PriorityTag, StatusBadge } from "@/components/stakeholder/badges";
import { Button } from "@/components/ui/button";
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
import {
  getAttachmentDownloadUrl,
  useAddComment,
  useAttachments,
  useItemComments,
  useItemJiraLinks,
} from "@/data/queries";
import {
  COMMENT_TYPES,
  formatSize,
  getIdentity,
  type CommentType,
  type StakeholderItem,
} from "@/lib/stakeholder-types";

// A ClientRequest is a StakeholderItem with a nullable projectId (a decision
// awaiting a destination project) plus a few extra display-only fields this
// drawer doesn't need -- accept either so it can show both.
type DetailItem = Omit<StakeholderItem, "projectId"> & { projectId: string | null };

function fmt(at: string) {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function CommentThread({ item }: { item: DetailItem }) {
  const { data: comments, isLoading } = useItemComments(item.id);
  const addComment = useAddComment();
  const [draft, setDraft] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("updates");
  const isFeature = item.kind === "feature";

  function submit() {
    const body = draft.trim();
    if (!body) return;
    addComment.mutate(
      {
        itemId: item.id,
        projectId: item.projectId,
        kind: item.kind,
        body,
        commentType: isFeature ? commentType : "updates",
      },
      {
        onSuccess: () => {
          setDraft("");
          if (isFeature && commentType === "clarification") {
            toast.success("Requirement marked Clarification Needed");
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      ) : !comments || comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-border bg-card px-3 py-2 shadow-raised transition-colors hover:border-brand/25"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.authorName}</p>
                <p className="text-xs text-muted-foreground">{fmt(c.createdAt)}</p>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        {isFeature && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Comment type
            </p>
            <Select value={commentType} onValueChange={(v) => setCommentType(v as CommentType)}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Select comment type" />
              </SelectTrigger>
              <SelectContent>
                {COMMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Textarea
          rows={2}
          placeholder={`Comment as ${getIdentity()?.name ?? "you"}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!draft.trim() || addComment.isPending}
        >
          {addComment.isPending ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </div>
  );
}

async function download(storagePath: string, name: string) {
  try {
    const url = await getAttachmentDownloadUrl(storagePath);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.click();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't generate a download link");
  }
}

export function ItemDetailDrawer({
  item,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  item: DetailItem | null;
  onOpenChange: (v: boolean) => void;
  onEdit: (item: DetailItem) => void;
  onDelete: (item: DetailItem) => void;
}) {
  const { data: attachments } = useAttachments(item?.id);
  const { data: jiraLinks } = useItemJiraLinks(item?.id);

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {item && (
          <>
            <SheetHeader className="border-b border-border px-6 py-4">
              <SheetTitle className="pr-6 leading-snug">{item.summary}</SheetTitle>
              <SheetDescription>
                {item.kind === "feature" ? "Feature" : "Client Request"} item ·{" "}
                {jiraLinks && jiraLinks.length > 0
                  ? `${jiraLinks.length} ticket${jiraLinks.length > 1 ? "s" : ""} linked`
                  : "no ticket"}
              </SheetDescription>
            </SheetHeader>

            <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status} kind={item.statusKind} />
                <PriorityTag priority={item.priority} />
              </div>

              <Field label="Description">
                <p className="whitespace-pre-wrap">{item.description || "—"}</p>
              </Field>

              <Field label="Jira Ticket Links">
                {!jiraLinks || jiraLinks.length === 0 ? (
                  "—"
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {jiraLinks.map((link) => (
                      <li key={link.id}>
                        <a
                          href={link.jiraUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-brand transition-colors hover:border-brand/30 hover:bg-brand-soft hover:underline"
                        >
                          {link.jiraKey}
                          <ExternalLink className="size-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Created By">{item.createdBy}</Field>
                <Field label="Required By">{item.requiredBy || "—"}</Field>
                <Field label="Will Be Done By">{item.willBeDoneBy || "—"}</Field>
              </div>

              <Field label="Attachments">
                {!attachments || attachments.length === 0 ? (
                  "No attachments"
                ) : (
                  <ul className="space-y-2">
                    {attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-brand/25 hover:bg-surface"
                      >
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.type} · {formatSize(a.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Download ${a.name}`}
                          onClick={() => download(a.storagePath, a.name)}
                        >
                          <Download className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <Field label="Comments">
                <CommentThread item={item} />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(item)}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
              <Button onClick={() => onEdit(item)}>
                <Pencil className="size-4" /> Edit
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
