import "./style.css";
import { supabase, configMissing, configError } from "./supabaseClient.js";
import { renderAuthScreen } from "./auth.js";
import { mountApp } from "./app.js";

const root = document.getElementById("app");

if (configMissing) {
  root.innerHTML = `
    <div class="boot-loading err">
      <p><strong>Trainlog isn't configured yet.</strong></p>
      <p>Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase project URL and anon key, then restart the dev server. See the README for the full setup steps.</p>
    </div>`;
} else if (configError) {
  root.innerHTML = `
    <div class="boot-loading err">
      <p><strong>Trainlog can't connect to Supabase.</strong></p>
      <p>${configError}</p>
      <p>Double-check <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (in Vercel's Environment Variables, or your local <code>.env</code>) — the URL should look like <code>https://xxxxx.supabase.co</code> with no quotes or trailing slash — then redeploy.</p>
    </div>`;
} else {
  let currentUserId = null;

  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    if (!user) {
      currentUserId = null;
      renderAuthScreen(root);
      return;
    }
    // Avoid remounting the whole app on token refreshes for the same user.
    if (user.id === currentUserId) return;
    currentUserId = user.id;
    mountApp(root, user);
  });

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user || null;
    if (!user) renderAuthScreen(root);
  });
}
