-- Dedicated store for the Planning page's ad-hoc "Availability" form
-- (team-pulse-54 frontend) -- deliberately separate from `adjustments`,
-- which is a single leave-days-per-sprint count per person that's a real
-- input to the sync's computeMetrics() pipeline (see metrics.mjs). This
-- form captures a different shape (multiple arbitrary date-ranged hour
-- entries per person) and must not be mixed into a table the real metrics
-- computation depends on.
create table planning_availability (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id),
  from_date date not null,
  to_date date not null,
  hours numeric(6, 1) not null,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_planning_availability_person on planning_availability (person_id);

alter table planning_availability enable row level security;
create policy planning_availability_read_all on planning_availability for select using (true);
-- Deliberately permissive, matching adjustments_*_all (0037): no ownership
-- check, anyone with the anon key can create/edit/delete any entry. Accepted
-- tradeoff for this low-sensitivity, purely-local-capacity-planning data.
create policy planning_availability_insert_all on planning_availability for insert with check (true);
create policy planning_availability_update_all on planning_availability for update using (true) with check (true);
create policy planning_availability_delete_all on planning_availability for delete using (true);
