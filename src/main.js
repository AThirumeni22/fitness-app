import "./style.css";
import "./fx.js";
import { supabase, configMissing, configError } from "./supabaseClient.js";
import { renderAuthScreen, renderNewPasswordScreen } from "./auth.js";
import { mountApp } from "./app.js";

const root = document.getElementById("app");

if (configMissing) {
  root.innerHTML = `
    <div class="boot-loading err">
      <p><strong>Obonto isn't configured yet.</strong></p>
      <p>Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase project URL and anon key, then restart the dev server. See the README for the full setup steps.</p>
    </div>`;
} else if (configError) {
  root.innerHTML = `
    <div class="boot-loading err">
      <p><strong>Obonto can't connect to Supabase.</strong></p>
      <p>${configError}</p>
      <p>Double-check <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (in Vercel's Environment Variables, or your local <code>.env</code>) — the URL should look like <code>https://xxxxx.supabase.co</code> with no quotes or trailing slash — then redeploy.</p>
    </div>`;
} else {
  let currentUserId = null;

  // Arriving from a password-reset email: Supabase signs the person in with
  // a recovery session, and they must pick a new password before the app opens.
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  let recovering = url.searchParams.get("reset") === "1" || hash.get("type") === "recovery";
  let recoveryShown = false;
  // onAuthStateChange and getSession() both report "signed out" at startup;
  // render the sign-in screen once so the second doesn't wipe a message.
  let signedOutShown = false;
  const linkError = hash.get("error_description") || url.searchParams.get("error_description");

  function clearAuthParams() {
    url.searchParams.delete("reset");
    url.searchParams.delete("code");
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    history.replaceState(null, "", url.pathname + (url.searchParams.toString() ? "?" + url.searchParams : ""));
  }

  function showSignedOut() {
    if (signedOutShown) return;
    signedOutShown = true;
    if (recovering && linkError) {
      // e.g. the reset link was already used or has expired
      clearAuthParams();
      recovering = false;
      renderAuthScreen(root, "forgot");
      const msg = root.querySelector("#authMsg");
      if (msg) { msg.hidden = false; msg.className = "auth-msg err"; msg.textContent = "That reset link has expired or was already used. Request a new one below."; }
      return;
    }
    renderAuthScreen(root);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (!user) {
      if (event === "SIGNED_OUT") signedOutShown = false;
      currentUserId = null;
      recoveryShown = false;
      showSignedOut();
      return;
    }
    signedOutShown = false;
    if (recovering) {
      if (recoveryShown) return;
      recoveryShown = true;
      renderNewPasswordScreen(root, () => {
        recovering = false;
        recoveryShown = false;
        clearAuthParams();
        currentUserId = user.id;
        mountApp(root, user);
      });
      return;
    }
    // Avoid remounting the whole app on token refreshes for the same user.
    if (user.id === currentUserId) return;
    currentUserId = user.id;
    mountApp(root, user);
  });

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user || null;
    if (!user) showSignedOut();
  });
}
