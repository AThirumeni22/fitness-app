-- Obonto — notifications (in-app bell + phone/desktop push)
--
-- Run this once in the Supabase SQL editor, after
-- migration_5_onboarding_sharing.sql. Additive and safe to re-run.
--
-- Adds:
--   1. notifications — one row per person to tell about something. Rows are
--      only ever written by the triggers below (never by the app), so nobody
--      can fake a notification to someone else. The app shows them under the
--      bell; a Database Webhook on INSERT calls the `send-push` Edge Function,
--      which delivers them as push notifications (see README).
--   2. push_subscriptions — the browsers/phones each person turned
--      notifications on for.
--   3. gym_plan_votes.available — "I'm in" (true) vs "Can't make it" (false).
--      Existing votes were all "I'm in", so they default to true.
--   4. profiles.timezone — so "Sat Oct 3, 6:00 PM" in a notification is in
--      the reader's own time zone.
--   5. Triggers: friend request sent / accepted; session proposed, replied
--      to, cancelled; and a reminder ~1 hour before a session (pg_cron).

-- ---------- 1. notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null,
  title text not null,
  body text not null default '',
  url text not null default '/',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table notifications enable row level security;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

drop policy if exists "notifications: read own" on notifications;
create policy "notifications: read own"
  on notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications: mark own read" on notifications;
create policy "notifications: mark own read"
  on notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications: delete own" on notifications;
create policy "notifications: delete own"
  on notifications for delete
  using (auth.uid() = user_id);

create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- Live updates for the bell while the app is open.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- ---------- 2. push subscriptions ----------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

drop policy if exists "push_subscriptions: read own" on push_subscriptions;
create policy "push_subscriptions: read own"
  on push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions: delete own" on push_subscriptions;
create policy "push_subscriptions: delete own"
  on push_subscriptions for delete
  using (auth.uid() = user_id);

-- Saving goes through this function so a device that someone else used
-- before (and didn't sign out of properly) is moved over to whoever is
-- signed in now, instead of failing on the unique endpoint.
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
$$;
revoke execute on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- ---------- 3. "can't make it" replies ----------
alter table gym_plan_votes add column if not exists available boolean not null default true;

grant update on public.gym_plan_votes to authenticated;
grant update on public.gym_plan_votes to service_role;

drop policy if exists "gym_plan_votes: change own reply" on gym_plan_votes;
create policy "gym_plan_votes: change own reply"
  on gym_plan_votes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table gym_plan_options add column if not exists reminded_at timestamptz;

-- ---------- 4. time zone ----------
alter table profiles add column if not exists timezone text;

-- ---------- 5. helpers ----------
create or replace function notif_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select nullif(trim(display_name), '') from profiles where id = p_user), 'A friend');
$$;

-- "Sat Oct 3, 6:00 PM" in the recipient's time zone (UTC if unknown/invalid).
create or replace function notif_time(p_ts timestamptz, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
begin
  select timezone into tz from profiles where id = p_user;
  return to_char(p_ts at time zone coalesce(nullif(tz, ''), 'UTC'), 'Dy Mon FMDD, FMHH12:MI AM');
exception when others then
  return to_char(p_ts at time zone 'UTC', 'Dy Mon FMDD, FMHH12:MI AM') || ' UTC';
end;
$$;

create or replace function notify(p_user uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  insert into notifications (user_id, actor_id, kind, title, body, url)
  values (p_user, p_actor, p_kind, p_title, coalesce(p_body, ''), coalesce(p_url, '/'));
end;
$$;

-- None of the helpers are for the app to call directly.
revoke execute on function notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function notif_name(uuid) from public, anon, authenticated;
revoke execute on function notif_time(timestamptz, uuid) from public, anon, authenticated;

-- ---------- 6. friend requests ----------
create or replace function trg_friendship_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform notify(new.friend_id, new.user_id, 'friend_request',
      'New friend request',
      notif_name(new.user_id) || ' wants to be friends on Obonto',
      '/?tab=friends');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform notify(new.user_id, new.friend_id, 'friend_accepted',
      'Friend request accepted',
      notif_name(new.friend_id) || ' accepted your friend request',
      '/?tab=friends');
  end if;
  return null;
end;
$$;

drop trigger if exists friendships_notify on friendships;
create trigger friendships_notify
  after insert or update on friendships
  for each row execute function trg_friendship_notify();

-- ---------- 7. gym sessions ----------
-- New session: tell every friend of the person proposing it. Fires on the
-- option row (not the plan) because that's where the date/time lives —
-- createGymPlan inserts the plan first, then its one option.
create or replace function trg_gym_option_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p gym_plans%rowtype;
  f uuid;
begin
  if new.starts_at <= now() then return null; end if;
  select * into p from gym_plans where id = new.plan_id;
  if not found then return null; end if;
  for f in
    select case when user_id = p.creator_id then friend_id else user_id end
    from friendships
    where status = 'accepted' and (user_id = p.creator_id or friend_id = p.creator_id)
  loop
    perform notify(f, p.creator_id, 'plan_proposed',
      notif_name(p.creator_id) || ' proposed a session',
      p.title || ' — ' || notif_time(new.starts_at, f)
        || coalesce(' (' || p.template_name || ')', '') || '. Are you in?',
      '/?tab=calendar');
  end loop;
  return null;
end;
$$;

drop trigger if exists gym_plan_options_notify on gym_plan_options;
create trigger gym_plan_options_notify
  after insert on gym_plan_options
  for each row execute function trg_gym_option_notify();

-- Replies: tell the person who proposed it plus everyone else who's in.
create or replace function trg_gym_vote_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r gym_plan_votes%rowtype;
  p gym_plans%rowtype;
  o gym_plan_options%rowtype;
  verb text;
  kind text;
  rcpt uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;

  -- Votes removed because the whole session was deleted: the cancellation
  -- trigger already told everyone, so don't also send "X backed out".
  if tg_op = 'DELETE' and current_setting('obonto.cancelling_plan', true) = old.plan_id::text then
    return null;
  end if;

  select * into p from gym_plans where id = r.plan_id;
  if not found then return null; end if;
  select * into o from gym_plan_options where id = r.option_id;
  if not found or o.starts_at <= now() then return null; end if;

  if tg_op = 'INSERT' then
    if new.available then verb := 'is in'; kind := 'plan_joined';
    else verb := 'can''t make it'; kind := 'plan_declined'; end if;
  elsif tg_op = 'UPDATE' then
    if new.available is not distinct from old.available then return null; end if;
    if new.available then verb := 'is in now'; kind := 'plan_joined';
    else verb := 'can''t make it any more'; kind := 'plan_declined'; end if;
  else
    if not old.available then return null; end if; -- clearing a "can't make it" isn't news
    verb := 'backed out'; kind := 'plan_left';
  end if;

  for rcpt in
    select p.creator_id
    union
    select v.user_id from gym_plan_votes v
    where v.option_id = r.option_id and v.available
  loop
    perform notify(rcpt, r.user_id, kind,
      notif_name(r.user_id) || ' ' || verb,
      p.title || ' — ' || notif_time(o.starts_at, rcpt),
      '/?tab=calendar');
  end loop;
  return null;
end;
$$;

drop trigger if exists gym_plan_votes_notify on gym_plan_votes;
create trigger gym_plan_votes_notify
  after insert or update or delete on gym_plan_votes
  for each row execute function trg_gym_vote_notify();

-- Cancelled: tell everyone who was in (before the cascade removes the votes).
create or replace function trg_gym_plan_cancel_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o gym_plan_options%rowtype;
  rcpt uuid;
begin
  perform set_config('obonto.cancelling_plan', old.id::text, true);
  select * into o from gym_plan_options where plan_id = old.id order by starts_at limit 1;
  if not found or o.starts_at <= now() then return old; end if;
  for rcpt in
    select distinct v.user_id from gym_plan_votes v
    where v.plan_id = old.id and v.available
  loop
    perform notify(rcpt, old.creator_id, 'plan_cancelled',
      'Session cancelled',
      notif_name(old.creator_id) || ' cancelled ' || old.title || ' — ' || notif_time(o.starts_at, rcpt),
      '/?tab=calendar');
  end loop;
  return old;
end;
$$;

drop trigger if exists gym_plans_cancel_notify on gym_plans;
create trigger gym_plans_cancel_notify
  before delete on gym_plans
  for each row execute function trg_gym_plan_cancel_notify();

-- Reminder ~1 hour before: everyone who's in, plus the person who proposed it.
create or replace function notify_upcoming_gym_plans()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  rcpt uuid;
  n integer := 0;
begin
  for o in
    select go.id, go.starts_at, gp.title, gp.creator_id
    from gym_plan_options go
    join gym_plans gp on gp.id = go.plan_id
    where go.reminded_at is null
      and go.starts_at > now()
      and go.starts_at <= now() + interval '60 minutes'
    for update of go skip locked
  loop
    for rcpt in
      select o.creator_id
      union
      select v.user_id from gym_plan_votes v where v.option_id = o.id and v.available
    loop
      perform notify(rcpt, null, 'plan_reminder',
        'Starting soon: ' || o.title,
        notif_time(o.starts_at, rcpt) || ' — see who''s coming',
        '/?tab=calendar');
    end loop;
    update gym_plan_options set reminded_at = now() where id = o.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function notify_upcoming_gym_plans() from public, anon, authenticated;

-- Check every 5 minutes. (If this line errors, enable "pg_cron" under
-- Database -> Extensions in the Supabase dashboard and run it again.)
create extension if not exists pg_cron;
select cron.schedule('obonto-session-reminders', '*/5 * * * *', 'select public.notify_upcoming_gym_plans()');
