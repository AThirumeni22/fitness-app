import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configMissing = !url || !anonKey || url.includes("your-project-ref");

// configError holds a human-readable reason the client couldn't be created
// (e.g. a malformed URL pasted into the env var) so main.js can show it on
// the page instead of leaving a blank "Loading…" screen with only a
// console error to go on.
export let configError = null;
export let supabase = null;

if (!configMissing) {
  try {
    supabase = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  } catch (err) {
    configError = err.message || String(err);
  }
}
