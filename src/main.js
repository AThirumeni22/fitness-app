import "./style.css";
import { supabase, configMissing } from "./supabaseClient.js";
import { renderAuthScreen } from "./auth.js";
import { mountApp } from "./app.js";

const root = document.getElementById("app");

if (configMissing) {
  root.innerHTML = `
    <div class="boot-loading err">
      <p><strong>Trainlog isn't configured yet.</strong></p>
      <p>Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase project URL and anon key, then restart the dev server. See the README for the full setup steps.</p>
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
