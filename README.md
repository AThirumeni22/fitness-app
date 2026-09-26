# SocialGym

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
   This adds everything for Friends, the Calendar, gym-time polls, and the
   guided template player: friend requests, letting friends see each
   other's workouts, a day-by-day photo/video feed, and two public storage
   buckets (`avatars`, `day-media`) it creates for you. Run it once, after
   schema.sql.
2c. Run a third query with the contents of
   [`supabase/migration_3_plan_template.sql`](./supabase/migration_3_plan_template.sql).
   This just adds one column (an optional template name on a proposed gym
   session) — run it once, after migration_2_social.sql.
3. Open **Project Settings -> API**. You'll need two values from this page
   in a minute: the **Project URL** and the **anon public** key.
4. Optional, but recommended for onboarding friends quickly: under
   **Authentication -> Providers -> Email**, turn off "Confirm email" so
   people can sign up and start using the app immediately instead of
   waiting on a confirmation email. (Leave it on if you'd rather have that
   extra verification step.)

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
4. Click **Deploy**. Vercel builds and gives you a live URL
   (`your-project.vercel.app`) — send that to your friends. Every push to
   the main branch redeploys automatically.

The anon key is safe to expose in a public frontend — it can't do anything
beyond what the Row Level Security policies in `supabase/schema.sql` allow,
which is: read and write your own rows, never anyone else's.

## How data is scoped per person

- Every table (`profiles`, `custom_exercises`, `templates`, `workouts`) has
  a `user_id` column and a Row Level Security policy that only allows a
  signed-in user to touch rows where `user_id` matches their own id.
- The built-in exercise library (875+ exercises, `public/exercises-data.json`)
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
- **Calendar** — a monthly grid of your + your friends' training days (a
  dot for you, a different dot for a friend, a camera glyph for a day with
  photos/videos). Tap a day to see who trained and what they hit, plus a
  BeReal-style feed of that day's photos/videos with an upload button.
  Friend visibility relies entirely on Row Level Security — the client
  never decides who can see what.
- **Plan a session** — at the bottom of the Calendar tab, "Propose a time"
  is a single simple form: a title, a date, a time picked with a slider,
  and (optionally) one of your own templates so friends know the workout
  in advance. Friends just tap "I'm in" — no multi-option poll to manage.
- **Profile** — tap the small circle in the top bar to set the name and
  photo your friends see you as (stored avatar in the `avatars` bucket).
  It's also where your weight unit (kg/lb) and your default rest timer
  live now, under a Settings section.
- **Guided template player** — from the Exercises tab, the ▶ icon on a
  template runs it set-by-set: hit Play, then the checkmark when you're
  done with a weight/reps you can adjust on the spot; it tells you if
  that's a new PR or below your last best, then starts that exercise's
  own rest timer automatically. The pencil icon opens the template
  editor, where you can reorder exercises, add/remove them, and set a
  target sets/reps/weight/rest per exercise for the player to use.
- **Per-exercise rest timer** — each exercise in a template can have its
  own rest duration (set in the template editor); exercises without one
  fall back to the default rest timer from your Profile settings. When
  the countdown hits zero the banner flips color and turns into a
  stopwatch counting up, so you can see exactly how far over rest you've
  gone before starting your next set.

One current limitation worth knowing: a friend's own custom exercises
(ones they added themselves, not from the built-in library) show up in
their workout history with just a name, not a category, since categories
for custom exercises aren't shared across accounts — everything from the
875+ built-in library works normally either way.

## Exercise library

The built-in library (`public/exercises-data.json`) is adapted from the
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) project, an
open, public-domain dataset of exercises with names, categories, equipment,
difficulty level, step-by-step instructions, and two demonstration images per
exercise. Those two images are what the "how it's performed" animation on
each exercise's detail screen crossfades between. It's a static file served
alongside the app (not bundled into the JS) and fetched once at startup.

## Project structure

```
index.html            Entry HTML
src/
  main.js             Boots the app: shows the auth screen or the app
  auth.js             Sign in / sign up screen
  app.js              Main app UI (Train / History / Exercises tabs, guided player)
  friends.js          Friends tab (requests, add by email)
  calendar.js         Calendar tab (visits, day photos/videos, gym-time polls)
  profile.js          Profile sheet (name + avatar)
  player.js           Template editor (targets, reorder) used by app.js's player
  db.js               All Supabase reads/writes
  supabaseClient.js   Supabase client setup
  exercises.js        Built-in exercise library + starter templates
  chart.js            Small SVG progress chart
  utils.js            Formatting/unit-conversion helpers
  style.css           All styling
supabase/
  schema.sql                    Base schema + Row Level Security policies
  migration_2_social.sql        Friends, calendar/day-posts, gym-time polls, storage buckets
  migration_3_plan_template.sql Adds an optional template name to proposed gym sessions
```

## Local development notes

- `npm run build` produces a production build in `dist/`.
- `npm run preview` serves that build locally to sanity-check it.
- There's no build step tied to Supabase — schema changes are applied by
  re-running SQL in the Supabase dashboard.
