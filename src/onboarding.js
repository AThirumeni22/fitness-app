// First-run welcome flow: pick the name friends will see, then read and
// accept the privacy notice (GDPR). Shown after sign-in to anyone who has
// no display name yet or hasn't accepted the current notice version, so
// existing users also see the notice once.
//
// ▸ Before going live, fill in APP_OWNER and CONTACT_EMAIL below. Bump
//   PRIVACY_VERSION whenever the notice text changes in a meaningful way:
//   everyone is then asked to accept the new version on their next visit.

import { supabase } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";

export const PRIVACY_VERSION = "2026-10";
const APP_OWNER = "[Your name]";
const CONTACT_EMAIL = "[your contact email]";

const LOCAL_KEY = (uid) => `obonto.privacy.${uid}`;

function privacyAccepted(profile, user) {
  if ("privacy_version" in (profile || {})) return profile.privacy_version === PRIVACY_VERSION;
  // Column missing = migration_5 not run yet: fall back to this device.
  try { return localStorage.getItem(LOCAL_KEY(user.id)) === PRIVACY_VERSION; } catch (e) { return false; }
}

export function needsOnboarding(profile, user) {
  return !(profile && profile.display_name && profile.display_name.trim()) || !privacyAccepted(profile, user);
}

export function privacyNoticeHtml() {
  return `
    <div class="legal">
      <p><strong>Obonto</strong> is a workout log you share with your friends. This notice explains what we keep about you, who can see it and what you can ask us to do with it. It's run by ${escapeHtml(APP_OWNER)} (the "data controller"); contact: <strong>${escapeHtml(CONTACT_EMAIL)}</strong>.</p>

      <div class="callout"><strong>Photos and videos.</strong> Obonto lets you add photos and videos to a calendar day, including pictures of each other at the gym. They are shown in the app <strong>only to you and your accepted friends</strong>, never to other users or the public.</div>

      <h4>What we store</h4>
      <ul>
        <li>Your account: email address and a securely hashed password.</li>
        <li>Your profile: the name and (optional) profile photo friends see.</li>
        <li>Your training: workouts, sets, reps, weights, templates, custom exercises and gym-time plans.</li>
        <li>Photos and videos you choose to post on a calendar day.</li>
        <li>Your friend connections and templates you share or receive.</li>
      </ul>

      <h4>Why, and on what basis</h4>
      <ul>
        <li>To run your account and log your training (needed to provide the app).</li>
        <li>To share your activity, photos and templates with the friends you accept (your consent, which you can withdraw at any time).</li>
      </ul>

      <h4>Who can see it</h4>
      <ul>
        <li><strong>Only friends you've accepted</strong> can see your name, photo, workouts, calendar days, posts and gym-time plans. Removing a friend removes their access.</li>
        <li>Your email is never shown to other users. Someone who already knows it can use it to send you a friend request, which you can decline.</li>
        <li>Uploaded photos and videos are stored as files with long, unguessable links. The app only shows them to your friends, but anyone given an exact link could open it, so please don't pass links on outside the app.</li>
        <li>Our hosting and database provider (Supabase) stores the data on our behalf. We don't sell your data, show ads or use it for anything else.</li>
      </ul>

      <h4>Posting photos of other people</h4>
      <ul>
        <li>Only post photos or videos of people who are okay with it. Anyone who appears in a photo can ask you, or us, to take it down.</li>
        <li>You can delete your own posts at any time.</li>
      </ul>

      <h4>How long we keep it</h4>
      <p>For as long as you have an account. When an account is deleted, its profile, workouts, templates, plans and posts are deleted with it, and uploaded photo/video files are removed on request.</p>

      <h4>Your rights (GDPR)</h4>
      <p>You can ask to see, correct, export or delete your data, object to or limit how it's used, and withdraw your consent at any time by emailing ${escapeHtml(CONTACT_EMAIL)}. You can also complain to a data protection authority. In the Netherlands, that's the Autoriteit Persoonsgegevens.</p>

      <h4>Age</h4>
      <p>Obonto is for people aged 16 and over.</p>

      <p class="faint">Version ${PRIVACY_VERSION}</p>
    </div>`;
}

// Read-only copy of the notice, opened from the Profile sheet.
export function openPrivacySheet({ openSheet, closeSheet }) {
  openSheet(`
    <div class="sheet-title"><h3>Privacy notice</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${privacyNoticeHtml()}
  `);
  document.getElementById("sheetClose").addEventListener("click", closeSheet);
}

export function runOnboarding(root, user, profile, db) {
  return new Promise((resolve) => {
    const hasName = !!(profile.display_name && profile.display_name.trim());
    const steps = hasName ? ["privacy"] : ["name", "privacy"];
    let stepIdx = 0;
    let name = profile.display_name || "";

    function stepsHtml() {
      if (steps.length < 2) return "";
      return `<div class="onb-steps" aria-hidden="true">${steps.map((_, i) => `<span class="${i <= stepIdx ? "on" : ""}"></span>`).join("")}</div>`;
    }

    function draw() {
      const step = steps[stepIdx];
      if (step === "name") {
        root.innerHTML = `
          <div class="onb-shell">
            <form class="onb-card" id="onbForm" novalidate>
              <div class="onb-brand">Obonto</div>
              ${stepsHtml()}
              <div class="onb-head">
                <h2>Welcome! What should friends call you?</h2>
                <p class="muted">This is the name your friends see on workouts, the calendar and shared templates. You can change it later in your profile.</p>
              </div>
              <div class="field">
                <label for="onbName">Your name</label>
                <input type="text" id="onbName" autocomplete="nickname" autocapitalize="words" maxlength="40" placeholder="e.g. Alex" value="${escapeHtml(name)}" required>
              </div>
              <p class="auth-msg err" id="onbMsg" hidden></p>
              <div class="onb-actions">
                <button type="submit" class="btn btn-primary btn-block">Continue</button>
                <button type="button" class="link-btn" id="onbSignOut">Not you? Sign out</button>
              </div>
            </form>
          </div>`;
        const input = root.querySelector("#onbName");
        setTimeout(() => input.focus(), 50);
        root.querySelector("#onbForm").addEventListener("submit", (e) => {
          e.preventDefault();
          const v = input.value.trim().replace(/\s+/g, " ");
          const msg = root.querySelector("#onbMsg");
          if (v.length < 2) { msg.hidden = false; msg.textContent = "Enter at least 2 characters."; return; }
          name = v;
          stepIdx++;
          draw();
        });
      } else {
        root.innerHTML = `
          <div class="onb-shell">
            <form class="onb-card" id="onbForm" novalidate>
              <div class="onb-brand">Obonto</div>
              ${stepsHtml()}
              <div class="onb-head">
                <h2>Your privacy</h2>
                <p class="muted">Please read how Obonto handles your data${hasName ? " — we've updated our notice" : ""}.</p>
              </div>
              ${privacyNoticeHtml()}
              <label class="check-row"><input type="checkbox" id="onbAgree1"> <span>I've read the privacy notice and agree to Obonto processing my data as described.</span></label>
              <label class="check-row"><input type="checkbox" id="onbAgree2"> <span>I understand photos and videos I post are visible to my friends, and I'll only post people who are okay with it.</span></label>
              <p class="auth-msg err" id="onbMsg" hidden></p>
              <div class="onb-actions">
                <button type="submit" class="btn btn-primary btn-block" id="onbAccept" disabled>Agree &amp; start training</button>
                ${steps.length > 1 ? '<button type="button" class="btn btn-secondary btn-block" id="onbBack">Back</button>' : ""}
                <button type="button" class="link-btn" id="onbSignOut">I don't agree — sign out</button>
              </div>
            </form>
          </div>`;
        const a1 = root.querySelector("#onbAgree1"), a2 = root.querySelector("#onbAgree2");
        const btn = root.querySelector("#onbAccept");
        const sync = () => { btn.disabled = !(a1.checked && a2.checked); };
        a1.addEventListener("change", sync); a2.addEventListener("change", sync);
        const back = root.querySelector("#onbBack");
        if (back) back.addEventListener("click", () => { stepIdx--; draw(); });
        root.querySelector("#onbForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!(a1.checked && a2.checked)) return;
          const msg = root.querySelector("#onbMsg");
          msg.hidden = true;
          btn.disabled = true; btn.textContent = "Saving…";
          try {
            try {
              await db.acceptPrivacy(user.id, PRIVACY_VERSION);
            } catch (err) {
              // privacy columns not created yet (migration_5) — remember on this device instead
              if (!/privacy_/.test(err.message || "")) throw err;
              console.warn("Obonto: run supabase/migration_5_onboarding_sharing.sql to store privacy consent server-side.");
            }
            try { localStorage.setItem(LOCAL_KEY(user.id), PRIVACY_VERSION); } catch (e2) {}
            let updated = profile;
            if (!hasName || name !== profile.display_name) {
              const res = await db.updateProfile(user.id, { displayName: name });
              updated = { ...profile, ...res };
            }
            resolve({ ...updated, display_name: name, privacy_version: PRIVACY_VERSION, privacy_accepted_at: new Date().toISOString() });
          } catch (err) {
            msg.hidden = false;
            msg.textContent = "Couldn't save that: " + (err.message || String(err));
            btn.disabled = false; btn.textContent = "Agree & start training";
          }
        });
      }
      root.querySelector("#onbSignOut").addEventListener("click", () => supabase.auth.signOut());
      window.scrollTo(0, 0);
    }

    draw();
  });
}
