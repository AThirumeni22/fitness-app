-- Obonto — lets people delete their own workouts (History -> open a workout
-- -> Delete workout), e.g. one logged by mistake.
--
-- Run this once in the Supabase SQL editor, after
-- migration_6_notifications.sql. Safe to re-run. Friends can still only
-- read your workouts, never delete them.

grant delete on public.workouts to authenticated;
grant delete on public.workouts to service_role;

drop policy if exists "workouts: delete own rows" on workouts;
create policy "workouts: delete own rows"
  on workouts for delete
  using (auth.uid() = user_id);
