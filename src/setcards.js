// Shared pieces of the workout screen and the template editor: the exercise
// card (one renderer for both, so they look the same), per-set template
// data, and the small pop-ups they use (rest picker, exercise menu,
// progression chart, choice dialog).

import { fmtNum, fromKg, toKg, roundDisp, escapeHtml, fmtShort, fmtClock } from "./utils.js";
import { drawChart } from "./chart.js";
import { GROUP_COLORS } from "./musclechart.js";

/* ================= template data ================= */

// A template's target for one exercise, as one entry per set:
// [{ reps, weight, rest }] with weight in `unit` (null = none set).
// Older targets only had one sets/reps/weight/rest; they expand to that
// many identical sets. Weights saved in another unit are converted.
export function templateSets(tg, unit) {
  tg = tg || {};
  const from = tg.unit === "kg" || tg.unit === "lb" ? tg.unit : unit;
  const conv = (w) => {
    if (w == null || w === "" || isNaN(w)) return null;
    return from === unit ? Number(w) : roundDisp(fromKg(toKg(Number(w), from), unit));
  };
  if (Array.isArray(tg.setList) && tg.setList.length) {
    return tg.setList.map((s) => ({ reps: s.reps ?? null, weight: conv(s.weight), rest: s.rest || null }));
  }
  const n = tg.sets || 3;
  return Array.from({ length: n }, () => ({ reps: tg.reps ?? null, weight: conv(tg.weight), rest: tg.rest || null }));
}

// The target object saved for one exercise. setList is the source of truth;
// sets/reps/weight/rest mirror set 1 for anything that only reads those.
export function buildTarget(setList, unit, supersetNext) {
  const clean = setList.map((s) => ({
    reps: s.reps == null || s.reps === "" ? null : Number(s.reps),
    weight: s.weight == null || s.weight === "" ? null : Number(s.weight),
    rest: s.rest || null
  }));
  const first = clean[0] || {};
  return {
    setList: clean, unit, supersetNext: !!supersetNext,
    sets: clean.length, reps: first.reps ?? null, weight: first.weight ?? null, rest: first.rest || null
  };
}

/* ================= exercise card ================= */

const IC = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="14" r="7"/><path d="M12 10.5V14l2 1.5M10 3h4M12 3v4"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6.5 6.5l11 11M4 9l5-5 2 2-5 5-2-2zm9 9l5-5 2 2-5 5-2-2z"/></svg>'
};
export const ICONS = IC;

export function restLabel(sec) { return fmtClock(sec || 0); }

function equipLabel(ex) {
  if (!ex) return "";
  if (ex.isCustom) return "Custom";
  const e = (ex.equipment || "").trim();
  if (!e || e === "other") return "";
  if (e === "body only") return "Bodyweight";
  if (ex.legacy) return "";
  return e.charAt(0).toUpperCase() + e.slice(1);
}

// Exercise illustration: line-art frames from Workout Guide (Bryl Lim,
// based on Everkinetic — CC BY-SA 4.0). Still = first frame; animated = the
// three frames cross-fading in a loop. Custom / old exercises get a glyph.
export const ART_CREDIT = 'Illustration: <a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener">Workout Guide</a> by Bryl Lim, based on <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>';
const artSrc = (ex, i) => `/exercise-art/${ex.art}/frame-${i}.svg`;
export function exerciseArtHtml(ex, { animate = false } = {}) {
  if (!ex || !ex.art) return `<span class="art-none">${IC.dumbbell}</span>`;
  if (!animate) return `<img class="art-img" src="${artSrc(ex, 1)}" alt="" loading="lazy" decoding="async">`;
  return `<div class="art-anim" role="img" aria-label="${escapeHtml(ex.name)} demonstration">${[1, 2, 3].map((i) => `<img src="${artSrc(ex, i)}" alt="" decoding="async">`).join("")}</div>`;
}

export function thumbHtml(ex) {
  return `<span class="xc-thumb" aria-hidden="true">${exerciseArtHtml(ex)}</span>`;
}

// opts:
//   mode     "log" (workout) | "edit" (template editor)
//   index    position in the list; ex: library entry; sets: [{ w, reps, rest, done }]
//            (w = weight already formatted for display, "" if none)
//   unit     "kg" | "lb"
//   placeholders  [{ w, reps }] per set — faint hints (last time)
//   current  index of the set in progress (log mode), or -1
//   restSi   index of the set whose rest is counting down, or -1
//
// Look: each set is one connected bar — number | weight × reps | action —
// with a status stripe on its left; rest is a thin line under the set that
// fills while it counts down. The card's left edge carries the muscle
// group's colour (same as the Muscles hit chart).
export function exerciseCardHtml(o) {
  const { mode, index, ex, sets, unit } = o;
  const isLog = mode === "log";
  const name = ex ? ex.name : "Exercise";
  const cat = (ex && ex.cat) || "";
  const color = GROUP_COLORS[cat] || "var(--accent-2)";
  const sub = [equipLabel(ex), `${sets.length} set${sets.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  const rows = sets.map((s, si) => {
    const ph = (o.placeholders && o.placeholders[si]) || {};
    const isCur = isLog && o.current === si;
    const state = s.done ? "done" : isCur ? "check" : "play";
    const act = isLog
      ? `<button type="button" class="xs-act ${state}" data-si="${si}" aria-label="${s.done ? `Set ${si + 1} done — tap to undo` : isCur ? `Finish set ${si + 1}` : `Start set ${si + 1}`}">${state === "play" ? IC.play : IC.check}</button>`
      : `<button type="button" class="xs-restbtn" data-si="${si}" aria-label="Rest after set ${si + 1}: ${restLabel(s.rest)}">${IC.timer}<span>${restLabel(s.rest)}</span></button>`;
    const running = isLog && o.restSi === si;
    const restLine = isLog ? `
      <div class="xs-restline${running ? " running" : ""}">
        <span class="xs-resttrack" aria-hidden="true"><i></i></span>
        <button type="button" class="xs-restchip${running ? " running" : ""}" data-si="${si}" aria-label="Rest after set ${si + 1}">${restLabel(s.rest)}</button>
      </div>` : "";
    return `
      <div class="xs-row ${state}${isCur ? " current" : ""}" data-si="${si}">
        <button type="button" class="xs-num" data-si="${si}" aria-label="Set ${si + 1} — tap to delete">${si + 1}</button>
        <label class="xs-field"><input type="text" inputmode="decimal" autocomplete="off" class="xs-kg" data-si="${si}" value="${escapeHtml(s.w ?? "")}" placeholder="${escapeHtml(ph.w ?? "–")}" aria-label="Set ${si + 1} weight (${unit})"><span${!s.w && ph.w === "BW" ? ' class="xs-unit-bw"' : ""}>${unit}</span></label>
        <span class="xs-x" aria-hidden="true">×</span>
        <label class="xs-field"><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="xs-reps" data-si="${si}" value="${s.reps ?? ""}" placeholder="${escapeHtml(ph.reps ?? "–")}" aria-label="Set ${si + 1} reps"><span>reps</span></label>
        ${act}
      </div>${restLine}`;
  }).join("");

  return `
    <div class="xcard${o.linkedPrev ? " linked-prev" : ""}${o.linkedNext ? " linked-next" : ""}" data-exi="${index}" style="--mc:${color}">
      <div class="xc-head">
        ${thumbHtml(ex)}
        <div class="xc-title">
          ${cat ? `<span class="xc-cat">${escapeHtml(cat)}</span>` : ""}
          <h3>${escapeHtml(name)}</h3>
          <span class="xc-sub">${escapeHtml(sub)}</span>
        </div>
        <div class="xc-tools">
          <button type="button" class="xc-icon xc-prog" aria-label="Progression for ${escapeHtml(name)}">${IC.chart}</button>
          <button type="button" class="xc-icon xc-rest" aria-label="Rest time for every set of ${escapeHtml(name)}">${IC.timer}</button>
          <button type="button" class="xc-icon xc-menu" aria-label="More options for ${escapeHtml(name)}">${IC.dots}</button>
        </div>
      </div>
      <div class="xc-sets">${rows || '<p class="faint xc-empty">No sets yet.</p>'}</div>
      <button type="button" class="xc-add">${IC.plus}Add set</button>
    </div>`;
}

// Between card i and i+1: link the two as a superset (alternate their sets,
// rest after each round).
export function chainHtml(i, linked) {
  return `<div class="xchain${linked ? " on" : ""}"><button type="button" class="xchain-btn" data-exi="${i}" aria-pressed="${linked}" aria-label="${linked ? "Unlink superset" : "Make a superset with the next exercise"}">${IC.link}<span>${linked ? "Superset" : "Link as superset"}</span></button></div>`;
}

/* ================= dialogs ================= */

// Shows `inner` in the app's dialog layer (above sheets and the photo
// viewer). setup(card, done) wires it up; done(value) closes and resolves.
// Backdrop tap / Escape resolves null.
export function openDialog(inner, setup) {
  const dlg = document.getElementById("dialog");
  return new Promise((resolve) => {
    dlg.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true">${inner}</div>`;
    dlg.hidden = false;
    const done = (val) => {
      dlg.hidden = true;
      dlg.innerHTML = "";
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);
    dlg.onclick = (e) => { if (e.target === dlg) done(null); };
    setup(dlg.querySelector(".dialog-card"), done);
  });
}

// choices: [{ label, value, style: "primary" | "danger" | "secondary" }]
// Resolves the chosen value, or null if dismissed.
export function choiceDialog({ title, message = "", choices }) {
  const btns = choices.map((c, i) => `<button class="btn ${c.style === "danger" ? "btn-danger" : c.style === "primary" ? "btn-primary" : "btn-secondary"}" data-i="${i}">${escapeHtml(c.label)}</button>`).join("");
  return openDialog(`
    <h3 id="dialogTitle">${escapeHtml(title)}</h3>
    ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ""}
    <div class="dialog-actions${choices.length > 2 ? " stacked" : ""}">${btns}</div>`, (card, done) => {
    card.setAttribute("aria-labelledby", "dialogTitle");
    card.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => done(choices[+b.getAttribute("data-i")].value)));
    // Focus the last-listed "safe" choice first if there is one.
    const safe = [...card.querySelectorAll("[data-i]")].find((b) => choices[+b.getAttribute("data-i")].style === "secondary");
    (safe || card.querySelector("[data-i]")).focus();
  });
}

const REST_CHOICES = [30, 60, 90, 120, 150, 180, 240, 300];

// Resolves the chosen rest in seconds, or null if dismissed.
export function pickRest(current, title = "Rest time") {
  let sec = current || 90;
  return openDialog(`
    <h3>${escapeHtml(title)}</h3>
    <div class="rest-pick">
      <button type="button" class="rp-step" data-d="-15" aria-label="15 seconds less">−15</button>
      <span class="rp-val" aria-live="polite">${restLabel(sec)}</span>
      <button type="button" class="rp-step" data-d="15" aria-label="15 seconds more">+15</button>
    </div>
    <div class="rp-chips">${REST_CHOICES.map((s) => `<button type="button" class="pick-chip${s === sec ? " active" : ""}" data-s="${s}">${restLabel(s)}</button>`).join("")}</div>
    <div class="dialog-actions"><button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" data-ok>Set</button></div>`, (card, done) => {
    const out = card.querySelector(".rp-val");
    const sync = () => {
      out.textContent = restLabel(sec);
      card.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("active", +b.getAttribute("data-s") === sec));
    };
    card.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => { sec = Math.max(0, Math.min(900, sec + +b.getAttribute("data-d"))); sync(); }));
    card.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => { sec = +b.getAttribute("data-s"); sync(); }));
    card.querySelector("[data-x]").addEventListener("click", () => done(null));
    card.querySelector("[data-ok]").addEventListener("click", () => done(sec));
    card.querySelector("[data-ok]").focus();
  });
}

// Resolves "up" | "down" | "replace" | "rest" | "remove" | null.
export function exerciseMenu(name, { canUp, canDown }) {
  const item = (v, label, cls = "", disabled = false) => `<button type="button" class="menu-item${cls}" data-v="${v}"${disabled ? " disabled" : ""}>${label}</button>`;
  return openDialog(`
    <h3>${escapeHtml(name)}</h3>
    <div class="menu-list">
      ${item("up", "Move up", "", !canUp)}
      ${item("down", "Move down", "", !canDown)}
      ${item("replace", "Replace exercise")}
      ${item("rest", "Rest time for all sets")}
      ${item("remove", "Remove exercise", " danger")}
    </div>
    <button class="btn btn-secondary btn-block" data-x>Cancel</button>`, (card, done) => {
    card.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => done(b.getAttribute("data-v"))));
    card.querySelector("[data-x]").addEventListener("click", () => done(null));
    card.querySelector("[data-x]").focus();
  });
}

/* ================= progression ================= */

// Best set (kg) per session for exId, oldest first.
export function exerciseSeries(history, exId, metric = "weight") {
  const pts = [];
  history.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((sess) => sess.exercises.forEach((ex) => {
    if (ex.exerciseId !== exId) return;
    const value = metric === "weight"
      ? ex.sets.reduce((m, s) => Math.max(m, s.kg || 0), 0)
      : ex.sets.reduce((sum, s) => sum + (s.kg || 0) * (s.reps || 0), 0);
    pts.push({ date: sess.date, value });
  }));
  return pts;
}

// kit: { history, unit, name }
export function openProgression(kit, exId) {
  const sessions = [];
  for (const sess of kit.history) {
    const ex = sess.exercises.find((e) => e.exerciseId === exId);
    if (ex) sessions.push({ date: sess.date, sets: ex.sets });
    if (sessions.length >= 5) break;
  }
  const setStr = (s) => `${s.kg ? fmtNum(fromKg(s.kg, kit.unit)) : "BW"}×${s.reps}`;
  const listHtml = sessions.length
    ? `<div class="prog-list">${sessions.map((s) => `<div class="prog-row"><span class="faint">${fmtShort(s.date)}</span><span>${escapeHtml(s.sets.map(setStr).join(", "))}</span></div>`).join("")}</div>`
    : "";
  return openDialog(`
    <h3>${escapeHtml(kit.name)}</h3>
    ${sessions.length ? `<p class="faint">Best set per workout (${kit.unit})</p><div class="chart-wrap prog-chart"></div><p class="faint">Recent workouts</p>${listHtml}` : `<p class="muted">No history yet — log this exercise once and your progress shows up here.</p>`}
    <button class="btn btn-secondary btn-block" data-x>Close</button>`, (card, done) => {
    const wrap = card.querySelector(".prog-chart");
    if (wrap) drawChart(wrap, exerciseSeries(kit.history, exId), "weight", kit.unit);
    card.querySelector("[data-x]").addEventListener("click", () => done(null));
  });
}
