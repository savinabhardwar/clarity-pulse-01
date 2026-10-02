-- 0006_fix_requirements_project_id_type.sql
-- Real bug found live 2026-09-23: projects.requirements_project_id was
-- typed uuid in migration 0001, on the documented (but never actually
-- verified) assumption that project-compass's own project ids are uuids.
-- They are not -- project-compass/supabase/migrations/0001_stakeholder_schema.sql
-- defines stakeholder_items.project_id as `text not null references
-- stakeholder_projects(id)`, and stakeholder_projects.id is itself a text
-- slug (confirmed live: a real row returned `project_id: "automated-mis"`,
-- which a uuid column would reject outright). Forward-only fix, not an
-- edit to the already-applied 0001, per this project's own migration
-- discipline.
alter table projects
  alter column requirements_project_id type text;
