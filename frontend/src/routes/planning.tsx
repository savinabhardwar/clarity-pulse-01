import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/emp/shell";
import { Bar, Metric, Panel, SectionHeader, StatusPill } from "@/components/emp/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEm } from "@/lib/emp-store";
import { kpis, teamMetrics } from "@/lib/emp-engine";
import {
  useAddPlanningAvailability,
  useDeletePlanningAvailability,
  usePlanningAvailability,
  useUpdatePlanningAvailability,
  type PlanningAvailabilityRow,
} from "@/data/queries";

const title = "Planning — Engineering Capacity";
const description = "Team capacity by discipline and a live forecast of remaining sprint capacity.";

export const Route = createFileRoute("/planning")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: PlanningPage,
});

function PlanningPage() {
  const { people, teamPeople } = useEm();
  const teams = teamMetrics(teamPeople);
  const k = kpis(people);

  const available = teams.filter((t) => t.capacityUsed < 85);
  const nearCapacity = teams.filter((t) => t.capacityUsed >= 85);

  return (
    <AppShell title="Planning" description="How should I plan engineering capacity this sprint?">
      <SectionHeader title="Team capacity" hint="Live from the current sprint's real allocation" />
      <div className="grid gap-4 md:grid-cols-3">
        {teams.map((t) => (
          <Panel key={t.team}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t.team}</h3>
              <StatusPill
                status={
                  t.capacityUsed >= 100
                    ? "At Risk"
                    : t.capacityUsed >= 85
                      ? "Needs Attention"
                      : "On Track"
                }
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Metric label="Engineers" value={t.engineers} />
              <Metric label="Productive hours" value={`${t.productiveHours}h`} />
              <Metric label="Allocated hours" value={`${t.allocatedHours}h`} />
              <Metric label="Unallocated hours" value={`${t.unallocatedHours}h`} />
            </div>
            <div className="mt-4">
              <p className="stat-label">Capacity used</p>
              <div className="mt-2 flex items-center gap-2">
                <Bar
                  value={t.capacityUsed}
                  tone={
                    t.capacityUsed >= 100 ? "danger" : t.capacityUsed >= 85 ? "warn" : "primary"
                  }
                />
                <span className="text-sm tabular-nums">{t.capacityUsed}%</span>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-6">
        <Panel>
          <SectionHeader title="Capacity forecast" hint="Updates as the sync refreshes" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Remaining capacity this sprint" value={`${k.unallocated}h`} />
            <Metric label="Utilisation" value={`${k.utilisation}%`} />
          </div>
          <div className="mt-5 space-y-2">
            <p className="stat-label">Capacity by team</p>
            {teams.map((t) => (
              <div key={t.team} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0">{t.team}</span>
                <Bar
                  value={t.capacityUsed}
                  tone={
                    t.capacityUsed >= 100 ? "danger" : t.capacityUsed >= 85 ? "warn" : "primary"
                  }
                />
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {t.unallocatedHours}h free
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="stat-label">Available for additional work</p>
              <p className="mt-1 text-sm">
                {available.length
                  ? available.map((t) => `${t.team} (${t.unallocatedHours}h)`).join(", ")
                  : "No team has meaningful headroom this sprint."}
              </p>
            </div>
            <div>
              <p className="stat-label">Near capacity</p>
              <p className="mt-1 text-sm">
                {nearCapacity.length
                  ? nearCapacity.map((t) => `${t.team} (${t.capacityUsed}%)`).join(", ")
                  : "No team is near capacity."}
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-6">
        <AvailabilitySection />
      </div>
    </AppShell>
  );
}

function emptyForm() {
  return { person_id: "", from_date: "", to_date: "", hours: "", notes: "" };
}

function AvailabilitySection() {
  const { allPeople } = useEm();
  const availability = usePlanningAvailability();
  const addEntry = useAddPlanningAvailability();
  const updateEntry = useUpdatePlanningAvailability();
  const deleteEntry = useDeletePlanningAvailability();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const peopleById = new Map(allPeople.map((p) => [p.id, p.name]));
  const saving = addEntry.isPending || updateEntry.isPending;

  function startEdit(row: PlanningAvailabilityRow) {
    setEditingId(row.id);
    setForm({
      person_id: row.person_id,
      from_date: row.from_date,
      to_date: row.to_date,
      hours: String(row.hours),
      notes: row.notes ?? "",
    });
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  }

  async function handleSubmit() {
    if (!form.person_id || !form.from_date || !form.to_date || !form.hours) {
      setFormError("Employee, from date, to date and hours are required.");
      return;
    }
    if (form.to_date < form.from_date) {
      setFormError("To date can't be before the from date.");
      return;
    }
    const hours = Number(form.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setFormError("Hours must be a positive number.");
      return;
    }
    setFormError(null);
    const payload = {
      person_id: form.person_id,
      from_date: form.from_date,
      to_date: form.to_date,
      hours,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) {
        await updateEntry.mutateAsync({ id: editingId, ...payload });
      } else {
        await addEntry.mutateAsync(payload);
      }
      cancelEdit();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save availability.");
    }
  }

  return (
    <Panel>
      <SectionHeader
        title="Availability"
        hint="Record time off or reduced hours for engineering capacity planning"
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Employee", "From", "To", "Hours", "Notes", ""].map((h) => (
                <th key={h} className="stat-label py-2 pr-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(availability.data ?? []).map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 pr-4 font-medium">
                  {peopleById.get(row.person_id) ?? "Unknown"}
                </td>
                <td className="py-2.5 pr-4 tabular-nums">{row.from_date}</td>
                <td className="py-2.5 pr-4 tabular-nums">{row.to_date}</td>
                <td className="py-2.5 pr-4 tabular-nums">{row.hours}h</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{row.notes ?? "—"}</td>
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => startEdit(row)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      disabled={deleteEntry.isPending}
                      aria-label="Delete availability entry"
                      onClick={() => deleteEntry.mutate(row.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!availability.isLoading && (availability.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-muted-foreground">
                  No availability recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 rounded-md border border-border bg-card p-4">
        <p className="stat-label mb-3">{editingId ? "Edit entry" : "Add entry"}</p>
        <div className="grid gap-3 sm:grid-cols-5">
          <Select
            value={form.person_id}
            onValueChange={(v) => setForm((f) => ({ ...f, person_id: v }))}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              {allPeople.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="From date"
            value={form.from_date}
            onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))}
            className="h-9"
          />
          <Input
            type="date"
            aria-label="To date"
            value={form.to_date}
            onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))}
            className="h-9"
          />
          <Input
            type="number"
            min="0"
            step="0.5"
            placeholder="Hours"
            value={form.hours}
            onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
            className="h-9"
          />
          <Input
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="h-9"
          />
        </div>
        {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={handleSubmit}>
            {editingId ? "Save changes" : "Add"}
          </Button>
          {editingId && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
