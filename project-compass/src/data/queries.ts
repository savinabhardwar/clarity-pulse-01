import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  getIdentity,
  type Attachment,
  type ClientRequest,
  type Comment,
  type CommentType,
  type HistoryEntry,
  type ItemDraft,
  type ItemKind,
  type JiraLink,
  type Project,
  type RecentActivityEntry,
  type RequestType,
  type StakeholderItem,
} from "@/lib/stakeholder-types";

function currentActor(): string {
  const identity = getIdentity();
  if (!identity) throw new Error("No identity set -- the identity gate should prevent this.");
  return identity.name;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("No data returned");
  return res.data;
}

// ---------- DB row shapes (snake_case, as Postgres returns them) ----------

interface ProjectRow {
  id: string;
  name: string;
  code: string;
  jira_project_key: string | null;
  owner: string | null;
  description: string | null;
}

interface ItemRow {
  id: string;
  project_id: string;
  kind: ItemKind;
  request_type: RequestType | null;
  summary: string;
  description: string;
  status: string;
  status_kind: "stakeholder" | "jira";
  priority: "High" | "Medium" | "Low";
  created_by: string;
  required_by: string | null;
  will_be_done_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientRequestRow extends Omit<ItemRow, "project_id"> {
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  is_decision: boolean;
  candidate_project_ids: string[];
  candidate_project_names: string[];
}

interface AttachmentRow {
  id: string;
  item_id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
}

interface HistoryRow {
  id: string;
  event_type: "created" | "updated" | "deleted";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
}

interface CommentRow {
  id: string;
  item_id: string;
  author_name: string;
  author_email: string;
  body: string;
  comment_type: CommentType;
  created_at: string;
}

interface JiraLinkRow {
  id: string;
  item_id: string;
  jira_key: string;
  jira_url: string;
  added_by: string;
  created_at: string;
}

interface RecentActivityRow {
  id: string;
  item_id: string | null;
  event_type: "created" | "updated" | "deleted";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
  item_summary: string | null;
  kind: ItemKind | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    jiraProjectKey: r.jira_project_key,
    owner: r.owner ?? "",
    description: r.description ?? "",
  };
}

function mapItem(r: ItemRow): StakeholderItem {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    requestType: r.request_type,
    summary: r.summary,
    description: r.description,
    status: r.status,
    statusKind: r.status_kind,
    priority: r.priority,
    createdBy: r.created_by,
    requiredBy: r.required_by,
    willBeDoneBy: r.will_be_done_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapClientRequest(r: ClientRequestRow): ClientRequest {
  return {
    ...mapItem({ ...r, project_id: r.project_id ?? "" }),
    projectId: r.project_id,
    requestType: r.request_type,
    projectName: r.project_name,
    projectCode: r.project_code,
    isDecision: r.is_decision,
    candidateProjects: r.candidate_project_ids.map((id, i) => ({
      id,
      name: r.candidate_project_names[i]!,
    })),
  };
}

function mapAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    itemId: r.item_id,
    storagePath: r.storage_path,
    name: r.file_name,
    type: r.file_type,
    size: r.file_size,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

function mapHistory(r: HistoryRow): HistoryEntry {
  return {
    id: r.id,
    eventType: r.event_type,
    fieldName: r.field_name,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  };
}

function mapComment(r: CommentRow): Comment {
  return {
    id: r.id,
    itemId: r.item_id,
    authorName: r.author_name,
    authorEmail: r.author_email,
    body: r.body,
    commentType: r.comment_type,
    createdAt: r.created_at,
  };
}

function mapJiraLink(r: JiraLinkRow): JiraLink {
  return {
    id: r.id,
    itemId: r.item_id,
    jiraKey: r.jira_key,
    jiraUrl: r.jira_url,
    addedBy: r.added_by,
    createdAt: r.created_at,
  };
}

function mapRecentActivity(r: RecentActivityRow): RecentActivityEntry {
  return {
    id: r.id,
    itemId: r.item_id,
    itemSummary: r.item_summary,
    kind: r.kind,
    projectId: r.project_id,
    projectName: r.project_name,
    projectCode: r.project_code,
    eventType: r.event_type,
    fieldName: r.field_name,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  };
}

// ---------- Projects ----------

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () =>
      unwrap<ProjectRow[]>(
        await supabase
          .from("stakeholder_projects")
          .select("id,name,code,jira_project_key,owner,description")
          .order("name"),
      ).map(mapProject),
  });
}

// ---------- Items ----------

export function useItems(projectId: string | undefined, kind: ItemKind) {
  return useQuery({
    queryKey: ["stakeholder-items", projectId ?? "", kind],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap<ItemRow[]>(
        await supabase
          .from("stakeholder_items")
          .select(
            "id,project_id,kind,request_type,summary,description,status,status_kind,priority,created_by,required_by,will_be_done_by,created_at,updated_at",
          )
          .eq("project_id", projectId!)
          .eq("kind", kind)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ).map(mapItem),
  });
}

// ---------- Client Requests (global module, across all projects) ----------

export function useClientRequests() {
  return useQuery({
    queryKey: ["client-requests"],
    queryFn: async () =>
      unwrap<ClientRequestRow[]>(
        await supabase
          .from("stakeholder_client_requests")
          .select(
            "id,project_id,project_name,project_code,kind,request_type,summary,description,status,status_kind,priority,created_by,required_by,will_be_done_by,created_at,updated_at,is_decision,candidate_project_ids,candidate_project_names",
          )
          .order("created_at", { ascending: false }),
      ).map(mapClientRequest),
  });
}

function invalidateItems(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  kind: ItemKind,
) {
  queryClient.invalidateQueries({ queryKey: ["stakeholder-items", projectId, kind] });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      kind,
      draft,
    }: {
      projectId: string;
      kind: ItemKind;
      draft: ItemDraft;
    }) => {
      const { data, error } = await supabase.rpc("stakeholder_items_create", {
        p_project_id: projectId,
        p_kind: kind,
        p_summary: draft.summary,
        p_description: draft.description,
        p_status: draft.status,
        p_status_kind: draft.statusKind,
        p_priority: draft.priority,
        p_created_by: draft.createdBy,
        p_required_by: draft.requiredBy,
        p_will_be_done_by: draft.willBeDoneBy,
        p_actor: currentActor(),
        p_request_type: draft.requestType ?? null,
      });
      if (error) throw new Error(error.message);
      return mapItem(data as ItemRow);
    },
    onSuccess: (item) => {
      invalidateItems(queryClient, item.projectId, item.kind);
      if (item.requestType) queryClient.invalidateQueries({ queryKey: ["client-requests"] });
    },
  });
}

// Creates an item via the Client Requests intake module, which -- unlike
// useCreateItem -- lets the requester pick multiple candidate projects. One
// project routes the item there immediately; two or more make it a decision
// (no project yet, see stakeholder_items_create_request) that only shows up
// in the Client Requests module until someone assigns it.
export function useCreateClientRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectIds,
      kind,
      draft,
    }: {
      projectIds: string[];
      kind: ItemKind;
      draft: ItemDraft;
    }) => {
      const { data, error } = await supabase.rpc("stakeholder_items_create_request", {
        p_project_ids: projectIds,
        p_kind: kind,
        p_summary: draft.summary,
        p_description: draft.description,
        p_status: draft.status,
        p_status_kind: draft.statusKind,
        p_priority: draft.priority,
        p_created_by: draft.createdBy,
        p_required_by: draft.requiredBy,
        p_will_be_done_by: draft.willBeDoneBy,
        p_actor: currentActor(),
        p_request_type: draft.requestType ?? null,
      });
      if (error) throw new Error(error.message);
      return data as Omit<ItemRow, "project_id"> & { project_id: string | null };
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      if (item.project_id) invalidateItems(queryClient, item.project_id, item.kind);
    },
  });
}

// Resolves a decision (a client request created with multiple candidate
// projects) by picking its one destination project. From then on the item
// behaves like any other item in that project's module, while it keeps
// showing in the Client Requests module exactly as before -- it's never
// removed from there.
export function useAssignClientRequestProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string; kind: ItemKind }) => {
      const { data, error } = await supabase.rpc("stakeholder_items_assign_project", {
        p_id: id,
        p_project_id: projectId,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
      return mapItem(data as ItemRow);
    },
    onSuccess: (item, variables) => {
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      invalidateItems(queryClient, item.projectId, variables.kind);
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", item.id] });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: ItemDraft }) => {
      const { data, error } = await supabase.rpc("stakeholder_items_update", {
        p_id: id,
        p_summary: draft.summary,
        p_description: draft.description,
        p_status: draft.status,
        p_status_kind: draft.statusKind,
        p_priority: draft.priority,
        p_created_by: draft.createdBy,
        p_required_by: draft.requiredBy,
        p_will_be_done_by: draft.willBeDoneBy,
        p_actor: currentActor(),
        p_request_type: draft.requestType ?? null,
      });
      if (error) throw new Error(error.message);
      return mapItem(data as ItemRow);
    },
    onSuccess: (item) => {
      invalidateItems(queryClient, item.projectId, item.kind);
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", item.id] });
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
    },
  });
}

export function useSoftDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId: string; kind: ItemKind }) => {
      const { error } = await supabase.rpc("stakeholder_items_soft_delete", {
        p_id: id,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) =>
      invalidateItems(queryClient, variables.projectId, variables.kind),
  });
}

// ---------- History ----------

export function useItemHistory(itemId: string | undefined) {
  return useQuery({
    queryKey: ["stakeholder-item-history", itemId ?? ""],
    enabled: !!itemId,
    queryFn: async () =>
      unwrap<HistoryRow[]>(
        await supabase
          .from("stakeholder_item_history")
          .select("id,event_type,field_name,old_value,new_value,changed_by,changed_at")
          .eq("item_id", itemId!)
          .order("changed_at", { ascending: false }),
      ).map(mapHistory),
  });
}

// ---------- Attachments ----------

export function useAttachments(itemId: string | undefined) {
  return useQuery({
    queryKey: ["stakeholder-item-attachments", itemId ?? ""],
    enabled: !!itemId,
    queryFn: async () =>
      unwrap<AttachmentRow[]>(
        await supabase
          .from("stakeholder_item_attachments")
          .select("id,item_id,storage_path,file_name,file_type,file_size,uploaded_by,created_at")
          .eq("item_id", itemId!)
          .order("created_at", { ascending: false }),
      ).map(mapAttachment),
  });
}

function attachmentPath(projectId: string, itemId: string, attachmentId: string, fileName: string) {
  return `${projectId}/${itemId}/${attachmentId}-${fileName}`;
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      itemId,
      file,
    }: {
      projectId: string;
      itemId: string;
      file: File;
    }) => {
      const attachmentId = crypto.randomUUID();
      const path = attachmentPath(projectId, itemId, attachmentId, file.name);
      const upload = await supabase.storage.from("stakeholder-attachments").upload(path, file);
      if (upload.error) throw new Error(upload.error.message);

      const fileType = (file.name.split(".").pop() ?? "FILE").toUpperCase();
      const { data, error } = await supabase.rpc("stakeholder_item_attachments_add", {
        p_item_id: itemId,
        p_storage_path: path,
        p_file_name: file.name,
        p_file_type: fileType,
        p_file_size: file.size,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
      return mapAttachment(data as AttachmentRow);
    },
    onSuccess: (attachment) => {
      queryClient.invalidateQueries({
        queryKey: ["stakeholder-item-attachments", attachment.itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", attachment.itemId] });
    },
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      storagePath,
    }: {
      id: string;
      itemId: string;
      storagePath: string;
    }) => {
      const remove = await supabase.storage.from("stakeholder-attachments").remove([storagePath]);
      if (remove.error) throw new Error(remove.error.message);
      const { error } = await supabase.rpc("stakeholder_item_attachments_remove", {
        p_attachment_id: id,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["stakeholder-item-attachments", variables.itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", variables.itemId] });
    },
  });
}

// ---------- Comments ----------

export function useItemComments(itemId: string | undefined) {
  return useQuery({
    queryKey: ["stakeholder-item-comments", itemId ?? ""],
    enabled: !!itemId,
    queryFn: async () =>
      unwrap<CommentRow[]>(
        await supabase
          .from("stakeholder_item_comments")
          .select("id,item_id,author_name,author_email,body,comment_type,created_at")
          .eq("item_id", itemId!)
          .order("created_at", { ascending: true }),
      ).map(mapComment),
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      projectId,
      kind,
      body,
      commentType,
    }: {
      itemId: string;
      projectId: string | null;
      kind: ItemKind;
      body: string;
      commentType: CommentType;
    }) => {
      const identity = getIdentity();
      if (!identity) throw new Error("No identity set -- the identity gate should prevent this.");
      const { data, error } = await supabase.rpc("stakeholder_item_comments_add", {
        p_item_id: itemId,
        p_author_name: identity.name,
        p_author_email: identity.email,
        p_body: body,
        p_comment_type: commentType,
        p_actor: identity.name,
      });
      if (error) throw new Error(error.message);
      return { comment: mapComment(data as CommentRow), projectId, kind, commentType };
    },
    onSuccess: ({ comment, projectId, kind, commentType }) => {
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-comments", comment.itemId] });
      if (commentType === "clarification") {
        if (projectId) invalidateItems(queryClient, projectId, kind);
        queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", comment.itemId] });
        queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      }
    },
  });
}

// ---------- Jira links (an item can link to zero, one, or many tickets) ----------

export function useItemJiraLinks(itemId: string | undefined) {
  return useQuery({
    queryKey: ["stakeholder-item-jira-links", itemId ?? ""],
    enabled: !!itemId,
    queryFn: async () =>
      unwrap<JiraLinkRow[]>(
        await supabase
          .from("stakeholder_item_jira_links")
          .select("id,item_id,jira_key,jira_url,added_by,created_at")
          .eq("item_id", itemId!)
          .order("created_at", { ascending: true }),
      ).map(mapJiraLink),
  });
}

export function useAddJiraLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      jiraKey,
      jiraUrl,
    }: {
      itemId: string;
      jiraKey: string;
      jiraUrl: string;
    }) => {
      const { data, error } = await supabase.rpc("stakeholder_item_jira_links_add", {
        p_item_id: itemId,
        p_jira_key: jiraKey,
        p_jira_url: jiraUrl,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
      return mapJiraLink(data as JiraLinkRow);
    },
    onSuccess: (link) => {
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-jira-links", link.itemId] });
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", link.itemId] });
    },
  });
}

export function useRemoveJiraLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; itemId: string }) => {
      const { error } = await supabase.rpc("stakeholder_item_jira_links_remove", {
        p_link_id: id,
        p_actor: currentActor(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["stakeholder-item-jira-links", variables.itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["stakeholder-item-history", variables.itemId] });
    },
  });
}

// ---------- Recent activity (global feed, across all items/projects) ----------

export function useRecentActivity(limit = 50) {
  return useQuery({
    queryKey: ["recent-activity", limit],
    queryFn: async () =>
      unwrap<RecentActivityRow[]>(
        await supabase
          .from("stakeholder_recent_activity")
          .select(
            "id,item_id,event_type,field_name,old_value,new_value,changed_by,changed_at,item_summary,kind,project_id,project_name,project_code",
          )
          .order("changed_at", { ascending: false })
          .limit(limit),
      ).map(mapRecentActivity),
    refetchInterval: 30000,
  });
}

// Generated on-demand at click time, never stored -- avoids leaking a
// long-lived signed URL in the DOM/history.
export async function getAttachmentDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("stakeholder-attachments")
    .createSignedUrl(storagePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
