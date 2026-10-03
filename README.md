# Obonto

A workout logger you and your friends can each sign into and keep your own
training history in. Log sets and reps, get an auto-starting rest timer,
build reusable workout templates, and see progress charts over time. Every
account only ever sees its own data.

Built with plain JavaScript + [Vite](https://vitejs.dev) on the frontend and
[Supabase](https://supabase.com) (Postgres + Auth) as the backend, so there's
no server to run yourself.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (free), and create a
   new project. Pick any name/region/password (the database password isn't
   needed anywhere below).
2. Once it's ready, open **SQL Editor** in the left sidebar, paste in the
   contents of [`supabase/schema.sql`](./supabase/schema.sql), and click
   **Run**. This creates the tables and locks each one down so users can
   only ever read or write their own rows.
2b. Run a second query with the contents of
   [`supabase/migration_2_social.sql`](./supabase/migration_2_social.sql).
   This adds everything for Friends, the Calendar, and gym-time polls:
   friend requests, letting friends see each
   other's workouts, a day-by-day photo/video feed, and two public storage
   buckets (`avatars`, `day-media`) it creates for you. Run it once, after
   schema.sql.
2c. Run a third query with the contents of
   [`supabase/migration_3_plan_template.sql`](./supabase/migration_3_plan_template.sql).
   This just adds one column (an optional template name on a proposed gym
   session) — run it once, after migration_2_social.sql.
2d. Run a fourth query with the contents of
   [`supabase/migration_4_template_prefs.sql`](./supabase/migration_4_template_prefs.sql).
   This adds one more column that stores which templates someone's pinned
   and which built-in templates they've hidden — run it once, after
   migration_3_plan_template.sql.
2e. Run a fifth query with the contents of
   [`supabase/migration_5_onboarding_sharing.sql`](./supabase/migration_5_onboarding_sharing.sql).
   This stores each person's privacy-notice consent and adds the
   `template_shares` table used to send templates to friends — run it once,
   after migration_4_template_prefs.sql.
2f. Run a sixth query with the contents of
   [`supabase/migration_6_notifications.sql`](./supabase/migration_6_notifications.sql).
   This adds notifications (friend requests, proposed sessions, replies,
   cancellations, reminders), the "Can't make it" reply, and a 5-minute
   reminder job. If it stops with an error about `pg_cron`, enable
   **pg_cron** under **Database -> Extensions** and run it again. Then
   finish the notification setup in [Notifications](#4-notifications).
2g. Run a seventh query with the contents of
   [`supabase/migration_7_workout_delete.sql`](./supabase/migration_7_workout_delete.sql).
   It lets people delete their own workouts from History (e.g. one logged
   by mistake) and fully remove their own calendar photos/videos — run it
   once, after migration_6_notifications.sql.
3. Open **Project Settings -> API**. You'll need two values from this page
   in a minute: the **Project URL** and the **anon public** key.
4. Optional, but recommended for onboarding friends quickly: under
   **Authentication -> Providers -> Email**, turn off "Confirm email" so
   people can sign up and start using the app immediately instead of
   waiting on a confirmation email. (Leave it on if you'd rather have that
   extra verification step.)

5. For **Forgot password** to work, open **Authentication -> URL
   Configuration** and add your app's addresses under **Redirect URLs**:
   `http://localhost:5173/**` for local development and
   `https://your-project.vercel.app/**` once deployed (also set **Site URL**
   to the deployed address). The reset email links back to the app, which
   then asks for a new password. You can reword that email under
   **Authentication -> Email Templates -> Reset Password**.

## 2. Run it locally

```bash
npm install
cp .env.example .env
# edit .env and paste in your Project URL + anon key from step 1.3
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). Create an
account, and you're logging workouts.

## 3. Deploy it so your friends can use it

The frontend is a static site, so any static host works. The easiest path:

1. Push this repo to GitHub (see below if you haven't already).
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click
   **Add New -> Project**, then import this repo.
3. Before deploying, open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon public key
   - `VITE_VAPID_PUBLIC_KEY` — the public push key (see [Notifications](#4-notifications))
4. Click **Deploy**. Vercel builds and gives you a live URL
   (`your-project.vercel.app`) — send that to your friends. Every push to
   the main branch redeploys automatically.

The anon key is safe to expose in a public frontend — it can't do anything
beyond what the Row Level Security policies in `supabase/schema.sql` allow,
which is: read and write your own rows, never anyone else's.

## 4. Notifications

Friends get a notification (on their phone or computer, and under the bell
in the app's top bar) when:

- someone sends them a friend request, or accepts theirs;
- a friend proposes a session in the Calendar (so they can tap "I'm in" or
  "Can't make it");
- someone replies to a session they proposed or are going to, or backs out;
- a session they were going to is cancelled;
- a session they're in starts in about an hour.

All of this is free. Who gets told what is decided by database triggers in
`migration_6_notifications.sql`; the `send-push` Edge Function just delivers
them. One-time setup:

1. **Make a push key pair** (once, on your computer):
   `npx web-push generate-vapid-keys`. It prints a public key and a
   private key. The public one is fine to share; keep the private one secret.
2. **Deploy the Edge Function.** Either:
   - in the Supabase dashboard: **Edge Functions -> Deploy a new function ->
     Via Editor**, name it `send-push`, paste in
     [`supabase/functions/send-push/index.ts`](./supabase/functions/send-push/index.ts),
     and click **Deploy**; or
   - from this folder: `npx supabase login`, then
     `npx supabase functions deploy send-push --project-ref <your-project-ref>`.
3. **Add its secrets:** **Edge Functions -> Secrets**, add
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a
   `mailto:you@example.com` address push services can contact).
4. **Connect it to the table:** **Database -> Webhooks -> Create a new hook**:
   table `notifications`, event **Insert**, type **Supabase Edge
   Functions**, function `send-push`, and keep the default `Authorization`
   header that's added for you. Save.
5. **Give the app the public key:** add `VITE_VAPID_PUBLIC_KEY` to your
   `.env` and to Vercel's Environment Variables, then redeploy.

Each person then turns notifications on per device: the "Don't miss a
session" card on the Train tab, or **Profile -> Notifications**.

### Installing on your phone

Obonto is an installable web app (a PWA), so there's no app store and no
cost.

- **iPhone/iPad (iOS 16.4+):** open the site in Safari, tap **Share -> Add
  to Home Screen**, then open Obonto from the new icon. Notifications only
  work in the installed app on iPhone, not in a Safari tab.
- **Android:** open the site in Chrome and tap **Install app** (or menu ->
  **Add to Home screen**).
- **Computer:** Chrome/Edge show an install icon in the address bar.
  Notifications also work in a normal browser tab.

If notifications don't arrive: check **Profile -> Notifications** says On,
check the phone's notification settings for Obonto, and look at
**Edge Functions -> send-push -> Logs** in Supabase.

## How data is scoped per person

- Every table (`profiles`, `custom_exercises`, `templates`, `workouts`) has
  a `user_id` column and a Row Level Security policy that only allows a
  signed-in user to touch rows where `user_id` matches their own id.
- The built-in exercise library (~100 exercises, `src/library.js`)
  and starter templates (`src/exercises.js`) aren't stored in the database at
  all — they ship with the app for everyone. Only exercises/templates someone
  adds themselves, and their finished workouts, are saved to their account.
- The workout you're currently in the middle of (not yet finished) is kept
  in that browser's local storage, not the database, so it survives a
  refresh but doesn't follow you to another device until you hit Finish.

## Social features

- **Friends** — add someone by the email they signed up with (Friends tab).
  They get a pending request and accept it from their own Friends tab; from
  then on you can each see the other's workouts, calendar days, and any
  gym-time polls the other creates.
- **Recent activity** — the top of the Friends tab is a feed of your and
  your friends' workouts from the last three weeks (exercises, set count,
  duration, newest first). This is just a dedicated place to see the
  visibility that already existed via Row Level Security — there's no
  separate "share" step; finishing a workout is what makes it show up.
- **Pin templates** — the star icon on any template (Exercises tab) pins
  it as a quick-start tile on the Train tab home screen — tap Start.
- **Muscles hit** — the home screen's radial chart shows total volume
  (weight × reps) per muscle group for the last 30 days or all time; the
  more rings a wedge fills, the more that group got relative to your
  most-trained one.
- **Update template after a workout** — finishing a workout started from a
  template offers to save today's sets (weight, reps and rest for each set)
  back into that template, with a before/after preview.
- **Hide default templates** — the crossed-out-eye icon on Push/Pull/Leg
  Day (Exercises tab) hides that one from your list; nothing is deleted,
  and "Restore hidden default templates" in Profile settings brings them
  all back if you change your mind.
- **Calendar** — a monthly grid of your + your friends' training days (a
  dot for you, a different dot for a friend, a camera glyph for a day with
  photos/videos). Tap a day to see who trained and what they hit, plus a
  BeReal-style feed of that day's photos/videos with an upload button.
  Friend visibility relies entirely on Row Level Security — the client
  never decides who can see what.
- **Plan a session** — at the bottom of the Calendar tab, "Propose a time"
  is a single simple form: a title, a date, a time picked with a slider,
  and (optionally) one of your own templates so friends know the workout
  in advance. Friends answer "I'm in" or "Can't make it" (tap your answer
  again to clear it), and the card lists who's in and who can't. Everyone
  is notified as replies come in (see [Notifications](#4-notifications)).
  The proposer can cancel with the ×. Proposals disappear on their own
  once their time has passed.
- **Day view** — tapping a calendar day shows each person's workout as a
  card (time, sets, volume, exercises) and that day's photos/videos; tap
  any photo to view it full screen in the app, swipe between them.
- **Profile** — tap the small circle in the top bar to set the name and
  photo your friends see you as (stored avatar in the `avatars` bucket).
  It's also where your weight unit (kg/lb) and your default rest timer
  live now, under a Settings section.
- **Workout screen** — one screen for every workout. Each exercise is a
  card of sets, pre-filled from the template (or from last time). Tap ▶ on
  a set when you start it (a set timer runs in the bar at the bottom), then
  ✓ when you're done: the row turns green and that set's rest counts down
  on the chip under it and in the bar (−15 / +15, and the bar's big ▶
  starts the next set). Tap a set number to delete it, the ⏱ to set rest
  for every set, ⋯ to move / replace / remove the exercise, and
  Progression for a chart of your best sets. Finishing with sets you
  filled in but didn't tick asks whether to log them. Sets with reps but
  no weight count as bodyweight ("BW").
- **Supersets** — tap the chain between two exercises to link them: you
  go A1 → B1 → rest → A2 → B2…, resting only after each round.
- **Templates with per-set targets** — the pencil icon on a template opens
  the editor: every set has its own weight, reps and rest, plus the same
  ⏱, ⋯, chain and Progression tools as the workout screen.
- **Exercise picker & details** — "Add exercise" lists your recent
  exercises first. Tapping a library exercise shows your best, how often
  you've done it and your last session, with a button to add it to the
  current workout (or start one with it).
- **Delete a workout** — open it in History and tap "Delete workout"
  (needs migration_7).
- **Delete a photo/video** — tap one of your own on a calendar day, then
  Delete. Friends' posts can't be deleted by you.
- **Rest timer** — every set has its own rest (from the template, or the
  default rest timer in Profile settings). When the countdown hits zero
  the bar turns red, beeps and counts up, so you can see how far over rest
  you've gone.

One current limitation worth knowing: a friend's own custom exercises
(ones they added themselves, not from the built-in library) show up in
their workout history with just a name, not a category, since categories
for custom exercises aren't shared across accounts — everything from the
built-in library works normally either way.

## Onboarding and privacy

- **Welcome flow** — the first time someone signs in they pick the name
  friends will see, then read the privacy notice and tick two boxes
  (data processing, and that photos/videos are shared with friends) before
  the app opens. Existing users see the notice once too. The notice text
  lives in `src/onboarding.js`: fill in `APP_OWNER` and `CONTACT_EMAIL`
  there, and bump `PRIVACY_VERSION` when you change the notice so everyone
  is asked to accept the new version. It's also readable any time from
  Profile → Privacy.
- **Share a template** — the share icon on any template (Exercises tab)
  sends a snapshot of it, including sets, reps, weights and rest, to the
  friends you pick. They see it under "Shared with you" (with a dot on the
  Exercises tab), tap "Add & customise" to get their own copy and adjust
  the numbers, and nothing they change affects yours. Weights are converted
  between kg and lb, and any of your custom exercises in it are recreated in
  their library.

## Exercise library

The built-in library (`src/library.js`) is a hand-picked list of about 100
common gym exercises with plain names ("Barbell Bench Press", "Machine
Incline Press", "Cable Lat Pulldown"…), each with short how-to steps. Every
exercise has a drawn mannequin animation (`src/figures.js`): a grey figure
moving between the start and end of the lift, with the equipment drawn in.
They're plain SVG, so there are no image files to load.

Older versions used a much larger library. `public/exercises-legacy.json`
maps each of those old exercises to its new equivalent, and the app applies
it automatically to your templates, history and any workout in progress, so
nothing is lost and PRs carry over. Old exercises with no equivalent keep
their name in your templates and history but don't appear in the library.

## Project structure

```
index.html            Entry HTML
src/
  main.js             Boots the app: shows the auth screen or the app
  auth.js             Sign in / sign up screen
  app.js              Main app UI (Train / History / Exercises tabs, workout screen, template sharing)
  onboarding.js       First-run name + privacy-notice (GDPR consent) flow
  notifications.js    Top-bar bell + notification list
  push.js             Turning push notifications on/off on this device
  fx.js               Presentational interactions (ripples, tab indicator, confetti)
  friends.js          Friends tab (requests, add by email)
  calendar.js         Calendar tab (visits, day photos/videos, gym-time polls)
  profile.js          Profile sheet (name + avatar)
  player.js           Template editor (per-set weight / reps / rest, supersets)
  setcards.js         Exercise cards, rest picker, menus and progression shared by the workout screen and editor
  db.js               All Supabase reads/writes
  supabaseClient.js   Supabase client setup
  exercises.js        Starter templates + loading the library and old-exercise mapping
  library.js          The ~100 built-in exercises (names, equipment, how-to steps)
  figures.js          Drawn mannequin animations for each exercise
  chart.js            Small SVG progress chart
  utils.js            Formatting/unit-conversion helpers
  style.css           All styling
supabase/
  schema.sql                    Base schema + Row Level Security policies
  migration_2_social.sql        Friends, calendar/day-posts, gym-time polls, storage buckets
  migration_3_plan_template.sql Adds an optional template name to proposed gym sessions
  migration_4_template_prefs.sql Adds pinned/hidden template preferences per profile
  migration_5_onboarding_sharing.sql Privacy consent columns + template_shares table
  migration_6_notifications.sql Notifications, push subscriptions, "can't make it", reminders
  migration_7_workout_delete.sql Lets people delete their own workouts and photo/video files
  functions/send-push/index.ts  Edge Function that delivers push notifications
```

## Local development notes

- `npm run build` produces a production build in `dist/`.
- `npm run preview` serves that build locally to sanity-check it.
- There's no build step tied to Supabase — schema changes are applied by
  re-running SQL in the Supabase dashboard.
