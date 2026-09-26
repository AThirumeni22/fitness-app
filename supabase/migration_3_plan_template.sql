-- SocialGym — adds an optional template name to "propose a time" plans.
--
-- Run this once in the Supabase SQL editor, after migration_2_social.sql.
-- Additive and safe to run even if you've already got gym_plans data —
-- ADD COLUMN IF NOT EXISTS never touches existing rows, and no new grants
-- are needed since gym_plans is already granted to authenticated/service_role
-- from migration_2_social.sql.

alter table gym_plans add column if not exists template_name text;
