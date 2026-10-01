-- Obonto — lets each person pin favorite templates (shown as quick-start
-- tiles on the Train tab home screen) and hide the three starter templates
-- (Push/Pull/Leg Day) they don't want cluttering their list.
--
-- Run this once in the Supabase SQL editor, after migration_3_plan_template.sql.
-- Additive and safe to run even with existing profiles — ADD COLUMN IF NOT
-- EXISTS never touches existing rows, and no new grants are needed since
-- profiles is already granted to authenticated/service_role from schema.sql.

alter table profiles add column if not exists template_prefs jsonb not null default '{}'::jsonb;
