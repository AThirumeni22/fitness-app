import { supabase } from "./supabaseClient.js";
import { DEFAULT_TEMPLATES, CAT_ORDER, fetchExerciseLibrary } from "./exercises.js";
import {
  uid, byId, toKg, fromKg, roundDisp,
  fmtDate, fmtShort, fmtDuration, fmtClock, fmtElapsed, escapeHtml
} from "./utils.js";
import { drawChart } from "./chart.js";
import * as db from "./db.js";
import { renderFriends } from "./friends.js";
import { renderCalendar } from "./calendar.js";
import { openProfileSheet } from "./profile.js";
import { openTemplateEditor } from "./player.js";

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
    root.innerHTML = `<div class="boot-loading err">Couldn't load your data: ${escapeHtml(err.message || String(err))}<br><button class="btn btn-secondary" id="retryBtn" style="margin-top:14px;">Retry</button></div>`;
    root.querySelector("#retryBtn").addEventListener("click", () => mountApp(root, user));
    return;
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
    friends: null
  };

  function saveRestDuration(sec) {
    state.restDuration = sec;
    try { localStorage.setItem(REST_KEY, String(sec)); } catch (e) {}
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

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._h);
    toast._h = setTimeout(() => { t.hidden = true; }, 2200);
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
          <span class="mark">Trainlog</span>
          <span class="tag" id="dateTag">—</span>
        </div>
        <div class="actions">
          <button class="chip-btn" id="timerQuickBtn" title="Rest timer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 3h6"/></svg>
            Timer
          </button>
          <button class="chip-btn" id="unitBtn" title="Toggle weight unit">${state.unit}</button>
          <button class="chip-btn" id="profileBtn" title="Your profile">
            <span id="topbarAvatar" class="avatar-sm">${avatarHtml()}</span>
          </button>
          <button class="chip-btn" id="signOutBtn" title="Sign out">
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

      <div class="rest-banner" id="restBanner" hidden></div>

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
    </div>
  `;

  document.getElementById("sheet").addEventListener("click", (e) => {
    if (e.target.id === "sheet") closeSheet();
  });
  document.getElementById("unitBtn").addEventListener("click", async () => {
    state.unit = state.unit === "kg" ? "lb" : "kg";
    document.getElementById("unitBtn").textContent = state.unit;
    renderCurrentTab();
    try { await db.setUnit(user.id, state.unit); } catch (e) { toast("Couldn't save unit preference"); }
  });
  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  document.getElementById("profileBtn").addEventListener("click", () => openProfileSheet(ctx));
  document.querySelectorAll(".tabbar button").forEach((b) => {
    b.addEventListener("click", () => setTab(b.getAttribute("data-tab")));
  });

  let activeDetailInterval = null;
  function openSheet(html) {
    if (activeDetailInterval) { clearInterval(activeDetailInterval); activeDetailInterval = null; }
    document.getElementById("sheetInner").innerHTML = '<div class="sheet-handle"></div>' + html;
    document.getElementById("sheet").hidden = false;
  }
  function closeSheet() {
    if (activeDetailInterval) { clearInterval(activeDetailInterval); activeDetailInterval = null; }
    document.getElementById("sheet").hidden = true;
  }

  let currentTab = "train";
  function setTab(tab) {
    currentTab = tab;
    ["train", "history", "exercises", "friends", "calendar"].forEach((t) => { document.getElementById("tab-" + t).hidden = (t !== tab); });
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === tab));
    renderCurrentTab();
  }
  function renderCurrentTab() {
    if (currentTab === "train") renderTrain();
    else if (currentTab === "history") renderHistory();
    else if (currentTab === "exercises") renderExercises();
    else if (currentTab === "friends") renderFriends(ctx);
    else if (currentTab === "calendar") renderCalendar(ctx);
    renderRestBanner();
  }

  /* ================= TRAIN ================= */
  let playerArmed = false;
  let manualPtr = null;

  function startWorkout(templateId, guided) {
    let exList = [];
    if (templateId) {
      const t = byId(state.templates, templateId);
      if (t) {
        if (guided) {
          exList = t.exerciseIds.map((id) => {
            const tg = (t.targets && t.targets[id]) || {};
            const n = tg.sets || 3;
            return {
              exerciseId: id,
              target: { sets: n, reps: tg.reps || null, weight: tg.weight || null },
              sets: Array.from({ length: n }, () => ({ kg: null, reps: null, done: false }))
            };
          });
        } else {
          exList = t.exerciseIds.map((id) => ({ exerciseId: id, sets: [{ kg: null, reps: null, done: false }] }));
        }
      }
    }
    playerArmed = false;
    manualPtr = null;
    state.active = { startedAt: Date.now(), exercises: exList, guided: !!guided };
    saveActiveDraft();
    renderTrain();
    toast(templateId ? (guided ? "Guided workout started" : "Workout started") : "Empty workout started");
  }

  async function finishWorkout() {
    const a = state.active;
    if (!a) return;
    const cleanEx = a.exercises
      .map((ex) => ({
        exerciseId: ex.exerciseId,
        name: exName(ex.exerciseId),
        sets: ex.sets.filter((s) => s.kg != null && s.reps != null)
      }))
      .filter((ex) => ex.sets.length > 0);

    if (cleanEx.length === 0) {
      state.active = null;
      state.timer = null;
      playerArmed = false; manualPtr = null;
      saveActiveDraft();
      renderTrain();
      renderRestBanner();
      toast("Workout discarded — no sets logged");
      return;
    }

    const finishBtn = document.getElementById("finishBtn");
    if (finishBtn) { finishBtn.disabled = true; finishBtn.textContent = "Saving…"; }

    const workout = {
      date: new Date(a.startedAt).toISOString(),
      durationSec: Math.round((Date.now() - a.startedAt) / 1000),
      exercises: cleanEx
    };
    try {
      await db.saveWorkout(user.id, workout);
      state.history.unshift({ id: uid(), ...workout });
      state.active = null;
      state.timer = null;
      playerArmed = false; manualPtr = null;
      saveActiveDraft();
      renderTrain();
      renderRestBanner();
      toast("Workout saved");
    } catch (err) {
      toast("Couldn't save workout — check your connection and try again");
      if (finishBtn) { finishBtn.disabled = false; finishBtn.textContent = "Finish"; }
    }
  }

  function discardWorkout() {
    state.active = null;
    state.timer = null;
    playerArmed = false; manualPtr = null;
    saveActiveDraft();
    renderTrain();
    renderRestBanner();
    toast("Workout discarded");
  }

  function currentPointer(a) {
    for (let exi = 0; exi < a.exercises.length; exi++) {
      const sets = a.exercises[exi].sets;
      for (let si = 0; si < sets.length; si++) {
        if (!sets[si].done) return { exi, si };
      }
    }
    return null;
  }

  function jumpToExercise(a, exi) {
    const sets = a.exercises[exi].sets;
    let si = sets.findIndex((s) => !s.done);
    if (si === -1) si = 0;
    manualPtr = { exi, si };
    playerArmed = false;
    renderTrain();
  }

  function renderGuidedPlayer(el, a) {
    const ptr = (manualPtr && a.exercises[manualPtr.exi]) ? manualPtr : currentPointer(a);
    const totalSets = a.exercises.reduce((n, ex) => n + ex.sets.length, 0);
    const doneSets = a.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);
    const headHtml = `
      <div class="active-head">
        <div><div class="elapsed-label">In progress · Guided</div><div class="elapsed num" id="activeElapsed">00:00</div></div>
        <div class="head-actions">
          <button class="icon-btn" id="discardBtn" title="Discard workout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg></button>
          <button class="btn btn-primary btn-sm" id="finishBtn">Finish</button>
        </div>
      </div>
      <div id="discardConfirm"></div>`;

    if (!ptr) {
      el.innerHTML = headHtml + `
        <div class="card center">
          <h2 style="font-size:20px; margin-bottom:8px;">All sets done 💪</h2>
          <p class="muted" style="margin-bottom:14px;">${doneSets} of ${totalSets} sets logged.</p>
        </div>`;
      bindGuidedHead(a);
      return;
    }

    const ex = a.exercises[ptr.exi];
    const set = ex.sets[ptr.si];
    const target = ex.target || {};
    const prevBest = bestPr(ex.exerciseId);
    const lastSet = ptr.si > 0 ? ex.sets[ptr.si - 1] : null;
    const defaultW = set.kg != null ? roundDisp(fromKg(set.kg, state.unit))
      : lastSet && lastSet.kg != null ? roundDisp(fromKg(lastSet.kg, state.unit))
      : target.weight != null ? target.weight
      : prevBest ? roundDisp(fromKg(prevBest, state.unit)) : "";
    const defaultReps = set.reps != null ? set.reps
      : lastSet && lastSet.reps != null ? lastSet.reps
      : target.reps != null ? target.reps : "";

    el.innerHTML = headHtml + `
      <p class="muted player-meta">Exercise ${ptr.exi + 1} of ${a.exercises.length} · ${doneSets}/${totalSets} sets done</p>
      <div class="card center">
        <h2 style="font-size:20px; margin-bottom:4px;">${escapeHtml(exName(ex.exerciseId))}</h2>
        <p class="muted player-target">Set ${ptr.si + 1} of ${ex.sets.length}${target.reps ? ` · target ${target.reps} reps` : ""}${target.weight ? ` @ ${target.weight}${state.unit}` : ""}</p>
        ${!playerArmed ? `
          <button class="btn btn-primary btn-block btn-lg" id="playSetBtn">▶ Start Set</button>
          <button class="btn btn-ghost" id="skipSetBtn" style="margin-top:10px;">Skip this set</button>
        ` : `
          <div class="field-row">
            <div class="field inline"><label>Weight (${state.unit})</label><input type="number" inputmode="decimal" id="playerWeightInput" value="${defaultW}"></div>
            <div class="field inline"><label>Reps</label><input type="number" inputmode="numeric" id="playerRepsInput" value="${defaultReps}"></div>
          </div>
          <button class="btn btn-primary btn-block" id="completeSetBtn" style="padding:16px;">✓ Mark Set Done</button>
        `}
      </div>
      <div class="player-actions">
        <button class="link-btn${ptr.exi === 0 ? " disabled" : ""}" id="prevExBtn"${ptr.exi === 0 ? " disabled" : ""}>← Prev exercise</button>
        <button class="link-btn${ptr.exi === a.exercises.length - 1 ? " disabled" : ""}" id="nextExBtn"${ptr.exi === a.exercises.length - 1 ? " disabled" : ""}>Next exercise →</button>
      </div>`;

    bindGuidedHead(a);

    if (!playerArmed) {
      document.getElementById("playSetBtn").addEventListener("click", () => { playerArmed = true; renderTrain(); });
      document.getElementById("skipSetBtn").addEventListener("click", () => {
        set.done = true;
        manualPtr = null;
        saveActiveDraft();
        renderTrain();
      });
    } else {
      document.getElementById("completeSetBtn").addEventListener("click", () => {
        const w = parseFloat(document.getElementById("playerWeightInput").value);
        const r = parseInt(document.getElementById("playerRepsInput").value, 10);
        if (isNaN(w) || isNaN(r)) { toast("Enter both weight and reps"); return; }
        const kg = toKg(w, state.unit);
        set.kg = kg; set.reps = r; set.done = true;
        manualPtr = null;
        saveActiveDraft();
        if (prevBest && kg > prevBest) toast(`🎉 New PR — ${roundDisp(w)} ${state.unit}!`);
        else if (prevBest && kg < prevBest) toast(`Logged — your best is ${roundDisp(fromKg(prevBest, state.unit))} ${state.unit}`);
        else toast("Set logged");
        startRestTimer(state.restDuration);
        playerArmed = false;
        renderTrain();
      });
    }

    const prevBtn = document.getElementById("prevExBtn");
    const nextBtn = document.getElementById("nextExBtn");
    if (prevBtn) prevBtn.addEventListener("click", () => { if (ptr.exi > 0) jumpToExercise(a, ptr.exi - 1); });
    if (nextBtn) nextBtn.addEventListener("click", () => { if (ptr.exi < a.exercises.length - 1) jumpToExercise(a, ptr.exi + 1); });
  }

  function bindGuidedHead(a) {
    function tickElapsed() {
      const sec = (Date.now() - a.startedAt) / 1000;
      const el2 = document.getElementById("activeElapsed");
      if (el2) el2.textContent = fmtElapsed(sec);
    }
    tickElapsed();
    if (elapsedTimerHandle) clearInterval(elapsedTimerHandle);
    elapsedTimerHandle = setInterval(tickElapsed, 1000);
    document.getElementById("finishBtn").addEventListener("click", finishWorkout);
    document.getElementById("discardBtn").addEventListener("click", () => {
      document.getElementById("discardConfirm").innerHTML = `
        <div class="confirm-row"><span>Discard this workout?</span><span class="spacer"></span>
        <button class="btn btn-danger btn-sm" id="confirmDiscard">Discard</button>
        <button class="btn btn-secondary btn-sm" id="cancelDiscard">Cancel</button></div>`;
      document.getElementById("confirmDiscard").addEventListener("click", discardWorkout);
      document.getElementById("cancelDiscard").addEventListener("click", () => { document.getElementById("discardConfirm").innerHTML = ""; });
    });
  }

  let elapsedTimerHandle = null;
  function renderTrain() {
    const el = document.getElementById("tab-train");
    if (state.active && state.active.guided) { renderGuidedPlayer(el, state.active); return; }
    if (!state.active) {
      const tplHtml = state.templates.length ? state.templates.map((t) => `
        <div class="tpl-card">
          <h4>${escapeHtml(t.name)}</h4>
          <div class="tpl-ex">${escapeHtml(t.exerciseIds.slice(0, 4).map(exName).join(", "))}${t.exerciseIds.length > 4 ? "…" : ""}</div>
          <button class="btn btn-secondary btn-sm start-tpl" data-id="${t.id}">Start</button>
        </div>`).join("") : '<p class="muted">No templates yet — build one in the Exercises tab.</p>';

      el.innerHTML = `
        <div class="card start-card">
          <h2>Ready to train?</h2>
          <p class="muted">Start with a blank session or jump into a template.</p>
          <button class="btn btn-primary btn-block" id="startEmptyBtn">Start Empty Workout</button>
        </div>
        <div class="section-label" style="margin-top:4px;">Templates</div>
        <div class="tpl-scroll">${tplHtml}</div>
      `;
      document.getElementById("startEmptyBtn").addEventListener("click", () => startWorkout(null));
      el.querySelectorAll(".start-tpl").forEach((b) => b.addEventListener("click", () => startWorkout(b.getAttribute("data-id"))));
      if (elapsedTimerHandle) { clearInterval(elapsedTimerHandle); elapsedTimerHandle = null; }
      return;
    }

    const a = state.active;
    const exCards = a.exercises.map((ex, exi) => {
      const rows = ex.sets.map((s, si) => {
        const wDisp = s.kg != null ? roundDisp(fromKg(s.kg, state.unit)) : "";
        return `
          <div class="set-row" data-exi="${exi}" data-si="${si}">
            <div class="set-num">${si + 1}</div>
            <input type="number" inputmode="decimal" class="set-weight" placeholder="${state.unit}" value="${wDisp === "" ? "" : wDisp}">
            <input type="number" inputmode="numeric" class="set-reps" placeholder="reps" value="${s.reps != null ? s.reps : ""}">
            <button class="set-done ${s.done ? "on" : ""}" title="Mark done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg></button>
            <button class="set-del" title="Delete set"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>`;
      }).join("");

      return `
        <div class="exercise-card" data-exi="${exi}">
          <div class="exercise-card-head">
            <div><h3>${escapeHtml(exName(ex.exerciseId))}</h3><span class="cat-tag">${escapeHtml(exCat(ex.exerciseId))}</span></div>
            <button class="icon-btn remove-ex" title="Remove exercise"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
          <div class="sets-table">
            <div class="sets-head"><span></span><span>Weight (${state.unit})</span><span>Reps</span><span></span><span></span></div>
            ${rows}
          </div>
          <button class="btn btn-ghost add-set-btn">+ Add Set</button>
        </div>`;
    }).join("");

    el.innerHTML = `
      <div class="active-head">
        <div><div class="elapsed-label">In progress</div><div class="elapsed num" id="activeElapsed">00:00</div></div>
        <div class="head-actions">
          <button class="icon-btn" id="discardBtn" title="Discard workout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg></button>
          <button class="btn btn-primary btn-sm" id="finishBtn">Finish</button>
        </div>
      </div>
      <div id="discardConfirm"></div>
      ${exCards}
      <button class="btn btn-secondary btn-block" id="addExerciseBtn">+ Add Exercise</button>
    `;

    function tickElapsed() {
      const sec = (Date.now() - a.startedAt) / 1000;
      document.getElementById("activeElapsed").textContent = fmtElapsed(sec);
    }
    tickElapsed();
    if (elapsedTimerHandle) clearInterval(elapsedTimerHandle);
    elapsedTimerHandle = setInterval(tickElapsed, 1000);

    document.getElementById("finishBtn").addEventListener("click", finishWorkout);
    document.getElementById("discardBtn").addEventListener("click", () => {
      document.getElementById("discardConfirm").innerHTML = `
        <div class="confirm-row"><span>Discard this workout?</span><span class="spacer"></span>
        <button class="btn btn-danger btn-sm" id="confirmDiscard">Discard</button>
        <button class="btn btn-secondary btn-sm" id="cancelDiscard">Cancel</button></div>`;
      document.getElementById("confirmDiscard").addEventListener("click", discardWorkout);
      document.getElementById("cancelDiscard").addEventListener("click", () => { document.getElementById("discardConfirm").innerHTML = ""; });
    });

    el.querySelectorAll(".remove-ex").forEach((b) => b.addEventListener("click", () => {
      const exi = parseInt(b.closest(".exercise-card").getAttribute("data-exi"), 10);
      a.exercises.splice(exi, 1);
      saveActiveDraft(); renderTrain();
    }));
    el.querySelectorAll(".add-set-btn").forEach((b) => b.addEventListener("click", () => {
      const exi = parseInt(b.closest(".exercise-card").getAttribute("data-exi"), 10);
      const sets = a.exercises[exi].sets;
      const last = sets[sets.length - 1];
      sets.push({ kg: last ? last.kg : null, reps: last ? last.reps : null, done: false });
      saveActiveDraft(); renderTrain();
    }));
    el.querySelectorAll(".set-weight").forEach((inp) => inp.addEventListener("input", () => {
      const row = inp.closest(".set-row");
      const exi = parseInt(row.getAttribute("data-exi"), 10), si = parseInt(row.getAttribute("data-si"), 10);
      const v = parseFloat(inp.value);
      a.exercises[exi].sets[si].kg = isNaN(v) ? null : toKg(v, state.unit);
      saveActiveDraft();
    }));
    el.querySelectorAll(".set-reps").forEach((inp) => inp.addEventListener("input", () => {
      const row = inp.closest(".set-row");
      const exi = parseInt(row.getAttribute("data-exi"), 10), si = parseInt(row.getAttribute("data-si"), 10);
      const v = parseInt(inp.value, 10);
      a.exercises[exi].sets[si].reps = isNaN(v) ? null : v;
      saveActiveDraft();
    }));
    el.querySelectorAll(".set-done").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest(".set-row");
      const exi = parseInt(row.getAttribute("data-exi"), 10), si = parseInt(row.getAttribute("data-si"), 10);
      const s = a.exercises[exi].sets[si];
      s.done = !s.done;
      saveActiveDraft();
      btn.classList.toggle("on", s.done);
      if (s.done) startRestTimer(state.restDuration);
    }));
    el.querySelectorAll(".set-del").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest(".set-row");
      const exi = parseInt(row.getAttribute("data-exi"), 10), si = parseInt(row.getAttribute("data-si"), 10);
      a.exercises[exi].sets.splice(si, 1);
      if (a.exercises[exi].sets.length === 0) a.exercises[exi].sets.push({ kg: null, reps: null, done: false });
      saveActiveDraft(); renderTrain();
    }));

    document.getElementById("addExerciseBtn").addEventListener("click", openAddExerciseSheet);
  }

  function openAddExerciseSheet() {
    renderPickerSheet("Add Exercise", (exId) => {
      state.active.exercises.push({ exerciseId: exId, sets: [{ kg: null, reps: null, done: false }] });
      saveActiveDraft();
      closeSheet();
      renderTrain();
    });
  }

  function renderPickerSheet(title, onPick) {
    let activeCat = null;
    const MAX_RESULTS = 150;

    function draw(filterRaw) {
      const q = (filterRaw || "").trim().toLowerCase();
      const chips = CAT_ORDER.map((c) => `<button class="cat-chip ${c === activeCat ? "active" : ""}" data-cat="${c}">${escapeHtml(c)}</button>`).join("");

      if (!q && !activeCat) {
        return `<div class="cat-chip-row">${chips}</div><p class="muted" style="margin-top:14px;">Search by name, or pick a category to browse.</p>`;
      }

      const pool = activeCat ? state.exercises.filter((e) => e.cat === activeCat) : state.exercises;
      const matches = q ? pool.filter((e) => e.name.toLowerCase().indexOf(q) > -1) : pool;
      const shown = matches.slice(0, MAX_RESULTS);
      let rowsHtml = shown.map((e) => `<div class="pick-row" data-id="${e.id}"><span>${escapeHtml(e.name)}</span><span class="pick-eq">${escapeHtml(e.equipment || "")}</span></div>`).join("");
      if (!shown.length) rowsHtml = `<p class="muted" style="padding:12px 4px;">No matches.</p>`;
      const moreNote = matches.length > MAX_RESULTS
        ? `<p class="faint" style="font-size:11.5px; padding:8px 4px 0;">Showing ${MAX_RESULTS} of ${matches.length} — keep typing to narrow it down.</p>`
        : "";
      return `<div class="cat-chip-row">${chips}</div>${rowsHtml}${moreNote}`;
    }

    openSheet(`
      <div class="sheet-title"><h3>${title}</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><input type="text" id="pickerSearch" placeholder="Search exercises…"></div>
      <div id="pickerBody">${draw("")}</div>
    `);

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

  /* ================= REST TIMER ================= */
  let restTickHandle = null;
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

  function startRestTimer(sec) {
    state.timer = { endsAt: Date.now() + sec * 1000, duration: sec, done: false };
    renderRestBanner();
  }
  function adjustRestTimer(delta) {
    if (!state.timer) return;
    state.timer.endsAt += delta * 1000;
    state.timer.duration = Math.max(1, state.timer.duration + delta);
    renderRestBanner();
  }
  function stopRestTimer() {
    state.timer = null;
    renderRestBanner();
  }

  function renderRestBanner() {
    const el = document.getElementById("restBanner");
    if (!el) return;
    if (!state.timer) {
      el.hidden = true;
      if (restTickHandle) { clearInterval(restTickHandle); restTickHandle = null; }
      return;
    }
    el.hidden = false;
    function tick() {
      const remain = (state.timer.endsAt - Date.now()) / 1000;
      if (remain <= 0 && !state.timer.done) { state.timer.done = true; beep(); }
      const pct = Math.max(0, Math.min(1, remain / state.timer.duration));
      el.innerHTML = `
        <div class="rest-top"><span class="rest-label">${remain <= 0 ? "Rest complete" : "Resting"}</span>
        <span class="rest-time">${fmtClock(Math.max(0, remain))}</span></div>
        <div class="rest-bar"><div style="width:${pct * 100}%"></div></div>
        <div class="rest-actions">
          <button data-a="-15">−15s</button>
          <button data-a="+15">+15s</button>
          <button class="skip" data-a="skip">${remain <= 0 ? "Dismiss" : "Skip"}</button>
        </div>`;
      el.querySelector('[data-a="-15"]').addEventListener("click", () => adjustRestTimer(-15));
      el.querySelector('[data-a="+15"]').addEventListener("click", () => adjustRestTimer(15));
      el.querySelector('[data-a="skip"]').addEventListener("click", stopRestTimer);
    }
    tick();
    if (restTickHandle) clearInterval(restTickHandle);
    restTickHandle = setInterval(tick, 250);
  }

  document.getElementById("timerQuickBtn").addEventListener("click", () => {
    if (state.timer) return;
    const presets = [30, 60, 90, 120];
    openSheet(`
      <div class="sheet-title"><h3>Rest Timer</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <p class="muted" style="margin-bottom:10px;">This is also what auto-starts when you mark a set done.</p>
      <div class="preset-row">
        ${presets.map((s) => `<button data-s="${s}" class="${s === state.restDuration ? "active" : ""}">${s}s</button>`).join("")}
      </div>
      <div class="field"><label>Or a custom length (seconds)</label><input type="number" id="customTimerInput" placeholder="e.g. 75" value="${presets.includes(state.restDuration) ? "" : state.restDuration}"></div>
      <button class="btn btn-primary btn-block" id="startTimerBtn">Start</button>
    `);
    let chosen = state.restDuration;
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.querySelectorAll(".preset-row button").forEach((b) => b.addEventListener("click", () => {
      chosen = parseInt(b.getAttribute("data-s"), 10);
      document.querySelectorAll(".preset-row button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("customTimerInput").value = "";
    }));
    document.getElementById("customTimerInput").addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) {
        chosen = v;
        document.querySelectorAll(".preset-row button").forEach((x) => x.classList.remove("active"));
      }
    });
    document.getElementById("startTimerBtn").addEventListener("click", () => {
      saveRestDuration(chosen);
      startRestTimer(chosen);
      closeSheet();
    });
  });

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
      chartHtml = '<div class="card empty-state"><div class="glyph">📈</div><p>Log a few workouts to start seeing progress charts here.</p></div>';
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
      sessHtml = '<div class="card empty-state"><div class="glyph">🗓️</div><p>No workouts yet — finish your first session and it will show up here.</p></div>';
    } else {
      sessHtml = state.history.map((sess) => {
        const vol = sess.exercises.reduce((sum, ex) => sum + ex.sets.reduce((s2, s) => s2 + (s.kg || 0) * (s.reps || 0), 0), 0);
        const exDetail = sess.exercises.map((ex) => {
          const setsStr = ex.sets.map((s) => `${roundDisp(fromKg(s.kg, state.unit))}×${s.reps}`).join("  ");
          return `<div class="session-ex"><div class="exn">${escapeHtml(ex.name)}</div><div class="exs">${setsStr} ${state.unit}</div></div>`;
        }).join("");
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

    el.innerHTML = statHtml + chartHtml + '<div class="section-label">History</div>' + sessHtml;

    if (exWithHist.length) {
      document.getElementById("chartExSelect").addEventListener("change", (e) => { chartExId = e.target.value; renderHistory(); });
      el.querySelectorAll(".metric-toggle button").forEach((b) => b.addEventListener("click", () => { chartMetric = b.getAttribute("data-m"); renderHistory(); }));
      drawChart(document.getElementById("chartWrap"), seriesFor(chartExId, chartMetric), chartMetric, state.unit);
    }

    el.querySelectorAll(".session-card").forEach((card) => card.querySelector(".session-head").addEventListener("click", () => card.classList.toggle("open")));
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

  function renderExercises() {
    const el = document.getElementById("tab-exercises");

    const tplHtml = state.templates.length ? state.templates.map((t) => `
      <div class="tpl-list-card" style="flex-wrap:wrap;">
        <div class="info"><h4>${escapeHtml(t.name)}</h4><p>${escapeHtml(t.exerciseIds.map(exName).join(", "))}</p></div>
        <button class="icon-btn run-tpl" data-id="${t.id}" title="Run guided"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l14 8-14 8V4z"/></svg></button>
        <button class="icon-btn edit-tpl" data-id="${t.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
        <button class="btn btn-secondary btn-sm start-tpl2" data-id="${t.id}">Start</button>
        ${t.isCustom ? `<button class="icon-btn del-tpl" data-id="${t.id}" title="Delete template"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
      </div>`).join('<div style="height:8px"></div>') : '<p class="muted">No templates yet.</p>';

    const byCat = {};
    CAT_ORDER.forEach((c) => { byCat[c] = []; });
    state.exercises.forEach((e) => { (byCat[e.cat] = byCat[e.cat] || []).push(e); });
    const q = exSearch.trim().toLowerCase();
    const searching = q.length > 0;

    const eqChipsHtml = EQUIPMENT_GROUPS.map((g) => `<button class="cat-chip ${exEquipment === g.key ? "active" : ""}" data-eq="${g.key}">${escapeHtml(g.label)}</button>`).join("");

    const groupsHtml = CAT_ORDER.map((cat) => {
      let items = byCat[cat] || [];
      if (exEquipment) items = items.filter((e) => (e.equipment || "other") === exEquipment);
      if (q) items = items.filter((e) => e.name.toLowerCase().indexOf(q) > -1);
      if (!items.length) return "";
      const rows = items.map((e) => {
        const pr = bestPr(e.id);
        return `
          <div class="ex-row" data-id="${e.id}">
            <div class="info"><div class="nm">${escapeHtml(e.name)}</div>
            <div class="pr">${pr > 0 ? `PR ${roundDisp(fromKg(pr, state.unit))} ${state.unit}` : escapeHtml(e.equipment || "")}</div></div>
            ${e.isCustom
              ? `<button class="icon-btn del-ex" data-id="${e.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
              : `<svg class="chev-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>`}
          </div>`;
      }).join("");
      return `<details class="cat-group" ${searching || exEquipment ? "open" : ""}><summary>${escapeHtml(cat)} <span class="count">${items.length}</span></summary>${rows}</details>`;
    }).join("");

    el.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;"><h2 style="font-size:19px;">Templates</h2>
      <button class="btn btn-secondary btn-sm" id="newTplBtn">+ New</button></div>
      ${tplHtml}
      <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px;"><h2 style="font-size:19px;">Library</h2>
      <button class="btn btn-secondary btn-sm" id="newExBtn">+ Add Custom</button></div>
      <input type="text" class="search-input" id="exSearchInput" placeholder="Search 870+ exercises…" value="${escapeHtml(exSearch)}">
      <div class="cat-chip-row">${eqChipsHtml}</div>
      ${groupsHtml || `<p class="muted">No exercises match "${escapeHtml(exSearch)}".</p>`}
    `;

    document.getElementById("newTplBtn").addEventListener("click", () => openTemplateEditor(ctx, null));
    document.getElementById("newExBtn").addEventListener("click", openCustomExerciseForm);
    document.getElementById("exSearchInput").addEventListener("input", (e) => {
      exSearch = e.target.value;
      renderExercises();
      const inp = document.getElementById("exSearchInput");
      inp.focus(); inp.setSelectionRange(exSearch.length, exSearch.length);
    });
    el.querySelectorAll(".cat-chip[data-eq]").forEach((b) => b.addEventListener("click", () => {
      exEquipment = exEquipment === b.getAttribute("data-eq") ? null : b.getAttribute("data-eq");
      renderExercises();
    }));
    el.querySelectorAll(".start-tpl2").forEach((b) => b.addEventListener("click", () => { startWorkout(b.getAttribute("data-id")); setTab("train"); }));
    el.querySelectorAll(".run-tpl").forEach((b) => b.addEventListener("click", () => { startWorkout(b.getAttribute("data-id"), true); setTab("train"); }));
    el.querySelectorAll(".edit-tpl").forEach((b) => b.addEventListener("click", () => openTemplateEditor(ctx, byId(state.templates, b.getAttribute("data-id")))));
    el.querySelectorAll(".del-tpl").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      try {
        await db.deleteTemplate(id);
        state.templates = state.templates.filter((t) => t.id !== id);
        renderExercises(); toast("Template deleted");
      } catch (err) { toast("Couldn't delete template"); }
    }));
    el.querySelectorAll(".del-ex").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      try {
        await db.deleteCustomExercise(id);
        state.exercises = state.exercises.filter((e2) => e2.id !== id);
        renderExercises(); toast("Exercise removed");
      } catch (err) { toast("Couldn't delete exercise"); }
    }));
    el.querySelectorAll(".ex-row").forEach((row) => row.addEventListener("click", () => {
      openExerciseDetail(byId(state.exercises, row.getAttribute("data-id")));
    }));
  }

  function openExerciseDetail(ex) {
    if (!ex) return;
    const hasImgs = Array.isArray(ex.images) && ex.images.length >= 2;
    const instrHtml = (ex.instructions || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    openSheet(`
      <div class="sheet-title"><h3>${escapeHtml(ex.name)}</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="ex-tags">
        <span class="ex-tag">${escapeHtml(ex.cat)}</span>
        ${ex.equipment ? `<span class="ex-tag">${escapeHtml(ex.equipment)}</span>` : ""}
        ${ex.level ? `<span class="ex-tag">${escapeHtml(ex.level)}</span>` : ""}
      </div>
      ${hasImgs ? `
        <div class="ex-demo">
          <img class="ex-demo-img on" id="exDemoA" src="${ex.images[0]}" alt="${escapeHtml(ex.name)}, position 1" loading="lazy">
          <img class="ex-demo-img" id="exDemoB" src="${ex.images[1]}" alt="${escapeHtml(ex.name)}, position 2" loading="lazy">
        </div>` : ""}
      ${instrHtml ? `<ol class="ex-instructions">${instrHtml}</ol>` : '<p class="muted">No step-by-step instructions for this one yet.</p>'}
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
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
      <div class="sheet-title"><h3>New Exercise</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
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
    fmtDate, fmtShort, fmtDuration, roundDisp, fromKg, toKg,
    exName, exCat,
    setTab, renderCurrentTab,
    openExercisePicker: renderPickerSheet,
    refreshTopbar
  };

  /* ---------- init ---------- */
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById("dateTag").textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  setTab("train");
  renderRestBanner();
}
