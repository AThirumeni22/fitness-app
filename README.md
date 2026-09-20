# Trainlog

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
- The built-in exercise library and starter templates (`src/exercises.js`)
  aren't stored in the database at all — they ship with the app for
  everyone. Only exercises/templates someone adds themselves, and their
  finished workouts, are saved to their account.
- The workout you're currently in the middle of (not yet finished) is kept
  in that browser's local storage, not the database, so it survives a
  refresh but doesn't follow you to another device until you hit Finish.

## Project structure

```
index.html            Entry HTML
src/
  main.js             Boots the app: shows the auth screen or the app
  auth.js             Sign in / sign up screen
  app.js              Main app UI (Train / History / Exercises tabs)
  db.js               All Supabase reads/writes
  supabaseClient.js   Supabase client setup
  exercises.js        Built-in exercise library + starter templates
  chart.js            Small SVG progress chart
  utils.js            Formatting/unit-conversion helpers
  style.css           All styling
supabase/
  schema.sql          Database schema + Row Level Security policies
```

## Local development notes

- `npm run build` produces a production build in `dist/`.
- `npm run preview` serves that build locally to sanity-check it.
- There's no build step tied to Supabase — schema changes are applied by
  re-running SQL in the Supabase dashboard.
