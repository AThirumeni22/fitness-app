-- Obonto — onboarding consent + sharing templates with friends
--
-- Run this once in the Supabase SQL editor, after migration_4_template_prefs.sql.
-- Additive and safe to re-run.
--
-- Adds:
--   1. profiles.privacy_accepted_at / privacy_version — records when someone
--      accepted the privacy notice shown on first sign-in (GDPR consent), and
--      which version of it they saw.
--   2. template_shares — a friend sends you a snapshot of one of their
--      templates; you add your own copy and change the reps/weights freely.

-- ---------- 1. privacy consent ----------
alter table profiles add column if not exists privacy_accepted_at timestamptz;
alter table profiles add column if not exists privacy_version text;

-- ---------- 2. template shares ----------
create table if not exists template_shares (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  exercise_ids jsonb not null default '[]'::jsonb,
  -- per-exercise sets/reps/weight/rest, same shape as templates.targets
  targets jsonb not null default '{}'::jsonb,
  -- { "<exerciseId>": { "name": "...", "cat": "...", "custom": true } } so the
  -- recipient can recreate the sender's custom exercises they don't have
  exercise_meta jsonb not null default '{}'::jsonb,
  -- unit the target weights are written in (the sender's display unit)
  unit text not null default 'kg' check (unit in ('kg', 'lb')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint template_shares_no_self check (sender_id <> recipient_id)
);

alter table template_shares enable row level security;

grant select, insert, update, delete on public.template_shares to authenticated;
grant select, insert, update, delete on public.template_shares to service_role;

drop policy if exists "template_shares: sender and recipient can read" on template_shares;
create policy "template_shares: sender and recipient can read"
  on template_shares for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- You can only send to someone who is an accepted friend.
drop policy if exists "template_shares: send to a friend" on template_shares;
create policy "template_shares: send to a friend"
  on template_shares for insert
  with check (auth.uid() = sender_id and is_friend(recipient_id));

-- Only the recipient can accept/decline.
drop policy if exists "template_shares: recipient can respond" on template_shares;
create policy "template_shares: recipient can respond"
  on template_shares for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "template_shares: either side can delete" on template_shares;
create policy "template_shares: either side can delete"
  on template_shares for delete
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create index if not exists template_shares_recipient_idx on template_shares (recipient_id, status, created_at desc);
