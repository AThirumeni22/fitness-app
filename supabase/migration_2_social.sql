-- Trainlog — social features migration
--
-- Run this once in your Supabase project's SQL editor, AFTER schema.sql has
-- already been run (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It's additive: safe to run on a database that already has profiles /
-- custom_exercises / templates / workouts from schema.sql.
--
-- Adds: a display name + avatar per profile, a friend system, letting
-- friends see each other's workouts, a day-by-day photo/video feed
-- (BeReal-style), and a "pick a time to hit the gym" poll with voting.

-- ---------- profiles: name + avatar ----------
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists avatar_url text;

-- ---------- templates: allow editing (schema.sql only allowed insert/delete) ----------
drop policy if exists "templates: update own rows" on templates;
create policy "templates: update own rows"
  on templates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-exercise target sets/reps/weight for the guided "run this template"
-- player, keyed by exercise id: { "<exerciseId>": { "sets":4, "reps":8, "weight":60 } }.
-- Kept separate from exercise_ids (which stays a plain array of ids) so
-- nothing that already reads exercise_ids needs to change.
alter table templates add column if not exists targets jsonb not null default '{}'::jsonb;

-- ---------- friendships ----------
-- One row per friend relationship. Created as 'pending' by the sender,
-- flipped to 'accepted' by the recipient. Either person can remove it.
create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (user_id <> friend_id),
  constraint friendships_unique unique (user_id, friend_id)
);

alter table friendships enable row level security;

create policy "friendships: read rows you're part of"
  on friendships for select
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "friendships: send a request"
  on friendships for insert
  with check (auth.uid() = user_id);

create policy "friendships: recipient can accept"
  on friendships for update
  using (auth.uid() = friend_id)
  with check (auth.uid() = friend_id);

create policy "friendships: either side can remove"
  on friendships for delete
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- Helper used by other tables' policies: is the given user an accepted
-- friend of the person running the query?
create or replace function is_friend(other_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_id = auth.uid() and friend_id = other_id)
        or (friend_id = auth.uid() and user_id = other_id))
  );
$$;

-- Look up someone by email to send them a friend request. Runs with
-- elevated privileges (only way to peek at auth.users) but only ever
-- returns their profile id/name/avatar, never their email or anything else.
create or replace function find_user_by_email(lookup_email text)
returns table(id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url
  from auth.users u
  join profiles p on p.id = u.id
  where lower(u.email) = lower(lookup_email)
  limit 1;
$$;
grant execute on function find_user_by_email(text) to authenticated;

-- Batch profile lookup (names/avatars only) for rendering friend lists,
-- pending requests, and "who trained" on the calendar — sidesteps RLS
-- edge cases around seeing a profile before a friend request is accepted.
create or replace function get_profiles_public(ids uuid[])
returns table(id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url from profiles p where p.id = any(ids);
$$;
grant execute on function get_profiles_public(uuid[]) to authenticated;

-- ---------- let friends see each other's workouts ----------
-- (their own-row policy from schema.sql still applies; this adds to it)
create policy "workouts: friends can read"
  on workouts for select
  using (is_friend(user_id));

-- ---------- day_posts ----------
-- A BeReal-style photo/video attached to a specific calendar day.
create table if not exists day_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_date date not null,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  caption text,
  created_at timestamptz not null default now()
);

alter table day_posts enable row level security;

create policy "day_posts: read own"
  on day_posts for select
  using (auth.uid() = user_id);

create policy "day_posts: friends can read"
  on day_posts for select
  using (is_friend(user_id));

create policy "day_posts: insert own"
  on day_posts for insert
  with check (auth.uid() = user_id);

create policy "day_posts: delete own"
  on day_posts for delete
  using (auth.uid() = user_id);

create index if not exists day_posts_user_date_idx on day_posts (user_id, post_date desc);

-- ---------- gym_plans: "let's hit the gym" polls ----------
create table if not exists gym_plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Gym session',
  created_at timestamptz not null default now()
);

create table if not exists gym_plan_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references gym_plans (id) on delete cascade,
  starts_at timestamptz not null
);

create table if not exists gym_plan_votes (
  plan_id uuid not null references gym_plans (id) on delete cascade,
  option_id uuid not null references gym_plan_options (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);

alter table gym_plans enable row level security;
alter table gym_plan_options enable row level security;
alter table gym_plan_votes enable row level security;

create policy "gym_plans: visible to creator and friends"
  on gym_plans for select
  using (auth.uid() = creator_id or is_friend(creator_id));

create policy "gym_plans: insert own"
  on gym_plans for insert
  with check (auth.uid() = creator_id);

create policy "gym_plans: creator can delete"
  on gym_plans for delete
  using (auth.uid() = creator_id);

create policy "gym_plan_options: visible if plan visible"
  on gym_plan_options for select
  using (exists (
    select 1 from gym_plans gp where gp.id = plan_id
      and (gp.creator_id = auth.uid() or is_friend(gp.creator_id))
  ));

create policy "gym_plan_options: creator can add"
  on gym_plan_options for insert
  with check (exists (
    select 1 from gym_plans gp where gp.id = plan_id and gp.creator_id = auth.uid()
  ));

create policy "gym_plan_options: creator can remove"
  on gym_plan_options for delete
  using (exists (
    select 1 from gym_plans gp where gp.id = plan_id and gp.creator_id = auth.uid()
  ));

create policy "gym_plan_votes: visible if plan visible"
  on gym_plan_votes for select
  using (exists (
    select 1 from gym_plans gp where gp.id = plan_id
      and (gp.creator_id = auth.uid() or is_friend(gp.creator_id))
  ));

create policy "gym_plan_votes: vote if plan visible"
  on gym_plan_votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from gym_plans gp where gp.id = plan_id
        and (gp.creator_id = auth.uid() or is_friend(gp.creator_id))
    )
  );

create policy "gym_plan_votes: remove own vote"
  on gym_plan_votes for delete
  using (auth.uid() = user_id);

-- ---------- storage: avatars + day-media ----------
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('day-media', 'day-media', true)
  on conflict (id) do nothing;

-- Both buckets are public for reads (anyone with the URL can view — that's
-- what lets a friend's photo actually load in your app). Uploads are
-- locked to files under a path starting with your own user id, e.g.
-- avatars/<your-user-id>/photo.jpg — the app already uploads this way.
create policy "avatars: upload into your own folder"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: replace your own files"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: delete your own files"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "day-media: upload into your own folder"
  on storage.objects for insert
  with check (bucket_id = 'day-media' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "day-media: delete your own files"
  on storage.objects for delete
  using (bucket_id = 'day-media' and auth.uid()::text = (storage.foldername(name))[1]);
