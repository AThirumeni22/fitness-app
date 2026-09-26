import { supabase } from "./supabaseClient.js";

export function renderAuthScreen(root) {
  let mode = "signin"; // or "signup"

  function render() {
    root.innerHTML = `
      <div class="auth-shell">
        <div class="auth-card">
          <div class="auth-brand">
            <span class="mark">SocialGym</span>
            <span class="tag">train with your friends</span>
          </div>
          <div class="auth-tabs">
            <button type="button" data-mode="signin" class="${mode === "signin" ? "active" : ""}">Sign in</button>
            <button type="button" data-mode="signup" class="${mode === "signup" ? "active" : ""}">Create account</button>
          </div>
          <form id="authForm">
            <div class="field">
              <label for="authEmail">Email</label>
              <input type="email" id="authEmail" required autocomplete="email" placeholder="you@example.com">
            </div>
            <div class="field">
              <label for="authPassword">Password</label>
              <input type="password" id="authPassword" required autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters" minlength="6">
            </div>
            <div id="authMsg" class="auth-msg" hidden></div>
            <button type="submit" class="btn btn-primary btn-block" id="authSubmit">
              ${mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
          <p class="auth-foot">
            ${mode === "signup" ? "Already training with us?" : "New here?"}
            <button type="button" id="authSwitch" class="link-btn">${mode === "signup" ? "Sign in" : "Create an account"}</button>
          </p>
        </div>
      </div>
    `;

    root.querySelectorAll(".auth-tabs button").forEach((b) => {
      b.addEventListener("click", () => {
        mode = b.getAttribute("data-mode");
        render();
      });
    });
    root.querySelector("#authSwitch").addEventListener("click", () => {
      mode = mode === "signup" ? "signin" : "signup";
      render();
    });

    root.querySelector("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = root.querySelector("#authEmail").value.trim();
      const password = root.querySelector("#authPassword").value;
      const msg = root.querySelector("#authMsg");
      const submitBtn = root.querySelector("#authSubmit");
      msg.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Please wait…";
      try {
        if (mode === "signup") {
          const { error, data } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          if (data.user && !data.session) {
            msg.hidden = false;
            msg.className = "auth-msg ok";
            msg.textContent = "Check your email to confirm your account, then sign in.";
            submitBtn.disabled = false;
            submitBtn.textContent = "Create account";
            return;
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        // On success, the onAuthStateChange listener in main.js takes over.
      } catch (err) {
        msg.hidden = false;
        msg.className = "auth-msg err";
        msg.textContent = err.message || "Something went wrong. Try again.";
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "signup" ? "Create account" : "Sign in";
      }
    });
  }

  render();
}
