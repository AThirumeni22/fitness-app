import { supabase } from "./supabaseClient.js";
import { DEFAULT_TEMPLATES, CAT_ORDER, fetchExerciseLibrary } from "./exercises.js";
import {
  uid, byId, toKg, fromKg, roundDisp, parseNum, fmtNum,
  fmtDate, fmtShort, fmtDuration, fmtClock, fmtElapsed, escapeHtml
} from "./utils.js";
import { drawChart } from "./chart.js";
import * as db from "./db.js";
import { renderFriends } from "./friends.js";
import { renderCalendar } from "./calendar.js";
import { openProfileSheet } from "./profile.js";
import { openTemplateEditor } from "./player.js";
import { muscleChartHtml } from "./musclechart.js";
import { needsOnboarding, runOnboarding, openPrivacySheet } from "./onboarding.js";
import { mountNotifications, tabFromUrl } from "./notifications.js";
import { pushSupport, isPushEnabled, enablePush, disablePush, syncPushSubscription } from "./push.js";
import { celebrateSet } from "./fx.js";
import { templateSets, buildTarget, exerciseCardHtml, chainHtml, choiceDialog, pickRest, exerciseMenu, openProgression, ICONS } from "./setcards.js";

export async function mountApp(root, user) {
  root.innerHTML = `<div class="boot-loading">Loading your workouts…</div>`;

  let profile, customExercises, templates, history, library;
  try {
    [profile, customExercises, templates, history, library] = await Promise.all([
      db.getProfile(user.id),
      db.listCustomExercises(user.id),
      db.listTemplates(user.id),
      db.listWorkouts(user.id),
      fetchExerciseLibrary()
    ]);
  } catch (err) {
    root.innerHTML = `<div class="boot-loading err"><p>Couldn't load your data: ${escapeHtml(err.message || String(err))}</p><button class="btn btn-secondary" id="retryBtn">Retry</button></div>`;
    root.querySelector("#retryBtn").addEventListener("click", () => mountApp(root, user));
    return;
  }

  // First sign-in (no name yet) or privacy notice not yet accepted: run the
  // welcome flow before showing the app. It resolves once both are saved.
  if (needsOnboarding(profile, user)) {
    profile = await runOnboarding(root, user, profile, db);
  }

  const ACTIVE_KEY = `trainlog.active.${user.id}`;
  let activeDraft = null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) activeDraft = JSON.parse(raw);
  } catch (e) { activeDraft = null; }

  const REST_KEY = `trainlog.restDuration.${user.id}`;
  let savedRestDuration = 90;
  try {
    const v = parseInt(localStorage.getItem(REST_KEY), 10);
    if (v > 0) savedRestDuration = v;
  } catch (e) {}

  const state = {
    unit: profile.unit === "lb" ? "lb" : "kg",
    exercises: library.concat(customExercises),
    templates: DEFAULT_TEMPLATES.concat(templates),
    history,
    active: activeDraft,
    timer: null,
    restDuration: savedRestDuration,
    profile: { displayName: profile.display_name || "", avatarUrl: profile.avatar_url || "" },
    templatePrefs: Object.assign({ pinned: [], hiddenBuiltin: [] }, profile.template_prefs || {}),
    friends: null,
    shares: [],
    pushEnabled: true // assume on until checked, so the "turn on" card doesn't flash
  };

  function saveRestDuration(sec) {
    state.restDuration = sec;
    try { localStorage.setItem(REST_KEY, String(sec)); } catch (e) {}
  }

  // One-time "turn on notifications" card on the home screen.
  const PUSH_CARD_KEY = `obonto.pushCardDismissed.${user.id}`;
  function pushCardDismissed() {
    try { return localStorage.getItem(PUSH_CARD_KEY) === "1"; } catch (e) { return false; }
  }
  function dismissPushCard() {
    try { localStorage.setItem(PUSH_CARD_KEY, "1"); } catch (e) {}
  }
  function onPushChanged(on) {
    state.pushEnabled = on;
    if (currentTab === "train" && !state.active) renderTrain();
  }

  function isPinnedTemplate(id) { return (state.templatePrefs.pinned || []).includes(id); }
  function isHiddenBuiltin(id) { return (state.templatePrefs.hiddenBuiltin || []).includes(id); }

  async function saveTemplatePrefs() {
    try { await db.updateTemplatePrefs(user.id, state.templatePrefs); }
    catch (e) { toast("Couldn't save that — try again"); }
  }

  function togglePinTemplate(id) {
    const pinned = state.templatePrefs.pinned || (state.templatePrefs.pinned = []);
    const i = pinned.indexOf(id);
    if (i > -1) pinned.splice(i, 1); else pinned.push(id);
    saveTemplatePrefs();
    renderCurrentTab();
  }

  function hideBuiltinTemplate(id) {
    const hidden = state.templatePrefs.hiddenBuiltin || (state.templatePrefs.hiddenBuiltin = []);
    if (!hidden.includes(id)) hidden.push(id);
    const pinned = state.templatePrefs.pinned || [];
    const pi = pinned.indexOf(id);
    if (pi > -1) pinned.splice(pi, 1);
    saveTemplatePrefs();
    toast("Hidden — restore anytime from your Profile");
    renderCurrentTab();
  }

  function restoreBuiltinTemplates() {
    state.templatePrefs.hiddenBuiltin = [];
    saveTemplatePrefs();
    toast("Default templates restored");
    renderCurrentTab();
  }

  // Built-ins live in code, so editing one saves a personal copy: hide the
  // original and move its pin to the copy, rather than leaving two
  // "Push Day"s side by side.
  function replaceBuiltinWithCopy(oldT, created) {
    const wasPinned = isPinnedTemplate(oldT.id);
    const hidden = state.templatePrefs.hiddenBuiltin || (state.templatePrefs.hiddenBuiltin = []);
    if (!hidden.includes(oldT.id)) hidden.push(oldT.id);
    const pinned = state.templatePrefs.pinned || (state.templatePrefs.pinned = []);
    const pi = pinned.indexOf(oldT.id);
    if (pi > -1) pinned.splice(pi, 1);
    if (wasPinned) pinned.push(created.id);
    saveTemplatePrefs();
  }

  // Template target weights are saved with the unit they were typed in
  // ({ weight, unit }); older targets have no unit and are taken as-is.
  // Returns the weight in the current display unit, or null if none.
  function targetWeight(tg) {
    if (!tg || tg.weight == null || tg.weight === "" || isNaN(tg.weight)) return null;
    const from = tg.unit === "kg" || tg.unit === "lb" ? tg.unit : state.unit;
    return from === state.unit ? Number(tg.weight) : roundDisp(fromKg(toKg(Number(tg.weight), from), state.unit));
  }

  // The sets from the most recent finished workout that included exId
  // (history is kept newest first).
  function lastSetsFor(exId) {
    for (const sess of state.history) {
      const ex = sess.exercises.find((e) => e.exerciseId === exId);
      if (ex && ex.sets.length) return { date: sess.date, sets: ex.sets };
    }
    return null;
  }

  // Up to `limit` distinct exercises from recent workouts, newest first.
  function recentExerciseIds(exclude = [], limit = 8) {
    const out = [];
    for (const sess of state.history) {
      for (const ex of sess.exercises) {
        if (out.length >= limit) return out;
        if (!out.includes(ex.exerciseId) && !exclude.includes(ex.exerciseId) && byId(state.exercises, ex.exerciseId)) out.push(ex.exerciseId);
      }
    }
    return out;
  }

  // "60×8", or "BW×10" for a bodyweight set logged without a weight.
  function fmtSet(s) {
    return `${s.kg ? fmtNum(fromKg(s.kg, state.unit)) : "BW"}×${s.reps}`;
  }

  // Shared context handed to the friends/calendar/profile/player modules —
  // assigned once every function below exists (see bottom of mountApp).
  // Referencing `ctx` inside a listener attached before that point is safe:
  // the listener only reads it when it actually fires, well after this
  // synchronous setup has finished and `ctx` has been assigned.
  let ctx;

  function saveActiveDraft() {
    try {
      if (state.active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state.active));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
  }

  function exName(id) { const e = byId(state.exercises, id); return e ? e.name : "Exercise"; }
  function exCat(id) { const e = byId(state.exercises, id); return e ? e.cat : ""; }

  // Templates with any hidden built-ins filtered out, pinned ones first
  // (stable otherwise — keeps everyone's existing ordering predictable).
  function visibleTemplates() {
    return state.templates
      .filter((t) => t.isCustom || !isHiddenBuiltin(t.id))
      .slice()
      .sort((a, b) => (isPinnedTemplate(b.id) ? 1 : 0) - (isPinnedTemplate(a.id) ? 1 : 0));
  }

  // Matches on name AND equipment/category, so searching "incline chest press
  // machine" finds entries whose machine-ness only shows up in the equipment
  // field (e.g. "Leverage Incline Chest Press", equipment: "machine").
  function matchesSearch(e, q) {
    if (!q) return true;
    const hay = `${e.name} ${e.equipment || ""} ${e.cat || ""}`.toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((term) => hay.indexOf(term) > -1);
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    clearTimeout(toast._h); clearTimeout(toast._h2);
    t.classList.remove("leaving");
    // replay the entrance when a new message replaces a visible one
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    t.hidden = false;
    toast._h = setTimeout(() => {
      t.classList.add("leaving");
      toast._h2 = setTimeout(() => { t.hidden = true; t.classList.remove("leaving"); }, 220);
    }, 2200);
  }

  function avatarHtml() {
    if (state.profile.avatarUrl) return `<img src="${state.profile.avatarUrl}">`;
    const initial = (state.profile.displayName || user.email || "?").trim().charAt(0).toUpperCase();
    return escapeHtml(initial);
  }
  function refreshTopbar() {
    const a = document.getElementById("topbarAvatar");
    if (a) a.innerHTML = avatarHtml();
  }

  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="mark">Obonto</span>
          <span class="tag" id="dateTag">—</span>
        </div>
        <div class="actions">
          <button class="chip-btn" id="profileBtn" title="Your profile" aria-label="Your profile">
            <span id="topbarAvatar" class="avatar-sm">${avatarHtml()}</span>
          </button>
          <button class="chip-btn" id="signOutBtn" title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
          </button>
        </div>
      </header>

      <main>
        <section id="tab-train" class="tab"></section>
        <section id="tab-history" class="tab" hidden></section>
        <section id="tab-exercises" class="tab" hidden></section>
        <section id="tab-friends" class="tab" hidden></section>
        <section id="tab-calendar" class="tab" hidden></section>
      </main>

      <div class="wbar" id="workoutBar" hidden></div>

      <nav class="tabbar">
        <button data-tab="train" class="active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.5 6.5l11 11M4 9l5-5 2 2-5 5-2-2zm9 9l5-5 2 2-5 5-2-2zM2 21l3-3M18.5 5.5L21 3"/></svg>
          <span>Train</span>
        </button>
        <button data-tab="history">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
          <span>History</span>
        </button>
        <button data-tab="exercises">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
          <span>Exercises</span>
        </button>
        <button data-tab="friends">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          <span>Friends</span>
        </button>
        <button data-tab="calendar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span>Calendar</span>
        </button>
      </nav>

      <div class="sheet" id="sheet" hidden><div class="sheet-inner" id="sheetInner"></div></div>
      <div class="toast" id="toast" hidden></div>
      <div class="dialog" id="dialog" hidden></div>
    </div>
  `;

  // "Are you sure?" pop-up for things that are hard to undo. Resolves true
  // only when the confirm button is pressed (backdrop/Cancel/Escape → false).
  function confirmDialog({ title, message = "", confirmText = "Confirm", cancelText = "Cancel", danger = false }) {
    const dlg = document.getElementById("dialog");
    return new Promise((resolve) => {
      dlg.innerHTML = `
        <div class="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="dialogTitle" aria-describedby="dialogMsg">
          <h3 id="dialogTitle">${escapeHtml(title)}</h3>
          ${message ? `<p class="muted" id="dialogMsg">${escapeHtml(message)}</p>` : ""}
          <div class="dialog-actions">
            <button class="btn btn-secondary" id="dialogCancel">${escapeHtml(cancelText)}</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="dialogOk">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      dlg.hidden = false;
      const done = (val) => {
        dlg.hidden = true;
        dlg.innerHTML = "";
        document.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === "Escape") done(false); };
      document.addEventListener("keydown", onKey);
      dlg.onclick = (e) => { if (e.target === dlg) done(false); };
      document.getElementById("dialogCancel").addEventListener("click", () => done(false));
      document.getElementById("dialogOk").addEventListener("click", () => done(true));
      // Focus the safe choice so an accidental Enter doesn't confirm.
      document.getElementById("dialogCancel").focus();
    });
  }

  document.getElementById("sheet").addEventListener("click", (e) => {
    if (e.target.id === "sheet") closeSheet();
  });
  bindSheetDrag();
  async function setUnit(unit) {
    if (unit === state.unit) return;
    state.unit = unit;
    renderCurrentTab();
    try { await db.setUnit(user.id, state.unit); } catch (e) { toast("Couldn't save unit preference"); }
  }
  document.getElementById("signOutBtn").addEventListener("click", async () => {
    // A shared/borrowed device shouldn't keep getting this person's notifications.
    await disablePush();
    try { supabase.removeAllChannels(); } catch (e) {}
    await supabase.auth.signOut();
  });
  document.getElementById("profileBtn").addEventListener("click", () => openProfileSheet(ctx));
  document.querySelectorAll(".tabbar button").forEach((b) => {
    b.addEventListener("click", () => setTab(b.getAttribute("data-tab")));
  });

  let activeDetailInterval = null;

  // While a sheet is open the page behind it must not move. Plain
  // `overflow:hidden` isn't enough on iOS Safari, so the body is pinned with
  // position:fixed at the current scroll offset and restored on close.
  let lockedScrollY = 0;
  function lockScroll() {
    if (document.body.classList.contains("scroll-locked")) return;
    lockedScrollY = window.scrollY;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add("scroll-locked");
  }
  function unlockScroll() {
    if (!document.body.classList.contains("scroll-locked")) return;
    document.body.classList.remove("scroll-locked");
    document.body.style.top = "";
    window.scrollTo(0, lockedScrollY);
  }

  // A sheet can pass { beforeClose } to intercept every way of closing it
  // (×, backdrop, pull-down): return true to close, false to stay open —
  // e.g. "Discard changes?" in the template editor. Opening a new sheet
  // replaces the guard.
  let sheetGuard = null;
  function openSheet(html, opts = {}) {
    sheetGuard = opts.beforeClose || null;
    if (activeDetailInterval) { clearInterval(activeDetailInterval); activeDetailInterval = null; }
    const sh = document.getElementById("sheet");
    const inner = document.getElementById("sheetInner");
    const wasOpen = !sh.hidden && !sh.classList.contains("closing");
    inner.innerHTML = '<div class="sheet-handle" aria-hidden="true"></div>' + html;
    clearTimeout(closeSheet._h);
    sh.classList.remove("closing");
    inner.style.transform = "";
    // swapping content inside an already-open sheet shouldn't replay the slide-up
    if (wasOpen) inner.style.animation = "none"; else inner.style.animation = "";
    if (!wasOpen) inner.scrollTop = 0;
    sh.hidden = false;
    lockScroll();
  }
  function closeSheet(force) {
    const sh = document.getElementById("sheet");
    if (sh.hidden || sh.classList.contains("closing")) return;
    if (sheetGuard && force !== true) {
      const guard = sheetGuard;
      Promise.resolve(guard()).then((ok) => {
        if (ok) { if (sheetGuard === guard) sheetGuard = null; closeSheet(true); return; }
        // Staying open: undo any half-finished pull-down.
        const inner = document.getElementById("sheetInner");
        if (inner.style.transform) {
          inner.classList.add("snap");
          inner.style.transform = "";
          setTimeout(() => inner.classList.remove("snap"), 300);
        }
      });
      return;
    }
    sheetGuard = null;
    if (activeDetailInterval) { clearInterval(activeDetailInterval); activeDetailInterval = null; }
    // let the sheet slide away before hiding it
    sh.classList.add("closing");
    clearTimeout(closeSheet._h);
    closeSheet._h = setTimeout(() => {
      sh.hidden = true;
      sh.classList.remove("closing");
      document.getElementById("sheetInner").style.transform = "";
      unlockScroll();
    }, 220);
    unlockScrollSoon();
  }
  // Give the page its scroll back right away so a quick tap after closing works.
  function unlockScrollSoon() { requestAnimationFrame(unlockScroll); }

  // Pull the sheet down to dismiss it: from the handle/title anywhere, or
  // from the content once it's scrolled to the top. Uses touch events so
  // the drag can claim the gesture (preventDefault) before the page or the
  // sheet's own content starts scrolling.
  function bindSheetDrag() {
    const inner = document.getElementById("sheetInner");
    let startX = 0, startY = 0, lastY = 0, lastT = 0, vel = 0, dy = 0, dragging = false, armed = false;
    inner.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const t = e.target;
      // Sideways controls (sliders, scrolling chip rows) own their gesture —
      // a little downward drift while using them mustn't drag the sheet.
      if (t.closest && t.closest("[data-nodrag], input[type=range]")) { armed = false; return; }
      const onGrip = !!(t.closest && t.closest(".sheet-handle, .sheet-title")) && !(t.closest && t.closest("button, input, select, textarea"));
      armed = onGrip || inner.scrollTop <= 0;
      if (!armed) return;
      startX = e.touches[0].clientX;
      startY = lastY = e.touches[0].clientY; lastT = performance.now();
      dy = 0; vel = 0; dragging = false;
      inner._onGrip = onGrip;
    }, { passive: true });
    inner.addEventListener("touchmove", (e) => {
      if (!armed) return;
      const y = e.touches[0].clientY;
      const move = y - startY;
      if (!dragging) {
        // Wait for a clear direction; mostly sideways → not a pull-down.
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dx < 7 && Math.abs(move) < 7) return;
        if (dx > Math.abs(move)) { armed = false; return; }
        if (move > 6 && (inner._onGrip || inner.scrollTop <= 0)) {
          dragging = true;
          inner.classList.add("dragging");
        } else if (move < -6 && !inner._onGrip) { armed = false; return; }
        else return;
      }
      e.preventDefault();
      const now = performance.now();
      vel = (y - lastY) / Math.max(1, now - lastT);
      lastY = y; lastT = now;
      dy = Math.max(0, move);
      inner.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    const end = () => {
      if (!dragging) { armed = false; return; }
      dragging = false; armed = false;
      inner.classList.remove("dragging");
      if (dy > Math.min(140, inner.offsetHeight * 0.3) || vel > 0.6) {
        closeSheet();
      } else {
        inner.classList.add("snap");
        inner.style.transform = "";
        setTimeout(() => inner.classList.remove("snap"), 300);
      }
    };
    inner.addEventListener("touchend", end);
    inner.addEventListener("touchcancel", end);
  }

  let currentTab = "train";
  function setTab(tab) {
    currentTab = tab;
    ["train", "history", "exercises", "friends", "calendar"].forEach((t) => { document.getElementById("tab-" + t).hidden = (t !== tab); });
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === tab));
    window.scrollTo(0, 0);
    renderCurrentTab();
    if (tab === "exercises") refreshShares(true);
  }
  function renderCurrentTab() {
    if (currentTab === "train") renderTrain();
    else if (currentTab === "history") renderHistory();
    else if (currentTab === "exercises") renderExercises();
    else if (currentTab === "friends") renderFriends(ctx);
    else if (currentTab === "calendar") renderCalendar(ctx);
    renderBar();
  }

  /* ================= TRAIN ================= */
  // One workout screen for everything: every exercise is a card of sets
  // (pre-filled from the template or from last time). Tap ▶ to start a set,
  // ✓ when it's done — the row turns green and that set's rest counts down.
  // The bar at the bottom always offers the next step.

  function blankSet() { return { kg: null, reps: null, rest: state.restDuration, done: false }; }

  // Drafts from before this screen (guided player / old set table) kept
  // rest on the exercise and had a `guided` flag; bring them up to date.
  function normalizeActive(a) {
    if (!a || !Array.isArray(a.exercises)) return null;
    a.exercises.forEach((ex) => {
      const legacyRest = (ex.target && ex.target.rest) || ex.restSec || null;
      ex.sets = (ex.sets || []).map((s) => ({ kg: s.kg ?? null, reps: s.reps ?? null, rest: s.rest || legacyRest || state.restDuration, done: !!s.done }));
      if (!ex.sets.length) ex.sets.push(blankSet());
      ex.supersetNext = !!ex.supersetNext;
      delete ex.target; delete ex.restSec;
    });
    delete a.guided;
    if (!a.name) { const t = a.templateId && byId(state.templates, a.templateId); a.name = t ? t.name : "Workout"; }
    if (a.current && !setAt(a, a.current)) a.current = null;
    if (a.rest && !setAt(a, a.rest)) a.rest = null;
    return a;
  }
  function setAt(a, ref) { const ex = ref && a.exercises[ref.exi]; return ex ? ex.sets[ref.si] || null : null; }

  // Sets for an exercise added on the fly: last time's (same count and
  // numbers), or one empty set if it's never been logged.
  function prefillSetsFor(exId) {
    const last = lastSetsFor(exId);
    if (!last) return [blankSet()];
    return last.sets.map((s) => ({ kg: s.kg || null, reps: s.reps, rest: state.restDuration, done: false }));
  }

  // Resolves true once the workout has started, false if the person chose
  // to keep the one already in progress.
  async function startWorkout(templateId, firstExerciseId) {
    const cur = state.active;
    if (cur && cur.exercises.some((ex) => ex.sets.some((s) => s.done))) {
      const ok = await confirmDialog({
        title: "Replace your current workout?",
        message: "You have a workout in progress. Starting a new one discards it and everything logged so far.",
        confirmText: "Discard & start new",
        cancelText: "Keep current",
        danger: true
      });
      if (!ok) return false;
    }
    let name = "Workout";
    let exList = firstExerciseId ? [{ exerciseId: firstExerciseId, supersetNext: false, sets: prefillSetsFor(firstExerciseId) }] : [];
    const t = templateId && byId(state.templates, templateId);
    if (t) {
      name = t.name;
      exList = t.exerciseIds.map((id) => {
        const tg = (t.targets && t.targets[id]) || {};
        const last = lastSetsFor(id);
        // Template numbers first; anything the template leaves blank comes from last time.
        const sets = templateSets(tg, state.unit).map((ts, i) => {
          const ls = last && last.sets[Math.min(i, last.sets.length - 1)];
          return {
            kg: ts.weight != null ? (ts.weight ? toKg(ts.weight, state.unit) : null) : (ls && ls.kg ? ls.kg : null),
            reps: ts.reps ?? (ls ? ls.reps : null),
            rest: ts.rest || state.restDuration,
            done: false
          };
        });
        return { exerciseId: id, supersetNext: !!tg.supersetNext, sets };
      });
    }
    state.active = { startedAt: Date.now(), name, templateId: t ? t.id : null, exercises: exList, current: null, rest: null };
    saveActiveDraft();
    renderTrain();
    renderBar();
    toast(t ? `${t.name} started` : "Workout started");
    return true;
  }

  // The order sets are done in: straight through each exercise, except
  // supersets (exercises joined with the chain) go round by round —
  // A1, B1, A2, B2… — with the rest only after each round.
  function setOrder(a) {
    const out = [];
    let i = 0;
    while (i < a.exercises.length) {
      let j = i;
      while (j < a.exercises.length - 1 && a.exercises[j].supersetNext) j++;
      if (j === i) a.exercises[i].sets.forEach((_, si) => out.push({ exi: i, si, group: null }));
      else {
        const rounds = Math.max(...a.exercises.slice(i, j + 1).map((e) => e.sets.length));
        for (let r = 0; r < rounds; r++) for (let k = i; k <= j; k++) if (a.exercises[k].sets[r]) out.push({ exi: k, si: r, group: i });
      }
      i = j + 1;
    }
    return out;
  }
  // The next set still to do after `after` (or from the top), wrapping round
  // to anything skipped earlier.
  function nextSet(a, after) {
    const order = setOrder(a);
    if (!order.length) return null;
    let start = 0;
    if (after) { const p = order.findIndex((o) => o.exi === after.exi && o.si === after.si); if (p > -1) start = p + 1; }
    for (let k = 0; k < order.length; k++) {
      const o = order[(start + k) % order.length];
      if (!a.exercises[o.exi].sets[o.si].done && !(a.current && a.current.exi === o.exi && a.current.si === o.si)) return o;
    }
    return null;
  }

  function startSet(exi, si, scroll) {
    const a = state.active;
    if (!setAt(a, { exi, si })) return;
    a.rest = null;
    a.current = { exi, si, startedAt: Date.now() };
    saveActiveDraft();
    renderTrain();
    renderBar();
    if (scroll) scrollToSet(exi, si);
  }

  function completeSet(exi, si) {
    const a = state.active;
    const ex = a.exercises[exi], s = setAt(a, { exi, si });
    if (!s) return;
    if (s.reps == null || s.reps < 1) {
      toast("Enter your reps first");
      const inp = document.querySelector(`.xcard[data-exi="${exi}"] .xs-reps[data-si="${si}"]`);
      if (inp) inp.focus();
      return;
    }
    const prevBest = bestPr(ex.exerciseId);
    s.done = true;
    a.current = null;
    // In a superset, go straight to the partner's set in this round; rest after the round.
    const order = setOrder(a);
    const me = order.find((o) => o.exi === exi && o.si === si);
    const nx = nextSet(a, { exi, si });
    const sameRound = me && me.group != null && nx && nx.si === si && order.find((o) => o.exi === nx.exi && o.si === nx.si).group === me.group;
    a.rest = !sameRound && s.rest > 0 ? { exi, si, endsAt: Date.now() + s.rest * 1000, duration: s.rest } : null;
    saveActiveDraft();
    if (s.kg && prevBest && s.kg > prevBest) toast(`New PR — ${fmtNum(fromKg(s.kg, state.unit))} ${state.unit}`);
    renderTrain();
    renderBar();
    celebrateSet(document.querySelector(`.xcard[data-exi="${exi}"] .xs-act[data-si="${si}"]`));
  }

  function undoSet(exi, si) {
    const a = state.active, s = setAt(a, { exi, si });
    if (!s) return;
    s.done = false;
    if (a.rest && a.rest.exi === exi && a.rest.si === si) a.rest = null;
    saveActiveDraft();
    renderTrain();
    renderBar();
  }

  function scrollToSet(exi, si) {
    if (currentTab !== "train") return;
    const row = document.querySelector(`.xcard[data-exi="${exi}"] .xs-row[data-si="${si}"]`);
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // Reordering/removing exercises shifts indices; keep the set in progress
  // and the rest countdown pointing at the same set objects.
  function keepRefs(a, mutate) {
    const curSet = setAt(a, a.current), restSet = setAt(a, a.rest);
    mutate();
    const find = (obj) => {
      if (!obj) return null;
      for (let exi = 0; exi < a.exercises.length; exi++) { const si = a.exercises[exi].sets.indexOf(obj); if (si > -1) return { exi, si }; }
      return null;
    };
    const c = find(curSet), r = find(restSet);
    a.current = c ? { ...a.current, ...c } : null;
    a.rest = r ? { ...a.rest, ...r } : null;
    if (a.exercises.length) a.exercises[a.exercises.length - 1].supersetNext = false;
  }

  // After a template-based workout: offer to write today's sets back into
  // the template (per set: weight, reps, rest), plus any superset changes.
  function offerTemplateUpdate(templateId, loggedEx) {
    const t = byId(state.templates, templateId);
    if (!t) return;
    const newTargets = { ...(t.targets || {}) };
    const changes = [];
    const str = (sets) => sets.map((s) => `${s.weight == null ? "–" : s.weight ? fmtNum(s.weight) : "BW"}×${s.reps ?? "?"}`).join(", ");
    loggedEx.forEach((ex) => {
      if (!t.exerciseIds.includes(ex.exerciseId)) return;
      const oldTg = (t.targets || {})[ex.exerciseId] || {};
      const oldSets = templateSets(oldTg, state.unit);
      const newSets = ex.sets.map((s) => ({ weight: s.kg ? roundDisp(fromKg(s.kg, state.unit)) : 0, reps: s.reps, rest: s.rest }));
      const restChanged = oldSets.length === newSets.length && oldSets.some((s, i) => (s.rest || state.restDuration) !== newSets[i].rest);
      const linkChanged = !!oldTg.supersetNext !== !!ex.supersetNext;
      if (str(oldSets) !== str(newSets) || restChanged || linkChanged) {
        changes.push({ name: ex.name, old: str(oldSets), next: str(newSets) });
        newTargets[ex.exerciseId] = buildTarget(newSets, state.unit, ex.supersetNext);
      }
    });
    if (!changes.length) return;

    const rowsHtml = changes.map((c) => `
      <div class="upd-row">
        <div class="upd-name">${escapeHtml(c.name)}</div>
        <div class="upd-vals"><span class="upd-old">${escapeHtml(c.old === c.next ? "rest / superset" : c.old)}</span><span class="upd-arrow">→</span><span class="upd-new">${escapeHtml(c.old === c.next ? "updated" : c.next)}</span></div>
      </div>`).join("");

    openSheet(`
      <div class="sheet-title"><h3>Update template?</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <p class="muted">Save today's sets into <strong>${escapeHtml(t.name)}</strong> so next time starts from here (${state.unit}).${t.isCustom ? "" : " Since it's a default template, this saves your own copy of it."}</p>
      <div class="upd-list">${rowsHtml}</div>
      <button class="btn btn-primary btn-block" id="updTplBtn">Update template</button>
      <button class="btn btn-ghost btn-block" id="skipUpdTplBtn">Keep as is</button>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("skipUpdTplBtn").addEventListener("click", closeSheet);
    document.getElementById("updTplBtn").addEventListener("click", async () => {
      const btn = document.getElementById("updTplBtn");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        if (t.isCustom) {
          const updated = await db.updateTemplate(t.id, t.name, t.exerciseIds, newTargets);
          const idx = state.templates.findIndex((x) => x.id === t.id);
          if (idx > -1) state.templates[idx] = updated;
        } else {
          const created = await db.addTemplate(user.id, t.name, t.exerciseIds, newTargets);
          state.templates.push(created);
          replaceBuiltinWithCopy(t, created);
        }
        closeSheet();
        renderCurrentTab();
        toast("Template updated");
      } catch (err) {
        toast("Couldn't update template: " + (err.message || String(err)));
        btn.disabled = false; btn.textContent = "Update template";
      }
    });
  }

  async function finishWorkout() {
    const a = state.active;
    if (!a) return;
    const hasReps = (s) => s.reps != null && s.reps > 0;
    const unticked = a.exercises.reduce((n, ex) => n + ex.sets.filter((s) => !s.done && hasReps(s)).length, 0);
    let includeUnticked = false;
    if (unticked) {
      const choice = await choiceDialog({
        title: `${unticked} set${unticked === 1 ? "" : "s"} not ticked`,
        message: "They have numbers filled in but weren't marked done. Save them too?",
        choices: [
          { label: "Log them too", value: "all", style: "primary" },
          { label: "Only ticked sets", value: "ticked", style: "secondary" },
          { label: "Keep training", value: "back", style: "secondary" }
        ]
      });
      if (!choice || choice === "back") return;
      includeUnticked = choice === "all";
    }
    // Reps with no weight = bodyweight (0 kg).
    const logged = a.exercises
      .map((ex) => ({
        exerciseId: ex.exerciseId,
        name: exName(ex.exerciseId),
        supersetNext: ex.supersetNext,
        sets: ex.sets.filter((s) => hasReps(s) && (s.done || includeUnticked)).map((s) => ({ kg: s.kg != null ? s.kg : 0, reps: s.reps, rest: s.rest }))
      }))
      .filter((ex) => ex.sets.length > 0);

    if (!logged.length) {
      const ok = await confirmDialog({
        title: "Nothing to save yet",
        message: "No sets are ticked off. Discard this workout?",
        confirmText: "Discard workout",
        cancelText: "Keep training",
        danger: true
      });
      if (ok) discardWorkout();
      return;
    }

    const finishBtn = document.getElementById("finishBtn");
    if (finishBtn) { finishBtn.disabled = true; finishBtn.textContent = "Saving…"; }
    const workout = {
      date: new Date(a.startedAt).toISOString(),
      durationSec: Math.round((Date.now() - a.startedAt) / 1000),
      exercises: logged.map((ex) => ({ exerciseId: ex.exerciseId, name: ex.name, sets: ex.sets.map((s) => ({ kg: s.kg, reps: s.reps })) }))
    };
    try {
      const id = await db.saveWorkout(user.id, workout);
      state.history.unshift({ id: id || uid(), ...workout });
      state.active = null;
      saveActiveDraft();
      renderTrain();
      renderBar();
      toast("Workout saved");
      if (a.templateId) offerTemplateUpdate(a.templateId, logged);
    } catch (err) {
      toast("Couldn't save workout — check your connection and try again");
      if (finishBtn) { finishBtn.disabled = false; finishBtn.textContent = "Finish"; }
    }
  }

  function discardWorkout() {
    state.active = null;
    saveActiveDraft();
    renderTrain();
    renderBar();
    toast("Workout discarded");
  }

  async function workoutMenu() {
    const choice = await choiceDialog({
      title: state.active.name || "Workout",
      choices: [
        { label: "+ Add exercise", value: "add", style: "primary" },
        { label: "Discard workout", value: "discard", style: "danger" },
        { label: "Cancel", value: null, style: "secondary" }
      ]
    });
    if (choice === "add") openAddExerciseSheet();
    if (choice === "discard") {
      const ok = await confirmDialog({ title: "Discard this workout?", message: "Nothing from it will be saved.", confirmText: "Discard", cancelText: "Keep training", danger: true });
      if (ok) discardWorkout();
    }
  }

  async function exerciseCardMenu(exi) {
    const a = state.active, ex = a.exercises[exi];
    const choice = await exerciseMenu(exName(ex.exerciseId), { canUp: exi > 0, canDown: exi < a.exercises.length - 1 });
    if (!choice) return;
    if (choice === "up" || choice === "down") {
      const j = choice === "up" ? exi - 1 : exi + 1;
      keepRefs(a, () => {
        [a.exercises[exi], a.exercises[j]] = [a.exercises[j], a.exercises[exi]];
        // Moving breaks any superset link around the two swapped exercises.
        [Math.min(exi, j) - 1, exi, j].forEach((k) => { if (a.exercises[k]) a.exercises[k].supersetNext = false; });
      });
    } else if (choice === "replace") {
      renderPickerSheet("Replace exercise", (id) => {
        keepRefs(a, () => { ex.exerciseId = id; ex.sets = prefillSetsFor(id); });
        saveActiveDraft(); closeSheet(); renderTrain(); renderBar();
      }, { exclude: a.exercises.map((e) => e.exerciseId) });
      return;
    } else if (choice === "rest") {
      const sec = await pickRest(ex.sets[0] ? ex.sets[0].rest : state.restDuration, "Rest for every set");
      if (sec == null) return;
      ex.sets.forEach((s) => { s.rest = sec; });
    } else if (choice === "remove") {
      if (ex.sets.some((s) => s.done)) {
        const ok = await confirmDialog({ title: `Remove ${exName(ex.exerciseId)}?`, message: "Its ticked sets won't be saved.", confirmText: "Remove", cancelText: "Keep it", danger: true });
        if (!ok) return;
      }
      keepRefs(a, () => {
        if (a.exercises[exi - 1] && !ex.supersetNext) a.exercises[exi - 1].supersetNext = false;
        a.exercises.splice(exi, 1);
      });
    }
    saveActiveDraft(); renderTrain(); renderBar();
  }

  // The workout screen's buttons, handled once on the tab (cards are
  // re-rendered often, so per-button listeners would pile up).
  async function onWorkoutClick(e) {
    const a = state.active;
    const b = e.target.closest("button");
    if (!a || !b) return;
    if (b.id === "finishBtn") return finishWorkout();
    if (b.id === "workoutMenuBtn") return workoutMenu();
    if (b.id === "addExerciseBtn") return openAddExerciseSheet();
    if (b.classList.contains("xchain-btn")) {
      const i = +b.getAttribute("data-exi");
      if (a.exercises[i]) { a.exercises[i].supersetNext = !a.exercises[i].supersetNext; saveActiveDraft(); renderTrain(); renderBar(); }
      return;
    }
    const card = b.closest(".xcard");
    if (!card) return;
    const exi = +card.getAttribute("data-exi"), ex = a.exercises[exi];
    if (!ex) return;
    const si = b.hasAttribute("data-si") ? +b.getAttribute("data-si") : -1;
    const s = si > -1 ? ex.sets[si] : null;

    if (b.classList.contains("xs-act") && s) {
      if (s.done) undoSet(exi, si);
      else if (a.current && a.current.exi === exi && a.current.si === si) completeSet(exi, si);
      else startSet(exi, si);
    } else if (b.classList.contains("xs-restchip") && s) {
      const sec = await pickRest(s.rest, `Rest after set ${si + 1}`);
      if (sec == null) return;
      if (a.rest && a.rest.exi === exi && a.rest.si === si) { a.rest.endsAt += (sec - s.rest) * 1000; a.rest.duration = sec; a.rest.beeped = false; }
      s.rest = sec;
      saveActiveDraft(); renderTrain(); renderBar();
    } else if (b.classList.contains("xs-num") && s) {
      const ok = await confirmDialog({ title: `Delete set ${si + 1}?`, message: `${exName(ex.exerciseId)}${s.done ? " — this set is already ticked" : ""}.`, confirmText: "Delete set", cancelText: "Keep it", danger: true });
      if (!ok) return;
      keepRefs(a, () => { ex.sets.splice(si, 1); if (!ex.sets.length) ex.sets.push(blankSet()); });
      saveActiveDraft(); renderTrain(); renderBar();
    } else if (b.classList.contains("xc-add")) {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push(last ? { kg: last.kg, reps: last.reps, rest: last.rest, done: false } : blankSet());
      saveActiveDraft(); renderTrain(); renderBar();
    } else if (b.classList.contains("xc-rest")) {
      const sec = await pickRest(ex.sets[0] ? ex.sets[0].rest : state.restDuration, "Rest for every set");
      if (sec == null) return;
      ex.sets.forEach((x) => { x.rest = sec; });
      saveActiveDraft(); renderTrain();
    } else if (b.classList.contains("xc-menu")) {
      exerciseCardMenu(exi);
    } else if (b.classList.contains("xc-prog")) {
      openProgression({ history: state.history, unit: state.unit, name: exName(ex.exerciseId) }, ex.exerciseId);
    }
  }

  // Typing a weight/reps updates the draft without re-rendering (keeps focus).
  function onWorkoutInput(e) {
    const a = state.active, inp = e.target;
    if (!a || !inp.matches(".xs-kg, .xs-reps")) return;
    const card = inp.closest(".xcard");
    const s = card && setAt(a, { exi: +card.getAttribute("data-exi"), si: +inp.getAttribute("data-si") });
    if (!s) return;
    if (inp.classList.contains("xs-kg")) {
      const v = parseNum(inp.value);
      s.kg = inp.value.trim() === "" || isNaN(v) ? null : toKg(v, state.unit);
    } else {
      const v = parseInt(inp.value, 10);
      s.reps = isNaN(v) ? null : v;
    }
    saveActiveDraft();
  }

  let mvDays = 30; // home-screen volume chart range: 30 = last 30 days, 0 = all time
  function renderTrain() {
    const el = document.getElementById("tab-train");
    if (!state.active) {
      el.onclick = null; el.oninput = null;
      const pinnedTpl = visibleTemplates().filter((t) => isPinnedTemplate(t.id));
      const pinnedHtml = pinnedTpl.length ? `
        <div class="section-label">Pinned templates</div>
        <div class="pin-list">
        ${pinnedTpl.map((t) => {
          const nSets = t.exerciseIds.reduce((n, id) => n + templateSets((t.targets || {})[id], state.unit).length, 0);
          return `
          <div class="pin-tile">
            <div class="pin-tile-main">
              <h4>${escapeHtml(t.name)}</h4>
              <p class="muted">${t.exerciseIds.length} exercise${t.exerciseIds.length === 1 ? "" : "s"} · ${nSets} sets · ${escapeHtml(t.exerciseIds.slice(0, 2).map(exName).join(", "))}${t.exerciseIds.length > 2 ? "…" : ""}</p>
            </div>
            <button class="btn btn-primary btn-sm pin-start" data-id="${t.id}">Start</button>
          </div>`;
        }).join("")}
        </div>
      ` : "";

      const support = pushSupport();
      const pushCardHtml = !state.pushEnabled && !pushCardDismissed() && (support === "ok" || support === "ios-install-needed") ? `
        <div class="card notice-card">
          <div class="notice-head">
            <span class="notif-icon plan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg></span>
            <div>
              <h4>Don't miss a session</h4>
              <p class="muted">${support === "ios-install-needed"
                ? "On iPhone, tap Share → <strong>Add to Home Screen</strong>, then open Obonto from your home screen to turn on notifications."
                : "Get notified when friends propose a time, reply, or send you a friend request."}</p>
            </div>
          </div>
          <div class="row">
            ${support === "ok" ? `<button class="btn btn-primary btn-sm" id="pushCardOn">Turn on</button>` : ""}
            <button class="btn btn-secondary btn-sm" id="pushCardDismiss">Not now</button>
          </div>
        </div>` : "";

      el.innerHTML = `
        <div class="card start-card">
          <h2>Ready to train?</h2>
          <p class="muted">Start a blank session, or start one of your templates — pinned ones show up right here.</p>
          <button class="btn btn-primary btn-block" id="startEmptyBtn">Start Empty Workout</button>
        </div>
        ${pushCardHtml}
        ${pinnedHtml}
        <div class="section-label">Muscles hit</div>
        ${muscleChartHtml({ history: state.history, exCat, fromKg, unit: state.unit, days: mvDays })}
        <div class="section-label">Jump to</div>
        <div class="home-tiles">
          <button class="home-tile" id="homeFriendsTile">
            <span class="ht-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></span>
            <span class="ht-label">Friends</span>
            <span class="ht-sub">See who's training</span>
          </button>
          <button class="home-tile" id="homeCalendarTile">
            <span class="ht-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
            <span class="ht-label">Calendar</span>
            <span class="ht-sub">Plan a session</span>
          </button>
          <button class="home-tile" id="homeProfileTile">
            <span class="ht-icon avatar-md">${avatarHtml()}</span>
            <span class="ht-label">Profile</span>
            <span class="ht-sub">Name, photo, settings</span>
          </button>
        </div>
      `;
      document.getElementById("startEmptyBtn").addEventListener("click", () => startWorkout(null));
      const pushOn = document.getElementById("pushCardOn");
      if (pushOn) pushOn.addEventListener("click", async () => {
        pushOn.disabled = true;
        try { await enablePush(); toast("Notifications on"); onPushChanged(true); }
        catch (err) {
          pushOn.disabled = false;
          toast(err.message === "denied" ? "Notifications are blocked — allow them in your browser settings" : "Couldn't turn on notifications");
          if (err.message === "denied") renderTrain();
        }
      });
      const pushDismiss = document.getElementById("pushCardDismiss");
      if (pushDismiss) pushDismiss.addEventListener("click", () => { dismissPushCard(); renderTrain(); });
      document.getElementById("homeFriendsTile").addEventListener("click", () => setTab("friends"));
      document.getElementById("homeCalendarTile").addEventListener("click", () => setTab("calendar"));
      document.getElementById("homeProfileTile").addEventListener("click", () => openProfileSheet(ctx));
      el.querySelectorAll("[data-mv-days]").forEach((b) => b.addEventListener("click", () => {
        mvDays = parseInt(b.getAttribute("data-mv-days"), 10);
        renderTrain();
      }));
      el.querySelectorAll(".pin-start").forEach((b) => b.addEventListener("click", () => startWorkout(b.getAttribute("data-id"))));
      return;
    }

    const a = state.active;
    const n = a.exercises.length;
    const cards = a.exercises.map((ex, exi) => {
      const lib = byId(state.exercises, ex.exerciseId) || { name: exName(ex.exerciseId) };
      const last = lastSetsFor(ex.exerciseId);
      const card = exerciseCardHtml({
        mode: "log", index: exi, ex: lib, unit: state.unit,
        sets: ex.sets.map((s) => ({ w: s.kg != null ? fmtNum(fromKg(s.kg, state.unit)) : "", reps: s.reps, rest: s.rest, done: s.done })),
        placeholders: ex.sets.map((s, si) => {
          const ls = last && last.sets[si];
          return ls ? { w: ls.kg ? fmtNum(fromKg(ls.kg, state.unit)) : "BW", reps: String(ls.reps) } : {};
        }),
        current: a.current && a.current.exi === exi ? a.current.si : -1,
        restSi: a.rest && a.rest.exi === exi ? a.rest.si : -1,
        linkedPrev: exi > 0 && a.exercises[exi - 1].supersetNext,
        linkedNext: ex.supersetNext && exi < n - 1
      });
      return card + (exi < n - 1 ? chainHtml(exi, ex.supersetNext) : "");
    }).join("");

    el.innerHTML = `
      <div class="w-head">
        <div class="w-title"><div class="elapsed num" id="activeElapsed">00:00</div><div class="w-name">${escapeHtml(a.name || "Workout")}</div></div>
        <button class="btn btn-sm w-finish" id="finishBtn">Finish</button>
        <button class="xc-icon w-more" id="workoutMenuBtn" aria-label="Workout options">${ICONS.dots}</button>
      </div>
      ${n ? `<div class="xlist">${cards}</div>` : '<div class="card"><p class="muted">No exercises yet — add your first one.</p></div>'}
      <button class="btn btn-secondary btn-block" id="addExerciseBtn">+ Add Exercise</button>
      <div class="wbar-spacer" aria-hidden="true"></div>
    `;
    el.onclick = onWorkoutClick;
    el.oninput = onWorkoutInput;
    tickWorkout();
  }

  function openAddExerciseSheet() {
    renderPickerSheet("Add Exercise", (exId) => {
      state.active.exercises.push({ exerciseId: exId, supersetNext: false, sets: prefillSetsFor(exId) });
      saveActiveDraft();
      closeSheet();
      renderTrain();
      renderBar();
    }, { exclude: state.active.exercises.map((e) => e.exerciseId) });
  }

  // opts.onClose: called instead of closing when the picker is dismissed
  // (the template editor uses it to come back with its edits intact).
  // opts.exclude: exercise ids to leave out of the "Recent" list.
  function renderPickerSheet(title, onPick, opts = {}) {
    let activeCat = null;
    const MAX_RESULTS = 150;
    const recent = recentExerciseIds(opts.exclude || []);

    function draw(filterRaw) {
      const q = (filterRaw || "").trim().toLowerCase();
      const chips = CAT_ORDER.map((c) => `<button class="cat-chip ${c === activeCat ? "active" : ""}" data-cat="${c}">${escapeHtml(c)}</button>`).join("");

      if (!q && !activeCat) {
        const recentHtml = recent.length ? `
          <div class="section-label">Recent</div>
          <div class="pick-list">${recent.map((id) => {
            const e = byId(state.exercises, id);
            return `<div class="pick-row" data-id="${id}"><span>${escapeHtml(e.name)}</span><span class="pick-eq">${escapeHtml(e.cat || "")}</span></div>`;
          }).join("")}</div>` : "";
        return `<div class="stack"><div class="cat-chip-row">${chips}</div>${recentHtml}<p class="pick-note">Search by name, or pick a category to browse.</p></div>`;
      }

      const pool = activeCat ? state.exercises.filter((e) => e.cat === activeCat) : state.exercises;
      const matches = q ? pool.filter((e) => matchesSearch(e, q)) : pool;
      const shown = matches.slice(0, MAX_RESULTS);
      let rowsHtml = shown.map((e) => `<div class="pick-row" data-id="${e.id}"><span>${escapeHtml(e.name)}</span><span class="pick-eq">${escapeHtml(e.equipment || "")}</span></div>`).join("");
      if (!shown.length) rowsHtml = `<p class="pick-note">No matches.</p>`;
      const moreNote = matches.length > MAX_RESULTS
        ? `<p class="pick-note">Showing ${MAX_RESULTS} of ${matches.length} — keep typing to narrow it down.</p>`
        : "";
      return `<div class="stack"><div class="cat-chip-row">${chips}</div><div class="pick-list">${rowsHtml}</div>${moreNote}</div>`;
    }

    openSheet(`
      <div class="sheet-title"><h3>${title}</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><input type="search" id="pickerSearch" placeholder="Search exercises…" autocomplete="off" enterkeyhint="search" aria-label="Search exercises"></div>
      <div id="pickerBody">${draw("")}</div>
    `, opts.onClose ? { beforeClose: () => { opts.onClose(); return false; } } : {});

    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    function bindAll() {
      document.querySelectorAll("#pickerBody .pick-row").forEach((r) => r.addEventListener("click", () => onPick(r.getAttribute("data-id"))));
      document.querySelectorAll("#pickerBody .cat-chip").forEach((b) => b.addEventListener("click", () => {
        activeCat = activeCat === b.getAttribute("data-cat") ? null : b.getAttribute("data-cat");
        document.getElementById("pickerBody").innerHTML = draw(document.getElementById("pickerSearch").value);
        bindAll();
      }));
    }
    bindAll();
    document.getElementById("pickerSearch").addEventListener("input", (e) => {
      document.getElementById("pickerBody").innerHTML = draw(e.target.value);
      bindAll();
    });
  }

  /* ================= WORKOUT BAR (set timer + rest countdown) ================= */
  let audioCtx = null;
  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      [0, 0.18, 0.36].forEach((off) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine"; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t0 + off);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.15);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0 + off); osc.stop(t0 + off + 0.16);
      });
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  }

  // Updates only text each tick — rebuilding the buttons 4× a second made
  // taps get lost on phones.
  let workoutTick = null;
  function tickWorkout() {
    const a = state.active;
    if (!a) return;
    const el = document.getElementById("activeElapsed");
    if (el) el.textContent = fmtElapsed((Date.now() - a.startedAt) / 1000);
    const bar = document.getElementById("workoutBar");
    const timeEl = bar && bar.querySelector(".wb-time");
    if (a.current) {
      if (timeEl) timeEl.textContent = fmtClock((Date.now() - a.current.startedAt) / 1000);
    } else if (a.rest) {
      const remain = (a.rest.endsAt - Date.now()) / 1000;
      const over = remain <= 0;
      if (over && !a.rest.beeped) { a.rest.beeped = true; saveActiveDraft(); beep(); }
      const txt = over ? `+${fmtClock(-remain)}` : fmtClock(Math.ceil(remain));
      if (timeEl && timeEl.textContent !== txt) timeEl.textContent = txt;
      if (bar) {
        bar.classList.toggle("over", over);
        const fill = bar.querySelector(".wb-progress > i");
        if (fill) fill.style.transform = `scaleX(${over ? 1 : Math.max(0, Math.min(1, 1 - remain / a.rest.duration))})`;
        const tag = bar.querySelector(".wb-tag");
        if (tag) tag.textContent = over ? "Rest over" : "Rest";
      }
      const chip = document.querySelector(".xs-restchip.running");
      if (chip && chip.textContent !== txt) chip.textContent = txt;
    }
  }

  function renderBar() {
    const bar = document.getElementById("workoutBar");
    if (!bar) return;
    const a = state.active;
    if (!a || !a.exercises.length) {
      bar.hidden = true; bar.innerHTML = ""; bar.className = "wbar";
      document.body.classList.remove("has-wbar");
      if (!a && workoutTick) { clearInterval(workoutTick); workoutTick = null; }
      if (a && !workoutTick) workoutTick = setInterval(tickWorkout, 250);
      return;
    }
    const nx = nextSet(a, a.rest || null);
    const nm = (ref) => escapeHtml(exName(a.exercises[ref.exi].exerciseId));
    let mode, label, sub, big, bigLabel;
    if (a.current) {
      mode = "set"; label = nm(a.current); sub = `Set ${a.current.si + 1}`; big = "check"; bigLabel = "Finish this set";
    } else if (a.rest) {
      mode = "rest"; label = nx ? `Next: ${nm(nx)}` : "Last set done"; sub = nx ? `Set ${nx.si + 1}` : ""; big = nx ? "play" : "check"; bigLabel = nx ? "Start the next set" : "Finish workout";
    } else if (nx) {
      mode = "idle"; label = `Next: ${nm(nx)}`; sub = `Set ${nx.si + 1}`; big = "play"; bigLabel = "Start the next set";
    } else {
      mode = "done"; label = "All sets done"; sub = "Tap ✓ to finish"; big = "check"; bigLabel = "Finish workout";
    }
    bar.className = `wbar ${mode}`;
    bar.innerHTML = `
      ${mode === "rest" ? '<div class="wb-progress" aria-hidden="true"><i></i></div>' : ""}
      <button type="button" class="wb-info" aria-label="Go to your workout">
        <span class="wb-label">${mode === "rest" ? '<span class="wb-tag">Rest</span>' : mode === "set" ? '<span class="wb-dot" aria-hidden="true"></span>' : ""}${label}</span>
        <span class="wb-row"><span class="wb-time num">${mode === "idle" || mode === "done" ? "" : "00:00"}</span><span class="wb-sub">${sub}</span></span>
      </button>
      ${mode === "rest" ? '<div class="wb-adj"><button type="button" data-adj="-15" aria-label="15 seconds less rest">−15</button><button type="button" data-adj="15" aria-label="15 seconds more rest">+15</button></div>' : ""}
      <button type="button" class="wb-big ${big}" aria-label="${bigLabel}">${big === "play" ? ICONS.play : ICONS.check}</button>`;
    bar.hidden = false;
    document.body.classList.add("has-wbar");
    bar.querySelector(".wb-info").addEventListener("click", () => { if (currentTab !== "train") setTab("train"); else if (a.current || nx) scrollToSet((a.current || nx).exi, (a.current || nx).si); });
    bar.querySelectorAll("[data-adj]").forEach((b) => b.addEventListener("click", () => {
      if (!a.rest) return;
      const d = +b.getAttribute("data-adj");
      a.rest.endsAt = Math.max(Date.now(), a.rest.endsAt + d * 1000);
      a.rest.duration = Math.max(1, a.rest.duration + d);
      if (a.rest.endsAt > Date.now()) a.rest.beeped = false;
      saveActiveDraft();
      tickWorkout();
    }));
    bar.querySelector(".wb-big").addEventListener("click", () => {
      if (mode === "set") completeSet(a.current.exi, a.current.si);
      else if ((mode === "rest" || mode === "idle") && nx) startSet(nx.exi, nx.si, true);
      else finishWorkout();
    });
    tickWorkout();
    if (!workoutTick) workoutTick = setInterval(tickWorkout, 250);
  }

  /* ================= HISTORY ================= */
  let chartExId = null, chartMetric = "weight";

  function computeStats() {
    let totalVolKg = 0;
    state.history.forEach((sess) => sess.exercises.forEach((ex) => ex.sets.forEach((s) => { totalVolKg += (s.kg || 0) * (s.reps || 0); })));
    const avgDur = state.history.length ? state.history.reduce((a, s) => a + s.durationSec, 0) / state.history.length : 0;
    return { count: state.history.length, totalVol: totalVolKg, avgDur };
  }

  function exercisesWithHistory() {
    const seen = {}, list = [];
    state.history.forEach((sess) => sess.exercises.forEach((ex) => { if (!seen[ex.exerciseId]) { seen[ex.exerciseId] = true; list.push(ex.exerciseId); } }));
    list.sort((a, b) => exName(a).localeCompare(exName(b)));
    return list;
  }

  function seriesFor(exId, metric) {
    const pts = [];
    const sorted = state.history.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((sess) => sess.exercises.forEach((ex) => {
      if (ex.exerciseId !== exId) return;
      const val = metric === "weight"
        ? ex.sets.reduce((m, s) => Math.max(m, s.kg || 0), 0)
        : ex.sets.reduce((sum, s) => sum + (s.kg || 0) * (s.reps || 0), 0);
      pts.push({ date: sess.date, value: val });
    }));
    return pts;
  }

  function renderHistory() {
    const el = document.getElementById("tab-history");
    const stats = computeStats();
    const exWithHist = exercisesWithHistory();
    if (!chartExId || exWithHist.indexOf(chartExId) === -1) chartExId = exWithHist[0] || null;

    const statHtml = `
      <div class="stat-row">
        <div class="stat-tile"><span class="v">${stats.count}</span><span class="l">Workouts</span></div>
        <div class="stat-tile"><span class="v">${Math.round(fromKg(stats.totalVol, state.unit)).toLocaleString()}</span><span class="l">Total ${state.unit} lifted</span></div>
        <div class="stat-tile"><span class="v">${stats.count ? fmtDuration(stats.avgDur) : "—"}</span><span class="l">Avg length</span></div>
      </div>`;

    let chartHtml;
    if (!exWithHist.length) {
      chartHtml = '<div class="card empty-state"><svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg><p>Log a few workouts to start seeing progress charts here.</p></div>';
    } else {
      const opts = exWithHist.map((id) => `<option value="${id}"${id === chartExId ? " selected" : ""}>${escapeHtml(exName(id))}</option>`).join("");
      chartHtml = `
        <div class="card chart-card">
          <select id="chartExSelect">${opts}</select>
          <div class="metric-toggle">
            <button data-m="weight" class="${chartMetric === "weight" ? "active" : ""}">Best Set (${state.unit})</button>
            <button data-m="volume" class="${chartMetric === "volume" ? "active" : ""}">Total Volume</button>
          </div>
          <div class="chart-wrap" id="chartWrap"></div>
        </div>`;
    }

    let sessHtml;
    if (!state.history.length) {
      sessHtml = '<div class="card empty-state"><svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>No workouts yet — finish your first session and it will show up here.</p></div>';
    } else {
      sessHtml = state.history.map((sess) => {
        const vol = sess.exercises.reduce((sum, ex) => sum + ex.sets.reduce((s2, s) => s2 + (s.kg || 0) * (s.reps || 0), 0), 0);
        const exDetail = sess.exercises.map((ex) => {
          const setsStr = ex.sets.map(fmtSet).join("  ");
          const weighted = ex.sets.some((s) => s.kg);
          return `<div class="session-ex"><div class="exn">${escapeHtml(ex.name)}</div><div class="exs">${setsStr}${weighted ? ` ${state.unit}` : ""}</div></div>`;
        }).join("") + `<div class="session-actions"><button class="btn btn-danger btn-sm del-workout" data-id="${sess.id}">Delete workout</button></div>`;
        return `
          <div class="session-card" data-id="${sess.id}">
            <div class="session-head">
              <div><div class="sdate">${fmtDate(sess.date)}</div>
              <div class="smeta">${sess.exercises.length} exercises · ${fmtDuration(sess.durationSec)} · ${Math.round(fromKg(vol, state.unit)).toLocaleString()} ${state.unit}</div></div>
              <svg class="schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="session-body">${exDetail}</div>
          </div>`;
      }).join("");
    }

    el.innerHTML = statHtml + chartHtml + '<div class="section-label">History</div>' + (state.history.length ? `<div class="session-list">${sessHtml}</div>` : sessHtml);

    if (exWithHist.length) {
      document.getElementById("chartExSelect").addEventListener("change", (e) => { chartExId = e.target.value; renderHistory(); });
      el.querySelectorAll(".metric-toggle button").forEach((b) => b.addEventListener("click", () => { chartMetric = b.getAttribute("data-m"); renderHistory(); }));
      drawChart(document.getElementById("chartWrap"), seriesFor(chartExId, chartMetric), chartMetric, state.unit);
    }

    el.querySelectorAll(".session-card").forEach((card) => card.querySelector(".session-head").addEventListener("click", () => card.classList.toggle("open")));
    el.querySelectorAll(".del-workout").forEach((b) => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      const sess = state.history.find((s) => s.id === id);
      if (!sess) return;
      const ok = await confirmDialog({
        title: "Delete this workout?",
        message: `${fmtDate(sess.date)} · ${sess.exercises.length} exercise${sess.exercises.length === 1 ? "" : "s"}. This can't be undone, and it also disappears from your friends' feed and calendar.`,
        confirmText: "Delete workout",
        cancelText: "Keep it",
        danger: true
      });
      if (!ok) return;
      b.disabled = true; b.textContent = "Deleting…";
      try {
        await db.deleteWorkout(id);
        state.history = state.history.filter((s) => s.id !== id);
        renderHistory();
        toast("Workout deleted");
      } catch (err) {
        toast(err.message === "not-deleted"
          ? "Deleting needs a quick setup step — run migration_7 in Supabase (see README)"
          : "Couldn't delete that: " + (err.message || String(err)));
        b.disabled = false; b.textContent = "Delete workout";
      }
    }));
  }

  /* ================= EXERCISES ================= */
  let exSearch = "";
  let exEquipment = null;

  const EQUIPMENT_GROUPS = [
    { key: "body only", label: "Bodyweight" },
    { key: "barbell", label: "Barbell" },
    { key: "dumbbell", label: "Dumbbell" },
    { key: "cable", label: "Cable" },
    { key: "machine", label: "Machine" },
    { key: "kettlebells", label: "Kettlebell" },
    { key: "bands", label: "Bands" }
  ];

  function bestPr(exId) {
    let best = 0;
    state.history.forEach((sess) => sess.exercises.forEach((ex) => { if (ex.exerciseId === exId) ex.sets.forEach((s) => { if ((s.kg || 0) > best) best = s.kg; }); }));
    return best;
  }

  const ICON = {
    star: (on) => `<svg viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 2l2.9 6.5L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-.8L12 2z"/></svg>`,
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l14 8-14 8V4z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-10-8-10-8a18.5 18.5 0 015.06-5.94M9.9 4.24A10.4 10.4 0 0112 4c7 0 10 8 10 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>',
    chev: '<svg class="chev-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function templateCardHtml(t) {
    const pinned = isPinnedTemplate(t.id);
    return `
      <div class="tpl-list-card tpl" data-id="${t.id}">
        <div class="tpl-top">
          <div class="info">
            <h4>${escapeHtml(t.name)}</h4>
            <p>${t.exerciseIds.length ? `${t.exerciseIds.length} exercise${t.exerciseIds.length === 1 ? "" : "s"}, ${t.exerciseIds.reduce((n, id) => n + templateSets((t.targets || {})[id], state.unit).length, 0)} sets · ` : ""}${escapeHtml(t.exerciseIds.map(exName).join(", ") || "No exercises yet")}</p>
          </div>
          <button class="icon-btn sm pin-tpl ${pinned ? "pinned" : ""}" data-id="${t.id}" title="${pinned ? "Unpin" : "Pin to home screen"}" aria-label="${pinned ? "Unpin template" : "Pin template to home screen"}">${ICON.star(pinned)}</button>
          <button class="icon-btn sm share-tpl" data-id="${t.id}" title="Share with friends" aria-label="Share template with friends">${ICON.share}</button>
        </div>
        <div class="tpl-actions">
          <button class="btn btn-primary btn-sm start-tpl2" data-id="${t.id}">${ICON.play}Start</button>
          <button class="icon-btn sm edit-tpl" data-id="${t.id}" title="Edit" aria-label="Edit template">${ICON.edit}</button>
          ${t.isCustom
            ? `<button class="icon-btn sm del-tpl" data-id="${t.id}" title="Delete template" aria-label="Delete template">${ICON.x}</button>`
            : `<button class="icon-btn sm hide-tpl" data-id="${t.id}" title="Hide this default template" aria-label="Hide this default template">${ICON.eyeOff}</button>`}
        </div>
      </div>`;
  }

  function shareCardHtml(sh) {
    const n = (sh.exerciseIds || []).length;
    return `
      <div class="share-card" data-id="${sh.id}">
        <div class="info">
          <span class="tpl-badge">${ICON.share.replace("<svg", '<svg width="12" height="12"')}From ${escapeHtml(sh.senderName)}</span>
          <h4>${escapeHtml(sh.name)}</h4>
          <p>${n} exercise${n === 1 ? "" : "s"} · ${escapeHtml(sh.exerciseIds.slice(0, 3).map((id) => (sh.exerciseMeta[id] && sh.exerciseMeta[id].name) || exName(id)).join(", "))}${n > 3 ? ` +${n - 3} more` : ""}</p>
        </div>
        <div class="row">
          <button class="btn btn-primary btn-sm accept-share" data-id="${sh.id}">Add &amp; customise</button>
          <button class="btn btn-secondary btn-sm decline-share" data-id="${sh.id}">Decline</button>
        </div>
      </div>`;
  }

  // Library groups render their rows only when opened (or while searching):
  // 875+ rows rebuilt on every keystroke was what made typing lag on phones.
  const LIB_SEARCH_LIMIT = 60;
  function libraryRowsHtml(items) {
    return items.map((e) => {
      const pr = bestPr(e.id);
      return `
        <div class="ex-row" data-id="${e.id}">
          <div class="info"><div class="nm">${escapeHtml(e.name)}</div>
          <div class="pr">${pr > 0 ? `PR ${fmtNum(fromKg(pr, state.unit))} ${state.unit}` : escapeHtml(e.equipment || "")}</div></div>
          ${e.isCustom
            ? `<button class="icon-btn sm del-ex" data-id="${e.id}" title="Delete" aria-label="Delete exercise">${ICON.x}</button>`
            : ICON.chev}
        </div>`;
    }).join("");
  }

  function libraryItemsFor(cat) {
    const q = exSearch.trim().toLowerCase();
    let items = state.exercises.filter((e) => e.cat === cat);
    if (exEquipment) items = items.filter((e) => (e.equipment || "other") === exEquipment);
    if (q) items = items.filter((e) => matchesSearch(e, q));
    return items;
  }

  function renderLibrary() {
    const box = document.getElementById("exLibrary");
    if (!box) return;
    const searching = exSearch.trim().length > 0 || !!exEquipment;
    const groups = CAT_ORDER.map((cat) => {
      const items = libraryItemsFor(cat);
      if (!items.length) return "";
      const shown = searching ? items.slice(0, LIB_SEARCH_LIMIT) : [];
      const more = searching && items.length > shown.length ? `<div class="lib-more">Showing ${shown.length} of ${items.length} — keep typing to narrow it down.</div>` : "";
      return `<details class="cat-group" data-cat="${escapeHtml(cat)}" ${searching ? "open" : ""}><summary>${escapeHtml(cat)} <span class="count">${items.length}</span></summary>${searching ? libraryRowsHtml(shown) + more : ""}</details>`;
    }).join("");
    box.innerHTML = groups || `<p class="muted">No exercises match "${escapeHtml(exSearch)}".</p>`;
    box.querySelectorAll("details.cat-group").forEach((d) => d.addEventListener("toggle", () => {
      if (d.open && !d.querySelector(".ex-row")) {
        d.insertAdjacentHTML("beforeend", libraryRowsHtml(libraryItemsFor(d.getAttribute("data-cat"))));
      }
    }));
  }

  function renderExercises() {
    const el = document.getElementById("tab-exercises");
    const visibleTpl = visibleTemplates();
    const tplHtml = visibleTpl.length
      ? `<div class="tpl-list">${visibleTpl.map(templateCardHtml).join("")}</div>`
      : '<div class="card"><p class="muted">No templates yet — tap New to build one.</p></div>';
    const sharesHtml = state.shares.length ? `
      <div class="section-label">Shared with you <span class="count">${state.shares.length}</span></div>
      <div class="stack-sm">${state.shares.map(shareCardHtml).join("")}</div>` : "";
    const eqChipsHtml = EQUIPMENT_GROUPS.map((g) => `<button class="cat-chip ${exEquipment === g.key ? "active" : ""}" data-eq="${g.key}">${escapeHtml(g.label)}</button>`).join("");

    el.innerHTML = `
      ${sharesHtml}
      <div class="page-head"><h2>Templates</h2><button class="btn btn-secondary btn-sm" id="newTplBtn">+ New</button></div>
      ${tplHtml}
      <div class="page-head"><h2>Library</h2><button class="btn btn-secondary btn-sm" id="newExBtn">+ Add custom</button></div>
      <input type="search" class="search-input" id="exSearchInput" placeholder="Search 875+ exercises…" value="${escapeHtml(exSearch)}" autocomplete="off" enterkeyhint="search">
      <div class="cat-chip-row" id="eqChips">${eqChipsHtml}</div>
      <div class="lib-groups" id="exLibrary"></div>
    `;
    renderLibrary();

    document.getElementById("newTplBtn").addEventListener("click", () => openTemplateEditor(ctx, null));
    document.getElementById("newExBtn").addEventListener("click", openCustomExerciseForm);
    let searchT = null;
    document.getElementById("exSearchInput").addEventListener("input", (e) => {
      exSearch = e.target.value;
      clearTimeout(searchT);
      searchT = setTimeout(renderLibrary, 120);
    });
    el.querySelectorAll(".cat-chip[data-eq]").forEach((b) => b.addEventListener("click", () => {
      exEquipment = exEquipment === b.getAttribute("data-eq") ? null : b.getAttribute("data-eq");
      el.querySelectorAll(".cat-chip[data-eq]").forEach((c) => c.classList.toggle("active", c.getAttribute("data-eq") === exEquipment));
      renderLibrary();
    }));

    el.querySelectorAll(".start-tpl2").forEach((b) => b.addEventListener("click", async () => { if (await startWorkout(b.getAttribute("data-id"))) setTab("train"); }));
    el.querySelectorAll(".edit-tpl").forEach((b) => b.addEventListener("click", () => openTemplateEditor(ctx, byId(state.templates, b.getAttribute("data-id")))));
    el.querySelectorAll(".share-tpl").forEach((b) => b.addEventListener("click", () => openShareSheet(byId(state.templates, b.getAttribute("data-id")))));
    el.querySelectorAll(".pin-tpl").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePinTemplate(b.getAttribute("data-id"));
    }));
    el.querySelectorAll(".hide-tpl").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      hideBuiltinTemplate(b.getAttribute("data-id"));
    }));
    el.querySelectorAll(".del-tpl").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      try {
        await db.deleteTemplate(id);
        state.templates = state.templates.filter((t) => t.id !== id);
        renderExercises(); toast("Template deleted");
      } catch (err) { toast("Couldn't delete template"); }
    }));
    el.querySelectorAll(".accept-share").forEach((b) => b.addEventListener("click", () => acceptShare(b.getAttribute("data-id"), b)));
    el.querySelectorAll(".decline-share").forEach((b) => b.addEventListener("click", () => declineShare(b.getAttribute("data-id"))));

    // library rows are added lazily, so listen once on the container
    const lib = document.getElementById("exLibrary");
    lib.addEventListener("click", async (e) => {
      const del = e.target.closest(".del-ex");
      if (del) {
        e.stopPropagation();
        const id = del.getAttribute("data-id");
        try {
          await db.deleteCustomExercise(id);
          state.exercises = state.exercises.filter((e2) => e2.id !== id);
          renderLibrary(); toast("Exercise removed");
        } catch (err) { toast("Couldn't delete exercise"); }
        return;
      }
      const row = e.target.closest(".ex-row");
      if (row) openExerciseDetail(byId(state.exercises, row.getAttribute("data-id")));
    });
  }

  /* ---------- template sharing ---------- */
  async function loadFriendsList() {
    if (!state.friends) {
      try { state.friends = await db.listFriendships(user.id); }
      catch (e) { state.friends = { accepted: [], incoming: [], outgoing: [] }; }
    }
    return state.friends.accepted;
  }

  async function openShareSheet(t) {
    if (!t) return;
    openSheet(`
      <div class="sheet-title"><h3>Share template</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close">${ICON.x}</button></div>
      <p class="muted">Loading your friends…</p>`);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    const friends = await loadFriendsList();
    const picked = new Set();
    function draw() {
      const listHtml = friends.length
        ? `<div class="pick-list">${friends.map((r) => {
            const nm = (r.otherProfile && r.otherProfile.display_name) || "Friend";
            const on = picked.has(r.otherId);
            return `<button type="button" class="friend-pick${on ? " on" : ""}" data-id="${r.otherId}" aria-pressed="${on}">
              <span class="avatar-sm">${r.otherProfile && r.otherProfile.avatar_url ? `<img src="${r.otherProfile.avatar_url}" alt="">` : escapeHtml(nm.charAt(0).toUpperCase())}</span>
              <span class="nm">${escapeHtml(nm)}</span>
              <span class="chk">${ICON.check}</span>
            </button>`;
          }).join("")}</div>`
        : `<div class="card"><p class="muted">You haven't added any friends yet. Add someone in the Friends tab, then share from here.</p><button class="btn btn-secondary btn-block" id="goFriendsBtn">Go to Friends</button></div>`;
      openSheet(`
        <div class="sheet-title"><h3>Share “${escapeHtml(t.name)}”</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close">${ICON.x}</button></div>
        <p class="muted">Friends get their own copy with your sets, reps and weights as a starting point — they can change anything without touching yours.</p>
        ${listHtml}
        ${friends.length ? `<button class="btn btn-primary btn-block" id="sendShareBtn"${picked.size ? "" : " disabled"}>${picked.size ? `Send to ${picked.size} friend${picked.size === 1 ? "" : "s"}` : "Pick at least one friend"}</button>` : ""}
      `);
      document.getElementById("sheetClose").addEventListener("click", closeSheet);
      const go = document.getElementById("goFriendsBtn");
      if (go) go.addEventListener("click", () => { closeSheet(); setTab("friends"); });
      document.querySelectorAll(".friend-pick").forEach((b) => b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        draw();
      }));
      const send = document.getElementById("sendShareBtn");
      if (send) send.addEventListener("click", async () => {
        send.disabled = true; send.textContent = "Sending…";
        const meta = {};
        t.exerciseIds.forEach((id) => { const e = byId(state.exercises, id); if (e) meta[id] = { name: e.name, cat: e.cat, custom: !!e.isCustom }; });
        // Send every target weight in this person's current unit, matching `unit`.
        const targets = {};
        Object.entries(t.targets || {}).forEach(([id, tg]) => { targets[id] = buildTarget(templateSets(tg, state.unit), state.unit, tg.supersetNext); });
        try {
          await db.shareTemplate(user.id, [...picked], { name: t.name, exerciseIds: t.exerciseIds, targets, exerciseMeta: meta, unit: state.unit });
          closeSheet();
          toast(picked.size === 1 ? "Template shared" : `Shared with ${picked.size} friends`);
        } catch (err) {
          toast(/template_shares/.test(err.message || "") ? "Sharing isn't set up yet — run migration_5 in Supabase" : "Couldn't share: " + (err.message || String(err)));
          send.disabled = false; send.textContent = `Send to ${picked.size} friend${picked.size === 1 ? "" : "s"}`;
        }
      });
    }
    draw();
  }

  async function refreshShares(rerender) {
    try {
      const shares = await db.listIncomingShares(user.id);
      const changed = shares.length !== state.shares.length || shares.some((x, i) => !state.shares[i] || state.shares[i].id !== x.id);
      state.shares = shares;
      updateShareBadge();
      if (changed && rerender && currentTab === "exercises") renderExercises();
      return changed;
    } catch (e) { return false; } // table not created yet → sharing just stays hidden
  }

  function updateShareBadge() {
    const btn = document.querySelector('.tabbar button[data-tab="exercises"]');
    if (!btn) return;
    let dot = btn.querySelector(".tab-badge");
    if (state.shares.length && !dot) { dot = document.createElement("i"); dot.className = "tab-badge"; btn.appendChild(dot); }
    if (!state.shares.length && dot) dot.remove();
  }

  async function acceptShare(id, btn) {
    const sh = state.shares.find((x) => x.id === id);
    if (!sh) return;
    if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    try {
      // The sender's own custom exercises don't exist for you yet, so make
      // matching ones in your library and point the template at those.
      const idMap = {};
      for (const exId of sh.exerciseIds) {
        if (byId(state.exercises, exId)) continue;
        const m = sh.exerciseMeta[exId] || {};
        const existing = state.exercises.find((e) => e.isCustom && e.name === (m.name || "Exercise"));
        if (existing) { idMap[exId] = existing.id; continue; }
        const created = await db.addCustomExercise(user.id, m.name || "Exercise", m.cat || CAT_ORDER[0]);
        state.exercises.push(created);
        idMap[exId] = created.id;
      }
      // Weights are stored in whatever unit the sender uses; convert every set to yours.
      const ids = sh.exerciseIds.map((x) => idMap[x] || x);
      const targets = {};
      sh.exerciseIds.forEach((x) => {
        const tg = (sh.targets || {})[x];
        if (tg) targets[idMap[x] || x] = buildTarget(templateSets({ ...tg, unit: tg.unit || sh.unit }, state.unit), state.unit, tg.supersetNext);
      });
      const taken = new Set(state.templates.map((t) => t.name));
      let name = sh.name;
      if (taken.has(name)) name = `${sh.name} (${sh.senderName})`;
      const created = await db.addTemplate(user.id, name, ids, targets);
      state.templates.push(created);
      await db.respondToShare(id, "accepted");
      state.shares = state.shares.filter((x) => x.id !== id);
      updateShareBadge();
      renderExercises();
      toast("Added — set the reps and weights that suit you");
      openTemplateEditor(ctx, created);
    } catch (err) {
      toast("Couldn't add that template: " + (err.message || String(err)));
      if (btn) { btn.disabled = false; btn.textContent = "Add & customise"; }
    }
  }

  async function declineShare(id) {
    try {
      await db.respondToShare(id, "declined");
      state.shares = state.shares.filter((x) => x.id !== id);
      updateShareBadge();
      renderExercises();
    } catch (err) { toast("Couldn't update that"); }
  }

  function openExerciseDetail(ex) {
    if (!ex) return;
    const hasImgs = Array.isArray(ex.images) && ex.images.length >= 2;
    const instrHtml = (ex.instructions || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");

    // Your own numbers for this exercise.
    let timesLogged = 0, prKg = 0, prDate = null;
    state.history.forEach((sess) => sess.exercises.forEach((e) => {
      if (e.exerciseId !== ex.id) return;
      timesLogged++;
      e.sets.forEach((s) => { if ((s.kg || 0) > prKg) { prKg = s.kg; prDate = sess.date; } });
    }));
    const last = lastSetsFor(ex.id);
    const statsHtml = timesLogged ? `
      <div class="ex-stats">
        <div><span class="v">${prKg ? `${fmtNum(fromKg(prKg, state.unit))} ${state.unit}` : "BW"}</span><span class="l">Best${prDate ? ` · ${fmtShort(prDate)}` : ""}</span></div>
        <div><span class="v">${timesLogged}</span><span class="l">Times logged</span></div>
        <div><span class="v">${last ? fmtShort(last.date) : "—"}</span><span class="l">Last done</span></div>
      </div>
      ${last ? `<p class="faint">Last time: ${escapeHtml(last.sets.map(fmtSet).join(", "))}${last.sets.some((s) => s.kg) ? ` ${state.unit}` : ""}</p>` : ""}`
      : `<p class="faint">You haven't logged this one yet.</p>`;
    const inNormalWorkout = !!state.active;
    const actionHtml = inNormalWorkout
      ? (state.active.exercises.some((e) => e.exerciseId === ex.id)
        ? `<button class="btn btn-secondary btn-block" disabled>Already in your workout</button>`
        : `<button class="btn btn-primary btn-block" id="exDetailAdd">+ Add to current workout</button>`)
      : !state.active ? `<button class="btn btn-primary btn-block" id="exDetailStart">Start a workout with this</button>` : "";

    openSheet(`
      <div class="sheet-title"><h3>${escapeHtml(ex.name)}</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="ex-tags">
        <span class="ex-tag">${escapeHtml(ex.cat)}</span>
        ${ex.equipment ? `<span class="ex-tag">${escapeHtml(ex.equipment)}</span>` : ""}
        ${ex.level ? `<span class="ex-tag">${escapeHtml(ex.level)}</span>` : ""}
      </div>
      ${statsHtml}
      ${actionHtml}
      ${hasImgs ? `
        <div class="ex-demo">
          <img class="ex-demo-img on" id="exDemoA" src="${ex.images[0]}" alt="${escapeHtml(ex.name)}, position 1" loading="lazy">
          <img class="ex-demo-img" id="exDemoB" src="${ex.images[1]}" alt="${escapeHtml(ex.name)}, position 2" loading="lazy">
        </div>` : ""}
      ${instrHtml ? `<ol class="ex-instructions">${instrHtml}</ol>` : '<p class="muted">No step-by-step instructions for this one yet.</p>'}
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    const addBtn = document.getElementById("exDetailAdd");
    if (addBtn) addBtn.addEventListener("click", () => {
      state.active.exercises.push({ exerciseId: ex.id, supersetNext: false, sets: prefillSetsFor(ex.id) });
      saveActiveDraft();
      closeSheet();
      setTab("train");
      toast(`${ex.name} added`);
    });
    const startBtn = document.getElementById("exDetailStart");
    if (startBtn) startBtn.addEventListener("click", async () => {
      if (await startWorkout(null, ex.id)) { closeSheet(); setTab("train"); }
    });
    if (hasImgs) {
      const a = document.getElementById("exDemoA");
      const b = document.getElementById("exDemoB");
      a.addEventListener("error", () => { a.style.display = "none"; });
      b.addEventListener("error", () => { b.style.display = "none"; });
      let showingA = true;
      activeDetailInterval = setInterval(() => {
        showingA = !showingA;
        a.classList.toggle("on", showingA);
        b.classList.toggle("on", !showingA);
      }, 1100);
    }
  }

  function openCustomExerciseForm() {
    const catOpts = CAT_ORDER.map((c) => `<option value="${c}">${c}</option>`).join("");
    openSheet(`
      <div class="sheet-title"><h3>New Exercise</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><label>Name</label><input type="text" id="newExName" placeholder="e.g. Cable Crossover"></div>
      <div class="field"><label>Category</label><select id="newExCat">${catOpts}</select></div>
      <button class="btn btn-primary btn-block" id="saveExBtn">Save Exercise</button>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("saveExBtn").addEventListener("click", async () => {
      const name = document.getElementById("newExName").value.trim();
      const cat = document.getElementById("newExCat").value;
      if (!name) { toast("Enter a name"); return; }
      const saveBtn = document.getElementById("saveExBtn");
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        const created = await db.addCustomExercise(user.id, name, cat);
        state.exercises.push(created);
        closeSheet(); renderExercises(); toast("Exercise added");
      } catch (err) {
        toast("Couldn't save exercise");
        saveBtn.disabled = false; saveBtn.textContent = "Save Exercise";
      }
    });
  }

  /* ---------- shared ctx for friends/calendar/profile/player modules ---------- */
  ctx = {
    user, supabase, db, state,
    toast, openSheet, closeSheet, escapeHtml, uid, byId,
    fmtDate, fmtShort, fmtDuration, roundDisp, fromKg, toKg, parseNum, fmtNum,
    exName, exCat,
    setTab, renderCurrentTab,
    openExercisePicker: renderPickerSheet,
    refreshTopbar,
    setUnit, saveRestDuration,
    isPinnedTemplate, isHiddenBuiltin, togglePinTemplate, hideBuiltinTemplate, restoreBuiltinTemplates,
    replaceBuiltinWithCopy, targetWeight, lastSetsFor,
    openPrivacy: () => openPrivacySheet({ openSheet, closeSheet }),
    openProfile: () => openProfileSheet(ctx),
    confirm: confirmDialog,
    push: { pushSupport, isPushEnabled, enablePush, disablePush },
    onPushChanged
  };

  /* ---------- init ---------- */
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById("dateTag").textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  // Opened from a notification (e.g. /?tab=calendar): go straight to that tab.
  const startTab = tabFromUrl(location.href);
  if (startTab) {
    const u = new URL(location.href);
    u.searchParams.delete("tab");
    history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? "?" + u.searchParams : "") + u.hash);
  }
  // Drafts saved by an older version of the workout screen are converted.
  state.active = normalizeActive(state.active);
  saveActiveDraft();
  setTab(startTab || "train");
  renderBar();
  mountNotifications(ctx);
  try { db.saveTimezone(user.id, Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {}); } catch (e) {}
  syncPushSubscription();
  isPushEnabled().then((on) => { state.pushEnabled = on; if (currentTab === "train" && !state.active) renderTrain(); });
  // Check for templates friends have shared; nudge once if there are any.
  refreshShares(false).then(() => {
    if (state.shares.length) {
      const n = state.shares.length;
      toast(n === 1 ? `${state.shares[0].senderName} shared a template with you` : `${n} templates shared with you`);
    }
  });
}
