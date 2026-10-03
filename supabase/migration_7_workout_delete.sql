-- Obonto — lets people delete their own workouts (History -> open a workout
-- -> Delete workout) and their own calendar photos/videos (tap one -> Delete).
--
-- Run this once in the Supabase SQL editor, after
-- migration_6_notifications.sql. Safe to re-run. Friends can still only
-- read your workouts and posts, never delete them.

-- ---------- workouts ----------
grant delete on public.workouts to authenticated;
grant delete on public.workouts to service_role;

drop policy if exists "workouts: delete own rows" on workouts;
create policy "workouts: delete own rows"
  on workouts for delete
  using (auth.uid() = user_id);

-- ---------- photo/video files ----------
-- Deleting a post already worked (migration_2), but removing its file from
-- storage also needs permission to read it — without this the file quietly
-- stayed behind. Only covers files in your own folder; the bucket is public
-- for viewing anyway, so this doesn't expose anything new.
drop policy if exists "day-media: read your own files" on storage.objects;
create policy "day-media: read your own files"
  on storage.objects for select
  using (bucket_id = 'day-media' and auth.uid()::text = (storage.foldername(name))[1]);
