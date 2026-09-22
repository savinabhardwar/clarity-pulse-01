import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { timingSafeEqual } from "node:crypto";

// Externally-reachable webhook: Jira (System -> WebHooks) calls this on issue
// change so a linked stakeholder_items row's status stays in sync. This is
// the first raw HTTP route in project-compass -- everywhere else uses
// createServerFn, which is an internal RPC convention, not something an
// external system like Jira can call.
//
// Jira's classic admin-configured webhooks (not Atlassian Connect) do not
// sign their payloads, so there is no HMAC to verify here (unlike a "real"
// webhook provider). Authentication instead comes from a secret token
// embedded in the webhook URL itself, which only the Jira admin config and
// this server know. See docs/event-contracts.md for the registration steps.
//
// The exact webhook payload shape below (webhookEvent / issue.key /
// issue.fields.status.name) is Atlassian's documented `jira:issue_updated`
// event shape, but this Jira instance had zero webhooks configured as of
// 2026-09-18 (docs/discovery.md), so it has not been verified against a real
// delivery yet. Handle unexpected shapes defensively (log and 200, do not
// crash or update anything) rather than assuming the docs are still accurate.

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    key?: string;
    fields?: {
      status?: { name?: string };
    };
  };
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env["JIRA_WEBHOOK_SECRET"];
  if (!secret) return false; // unconfigured -- refuse rather than accept everything
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return timingSafeStringEqual(token, secret);
}

export const Route = createFileRoute("/api/jira-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: JiraWebhookPayload;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const jiraKey = body.issue?.key;
        const status = body.issue?.fields?.status?.name;
        if (!jiraKey || !status) {
          console.warn("jira-webhook: unexpected payload shape, skipping", {
            webhookEvent: body.webhookEvent,
          });
          // Ack so Jira doesn't retry a payload shape we'll never understand.
          return new Response("ok (skipped: unrecognized shape)", { status: 200 });
        }

        const { data, error } = await supabase.rpc("stakeholder_items_update_status_from_jira", {
          p_jira_key: jiraKey,
          p_status: status,
        });

        if (error) {
          console.error("jira-webhook: status update failed", error);
          // 500 so Jira retries -- this is a transient DB/network failure,
          // not a payload we don't understand.
          return new Response("Update failed", { status: 500 });
        }

        const updatedCount = Array.isArray(data) ? data.length : 0;
        return new Response(`ok (updated ${updatedCount} item(s))`, { status: 200 });
      },
    },
  },
});
