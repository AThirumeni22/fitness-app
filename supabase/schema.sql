-- Trainlog database schema
--
-- Run this once in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- It creates one table per user-owned resource and locks every table down
-- with Row Level Security so each person can only ever see and change
-- their own rows -- Supabase's `auth.uid()` gives the signed-in user's id
-- for free, no extra wiring needed on the client.

-- ---------- profiles ----------
-- One row per user, for account-level preferences (currently just the
-- kg/lb display unit).
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  unit text not null default 'kg' check (unit in ('kg', 'lb')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own row"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own row"
  on profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own row"
  on profiles for update
  using (auth.uid() = id);

-- ---------- custom_exercises ----------
-- Exercises a user adds beyond the built-in library (which ships in the
-- app's code, not the database).
create table if not exists custom_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  cat text not null,
  created_at timestamptz not null default now()
);

alter table custom_exercises enable row level security;

create policy "custom_exercises: read own rows"
  on custom_exercises for select
  using (auth.uid() = user_id);

create policy "custom_exercises: insert own rows"
  on custom_exercises for insert
  with check (auth.uid() = user_id);

create policy "custom_exercises: delete own rows"
  on custom_exercises for delete
  using (auth.uid() = user_id);

-- ---------- templates ----------
-- Reusable workout templates a user builds (e.g. "Upper Body A"). Exercise
-- ids are stored as a JSON array referencing either a built-in exercise id
-- (a slug, e.g. "bench-press") or a custom_exercises.id (a uuid).
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  exercise_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table templates enable row level security;

create policy "templates: read own rows"
  on templates for select
  using (auth.uid() = user_id);

create policy "templates: insert own rows"
  on templates for insert
  with check (auth.uid() = user_id);

create policy "templates: delete own rows"
  on templates for delete
  using (auth.uid() = user_id);

-- ---------- workouts ----------
-- One row per finished workout session. `exercises` is a JSON blob shaped
-- like: [{ "exerciseId": "bench-press", "name": "Bench Press",
--          "sets": [{ "kg": 60, "reps": 8 }, ...] }, ...]
-- Weight is always stored in kilograms; the app converts for display.
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date timestamptz not null,
  duration_sec integer not null default 0,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table workouts enable row level security;

create policy "workouts: read own rows"
  on workouts for select
  using (auth.uid() = user_id);

create policy "workouts: insert own rows"
  on workouts for insert
  with check (auth.uid() = user_id);

create index if not exists workouts_user_date_idx on workouts (user_id, date desc);
