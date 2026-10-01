import { supabase } from "./supabaseClient.js";

// Where the password-reset email sends people back to. The "reset=1" marker
// lets main.js show the "choose a new password" screen instead of the app.
// This URL must be allowed in Supabase: Authentication → URL Configuration →
// Redirect URLs (see README).
export function resetRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?reset=1`;
}

const LABELS = { signin: "Sign in", signup: "Create account", forgot: "Send reset link" };

export function renderAuthScreen(root, initialMode = "signin", initialEmail = "") {
  let mode = initialMode; // "signin" | "signup" | "forgot"
  let rememberedEmail = initialEmail;

  function render() {
    const isForgot = mode === "forgot";
    root.innerHTML = `
      <div class="auth-shell">
        <div class="auth-card">
          <div class="auth-brand">
            <span class="mark">Obonto</span>
            <span class="tag">train with your friends</span>
          </div>
          ${isForgot ? `
            <div class="onb-head">
              <h2>Reset your password</h2>
              <p class="muted">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
            </div>` : `
            <div class="auth-tabs">
              <button type="button" data-mode="signin" class="${mode === "signin" ? "active" : ""}">Sign in</button>
              <button type="button" data-mode="signup" class="${mode === "signup" ? "active" : ""}">Create account</button>
            </div>`}
          <form id="authForm" novalidate>
            <div class="field">
              <label for="authEmail">Email</label>
              <input type="email" id="authEmail" required autocomplete="email" autocapitalize="off" inputmode="email" placeholder="you@example.com" value="${rememberedEmail.replace(/"/g, "&quot;")}">
            </div>
            ${isForgot ? "" : `
            <div class="field">
              <div class="field-top">
                <label for="authPassword">Password</label>
                ${mode === "signin" ? '<button type="button" class="link-btn link-sm" id="forgotBtn">Forgot password?</button>' : ""}
              </div>
              <input type="password" id="authPassword" required autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters" minlength="6">
            </div>`}
            <div id="authMsg" class="auth-msg" hidden></div>
            <button type="submit" class="btn btn-primary btn-block" id="authSubmit">${LABELS[mode]}</button>
          </form>
          ${mode === "signup" ? '<p class="auth-legal">After you sign up we\'ll ask for your name and show you our privacy notice, including how photos are shared with your friends.</p>' : ""}
          <p class="auth-foot">
            ${isForgot ? "Remembered it?" : mode === "signup" ? "Already training with us?" : "New here?"}
            <button type="button" id="authSwitch" class="link-btn">${isForgot ? "Back to sign in" : mode === "signup" ? "Sign in" : "Create an account"}</button>
          </p>
        </div>
      </div>
    `;

    const emailInput = root.querySelector("#authEmail");
    const go = (m) => { rememberedEmail = emailInput.value.trim(); mode = m; render(); };

    root.querySelectorAll(".auth-tabs button").forEach((b) => b.addEventListener("click", () => go(b.getAttribute("data-mode"))));
    root.querySelector("#authSwitch").addEventListener("click", () => go(isForgot || mode === "signup" ? "signin" : "signup"));
    const forgot = root.querySelector("#forgotBtn");
    if (forgot) forgot.addEventListener("click", () => go("forgot"));
    if (isForgot) setTimeout(() => emailInput.focus(), 50);

    root.querySelector("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const msg = root.querySelector("#authMsg");
      const submitBtn = root.querySelector("#authSubmit");
      const show = (kind, text) => { msg.hidden = false; msg.className = `auth-msg ${kind}`; msg.textContent = text; };
      msg.hidden = true;
      if (!email || !emailInput.checkValidity()) { show("err", "Enter a valid email address."); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = "Please wait…";
      try {
        if (mode === "forgot") {
          const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() });
          if (error) throw error;
          // Same message whether or not the account exists, so the form can't
          // be used to check which emails are registered.
          show("ok", `If an Obonto account exists for ${email}, a reset link is on its way. Check your inbox (and spam folder).`);
          submitBtn.disabled = false;
          submitBtn.textContent = "Send again";
          return;
        }
        const password = root.querySelector("#authPassword").value;
        if (mode === "signup") {
          const { error, data } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          if (data.user && !data.session) {
            show("ok", "Check your email to confirm your account, then sign in.");
            submitBtn.disabled = false;
            submitBtn.textContent = LABELS.signup;
            return;
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        // On success, the onAuthStateChange listener in main.js takes over.
      } catch (err) {
        const m = err.message || "Something went wrong. Try again.";
        show("err", /rate limit|too many/i.test(m) ? "Too many attempts — wait a minute and try again." : m);
        submitBtn.disabled = false;
        submitBtn.textContent = LABELS[mode];
      }
    });
  }

  render();
}

// Shown after someone opens the link from the reset email: Supabase has
// signed them in with a short-lived recovery session, and they pick a new
// password here before the app opens.
export function renderNewPasswordScreen(root, onDone) {
  root.innerHTML = `
    <div class="auth-shell">
      <form class="auth-card" id="newPwForm" novalidate>
        <div class="auth-brand">
          <span class="mark">Obonto</span>
          <span class="tag">train with your friends</span>
        </div>
        <div class="onb-head">
          <h2>Choose a new password</h2>
          <p class="muted">Pick something you haven't used here before. You'll stay signed in afterwards.</p>
        </div>
        <div class="field">
          <label for="newPw1">New password</label>
          <input type="password" id="newPw1" autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required>
        </div>
        <div class="field">
          <label for="newPw2">Repeat new password</label>
          <input type="password" id="newPw2" autocomplete="new-password" minlength="6" required>
        </div>
        <div id="newPwMsg" class="auth-msg" hidden></div>
        <button type="submit" class="btn btn-primary btn-block" id="newPwBtn">Save new password</button>
        <p class="auth-foot"><button type="button" class="link-btn" id="newPwCancel">Cancel and sign out</button></p>
      </form>
    </div>`;
  const p1 = root.querySelector("#newPw1"), p2 = root.querySelector("#newPw2");
  const msg = root.querySelector("#newPwMsg"), btn = root.querySelector("#newPwBtn");
  const show = (kind, text) => { msg.hidden = false; msg.className = `auth-msg ${kind}`; msg.textContent = text; };
  setTimeout(() => p1.focus(), 50);
  root.querySelector("#newPwCancel").addEventListener("click", () => supabase.auth.signOut());
  root.querySelector("#newPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.hidden = true;
    if (p1.value.length < 6) { show("err", "Use at least 6 characters."); return; }
    if (p1.value !== p2.value) { show("err", "The two passwords don't match."); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const { error } = await supabase.auth.updateUser({ password: p1.value });
      if (error) throw error;
      onDone();
    } catch (err) {
      const m = err.message || String(err);
      show("err", /session|expired|jwt/i.test(m)
        ? "This reset link has expired. Go back to sign in and request a new one."
        : "Couldn't save that: " + m);
      btn.disabled = false; btn.textContent = "Save new password";
    }
  });
}
