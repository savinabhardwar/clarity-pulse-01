import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { ClientRequestsTable } from "@/components/stakeholder/client-requests-table";

export const Route = createFileRoute("/client-requests")({
  head: () => ({
    meta: [
      { title: "Client Requests — Stakeholder Management" },
      {
        name: "description",
        content:
          "Every client request across all projects -- product enhancements, bugs, new requests and client onboardings -- in one place, with items needing clarification surfaced first.",
      },
      { property: "og:title", content: "Client Requests — Stakeholder Management" },
      {
        property: "og:description",
        content:
          "Global view of client requests across every project module, prioritising items awaiting clarification.",
      },
    ],
  }),
  component: ClientRequestsPage,
});

function ClientRequestsPage() {
  return (
    <AppShell
      title="Client Requests"
      subtitle="Every request submitted through the Client Requests module, across all projects"
    >
      <ClientRequestsTable />
    </AppShell>
  );
}
