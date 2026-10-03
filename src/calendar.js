// Calendar tab: a monthly grid of your + your friends' gym visits, a
// day-detail sheet (workout cards + a BeReal-style photo/video feed with a
// full-screen viewer), and "propose a time" sessions friends can join.

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function dateKeyFromDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function dateKeyFromIso(iso) { return dateKeyFromDate(new Date(iso)); }

function fmtWhen(iso) {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  const mm = d.getMinutes() < 10 ? "0" + d.getMinutes() : d.getMinutes();
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${h}:${mm}${ampm}`;
}

let viewMonth = null;

export async function renderCalendar(ctx) {
  const el = document.getElementById("tab-calendar");
  if (!el) return;
  if (!viewMonth) {
    const n = new Date();
    viewMonth = new Date(n.getFullYear(), n.getMonth(), 1);
  }
  el.innerHTML = `<div class="card"><p class="muted">Loading calendar…</p></div>`;

  if (!ctx.state.friends) {
    try { ctx.state.friends = await ctx.db.listFriendships(ctx.user.id); }
    catch (e) { ctx.state.friends = { accepted: [], incoming: [], outgoing: [] }; }
  }
  const friendIds = ctx.state.friends.accepted.map((r) => r.otherId);
  const allIds = [ctx.user.id, ...friendIds];
  const nameById = { [ctx.user.id]: "You" };
  ctx.state.friends.accepted.forEach((r) => { nameById[r.otherId] = r.otherProfile.display_name || "Friend"; });

  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const startIso = new Date(year, month, 1).toISOString();
  const endIso = new Date(year, month + 1, 1).toISOString();
  const startDateStr = `${year}-${pad2(month + 1)}-01`;
  const endDateStr = `${year}-${pad2(month + 1)}-${pad2(new Date(year, month + 1, 0).getDate())}`;

  let workouts = [], posts = [], plans = [];
  try {
    [workouts, posts, plans] = await Promise.all([
      ctx.db.listWorkoutsInRange(allIds, startIso, endIso),
      ctx.db.listDayPosts(allIds, startDateStr, endDateStr),
      ctx.db.listGymPlans(ctx.user.id, friendIds)
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="muted">Couldn't load the calendar: ${ctx.escapeHtml(err.message || String(err))}</p></div>`;
    return;
  }

  const workoutsByDay = {};
  workouts.forEach((w) => { const k = dateKeyFromIso(w.date); (workoutsByDay[k] = workoutsByDay[k] || []).push(w); });
  const postsByDay = {};
  posts.forEach((p) => { (postsByDay[p.date] = postsByDay[p.date] || []).push(p); });

  draw();

  function draw() {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = new Date(year, month, 1).getDay();
    const today = dateKeyFromDate(new Date());

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      const dw = workoutsByDay[key] || [];
      const youWent = dw.some((w) => w.userId === ctx.user.id);
      const friendWent = dw.some((w) => w.userId !== ctx.user.id);
      const hasMedia = (postsByDay[key] || []).length > 0;
      cells += `
        <button class="cal-cell${key === today ? " today" : ""}" data-key="${key}">
          <span class="cal-daynum">${d}</span>
          <span class="cal-dots">
            ${youWent ? '<span class="cal-dot you"></span>' : ""}
            ${friendWent ? '<span class="cal-dot friend"></span>' : ""}
            ${hasMedia ? '<span class="cal-cam">●</span>' : ""}
          </span>
        </button>`;
    }

    el.innerHTML = `
      <div class="card cal-header">
        <button class="icon-btn" id="prevMonthBtn" title="Previous month" aria-label="Previous month">‹</button>
        <h2>${MONTH_NAMES[month]} ${year}</h2>
        <button class="icon-btn" id="nextMonthBtn" title="Next month" aria-label="Next month">›</button>
      </div>
      <div class="cal-wrap">
        <div class="cal-dow-row">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="section-label">Plan a session</div>
      ${renderPlans(plans)}
    `;

    document.getElementById("prevMonthBtn").addEventListener("click", () => { viewMonth = new Date(year, month - 1, 1); renderCalendar(ctx); });
    document.getElementById("nextMonthBtn").addEventListener("click", () => { viewMonth = new Date(year, month + 1, 1); renderCalendar(ctx); });
    el.querySelectorAll(".cal-cell[data-key]").forEach((b) => {
      const key = b.getAttribute("data-key");
      b.addEventListener("click", () => openDaySheet(ctx, key, workoutsByDay[key] || [], postsByDay[key] || [], nameById, (posts) => {
        // Added/deleted photo or video: update that day's camera dot right away.
        postsByDay[key] = posts.slice();
        draw();
      }));
    });
    bindPlans();
  }

  function renderPlans(plansList) {
    const newBtnHtml = `<button class="btn btn-secondary btn-block" id="newPlanBtn">+ Propose a time</button>`;
    // A proposal disappears on its own once its time has passed — no one
    // needs to clean up yesterday's "gym at 6?".
    const upcoming = plansList.filter((p) => p.options[0] && new Date(p.options[0].startsAt).getTime() > Date.now());
    if (!upcoming.length) return `<div class="card"><p class="muted">No upcoming sessions proposed.</p></div>${newBtnHtml}`;
    const cardsHtml = upcoming.map((p) => {
      const opt = p.options[0];
      const isCreator = p.creatorId === ctx.user.id;
      // "in" / "out" / null (not answered yet)
      const reply = opt.voterIds.includes(ctx.user.id) ? "in" : opt.declinedIds.includes(ctx.user.id) ? "out" : null;
      const inNames = opt.voterIds.map((id) => nameById[id] || "Someone");
      const outNames = opt.declinedIds.map((id) => nameById[id] || "Someone");
      const host = isCreator ? "Your session" : `Proposed by ${nameById[p.creatorId] || "a friend"}`;
      const replyBtns = isCreator ? "" : `
        <div class="plan-reply" role="group" aria-label="Can you make it?">
          <button class="btn btn-sm plan-reply-btn${reply === "in" ? " on-in" : ""}" data-plan="${p.id}" data-opt="${opt.id}" data-reply="in" data-current="${reply || ""}" aria-pressed="${reply === "in"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>I'm in
          </button>
          <button class="btn btn-sm plan-reply-btn${reply === "out" ? " on-out" : ""}" data-plan="${p.id}" data-opt="${opt.id}" data-reply="out" data-current="${reply || ""}" aria-pressed="${reply === "out"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>Can't make it
          </button>
        </div>`;
      return `<div class="plan-card${reply === "in" ? " joined" : ""}">
        <div class="plan-card-head">
          <div>
            <h4>${ctx.escapeHtml(p.title)}</h4>
            <div class="plan-when">${fmtWhen(opt.startsAt)}</div>
            <span class="faint">${ctx.escapeHtml(host)}</span>
            ${p.templateName ? `<span class="plan-tpl-badge">${ctx.escapeHtml(p.templateName)}</span>` : ""}
          </div>
          ${isCreator ? `<button class="icon-btn del-plan" data-id="${p.id}" title="Cancel session" aria-label="Cancel session"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
        </div>
        ${replyBtns}
        <div class="plan-who">
          <p><span class="plan-who-label in">In</span>${inNames.length ? ctx.escapeHtml(inNames.join(", ")) : '<span class="muted">No one yet</span>'}</p>
          ${outNames.length ? `<p><span class="plan-who-label out">Can't</span>${ctx.escapeHtml(outNames.join(", "))}</p>` : ""}
        </div>
      </div>`;
    }).join("");
    return `<div class="plan-list">${cardsHtml}</div>` + newBtnHtml;
  }

  function bindPlans() {
    const newBtn = document.getElementById("newPlanBtn");
    if (newBtn) newBtn.addEventListener("click", () => openNewPlanSheet(ctx, () => renderCalendar(ctx)));
    // Tapping your current answer again clears it ("back out").
    el.querySelectorAll(".plan-reply-btn").forEach((b) => b.addEventListener("click", async () => {
      const planId = b.getAttribute("data-plan"), optId = b.getAttribute("data-opt");
      const want = b.getAttribute("data-reply"), current = b.getAttribute("data-current") || null;
      b.closest(".plan-reply").querySelectorAll("button").forEach((x) => { x.disabled = true; });
      try {
        if (current === want) {
          await ctx.db.clearGymPlanReply(optId, ctx.user.id);
          ctx.toast(want === "in" ? "You've backed out" : "Reply cleared");
        } else {
          await ctx.db.setGymPlanReply(planId, optId, ctx.user.id, want === "in", !!current);
          ctx.toast(want === "in" ? "You're in" : "Got it — you can't make it");
        }
        renderCalendar(ctx);
      } catch (err) {
        ctx.toast(err.message && /migration_6/.test(err.message) ? err.message : "Couldn't update your reply");
        renderCalendar(ctx);
      }
    }));
    el.querySelectorAll(".del-plan").forEach((b) => b.addEventListener("click", async () => {
      const ok = await ctx.confirm({
        title: "Cancel this session?",
        message: "Everyone who said they're in will be notified.",
        confirmText: "Cancel session",
        cancelText: "Keep it",
        danger: true
      });
      if (!ok) return;
      try { await ctx.db.deleteGymPlan(b.getAttribute("data-id")); ctx.toast("Session cancelled"); renderCalendar(ctx); }
      catch (err) { ctx.toast("Couldn't cancel that"); }
    }));
  }
}

function timeLabel(mins) {
  let h = Math.floor(mins / 60), m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m < 10 ? "0" : ""}${m} ${ampm}`;
}

const TITLE_IDEAS = ["Gym session", "Push day", "Pull day", "Leg day", "Upper body", "Cardio"];
const TIME_PRESETS = [
  { label: "Morning", mins: 7 * 60 },
  { label: "Lunch", mins: 12 * 60 },
  { label: "After work", mins: 17 * 60 + 30 },
  { label: "Evening", mins: 19 * 60 }
];
const STRIP_DAYS = 14;

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function hhmm(mins) { return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`; }

// Built for thumbs: tap a day from a scrolling row (or "More dates" for
// anything further out), set the time with big −/+ buttons, a preset, or by
// tapping the time to get the phone's own time wheel. No sliders — they
// fought with the sheet's pull-to-close gesture and were fiddly to hit.
function openNewPlanSheet(ctx, onDone) {
  const { openSheet, closeSheet, toast, escapeHtml, state } = ctx;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const now = new Date();
  const todayKey = dateKeyFromDate(now);
  let minutes = 18 * 60; // 6:00 PM
  // Too late for 6 PM today → default to tomorrow.
  let dayKey = now.getHours() * 60 + now.getMinutes() > minutes - 15 ? dateKeyFromDate(addDays(now, 1)) : todayKey;
  let showMoreDates = false;

  function keyToDate(key) { return new Date(key + "T00:00:00"); }
  function chosenDate() {
    const dt = keyToDate(dayKey);
    dt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return dt;
  }
  function dayName(key) {
    if (key === todayKey) return "Today";
    if (key === dateKeyFromDate(addDays(now, 1))) return "Tomorrow";
    const d = keyToDate(key);
    return `${DAYS[d.getDay()]}, ${MONS[d.getMonth()]} ${d.getDate()}`;
  }

  function draw() {
    const pills = [];
    for (let i = 0; i < STRIP_DAYS; i++) {
      const d = addDays(now, i);
      const key = dateKeyFromDate(d);
      const top = i === 0 ? "Today" : i === 1 ? "Tmrw" : DAYS[d.getDay()];
      pills.push(`<button type="button" class="day-pill" data-key="${key}" aria-label="${dayName(key)}">
        <span class="dp-top">${top}</span><span class="dp-num">${d.getDate()}</span><span class="dp-mon">${MONS[d.getMonth()]}</span>
      </button>`);
    }
    const tplOptsHtml = `<option value="">No specific template</option>` +
      (state.templates || []).map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");

    openSheet(`
      <div class="sheet-title"><h3>Propose a Time</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>

      <div class="field">
        <label for="planTitleInput">What</label>
        <input type="text" id="planTitleInput" placeholder="e.g. Leg day" maxlength="60" value="Gym session" autocomplete="off">
        <div class="chip-wrap" id="titleChips">
          ${TITLE_IDEAS.map((t) => `<button type="button" class="pick-chip" data-title="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Day</span>
        <div class="day-strip" id="dayStrip" data-nodrag>
          ${pills.join("")}
        </div>
        <button type="button" class="link-btn more-dates-btn" id="moreDatesBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span id="moreDatesLabel">Pick a later date</span>
        </button>
        <div class="more-dates" id="moreDates" hidden>
          <input type="date" class="date-native" id="planDateInput" min="${todayKey}" value="${dayKey}" aria-label="Pick a date">
        </div>
      </div>

      <div class="field">
        <span class="field-label">Time</span>
        <div class="time-picker">
          <button type="button" class="tp-step" data-step="-15" aria-label="15 minutes earlier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>
          </button>
          <label class="tp-display">
            <span class="tp-time" id="tpTime"></span>
            <span class="tp-hint">Tap to choose</span>
            <input type="time" id="tpNative" step="300" aria-label="Time">
          </label>
          <button type="button" class="tp-step" data-step="15" aria-label="15 minutes later">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="preset-grid" id="timePresets">
          ${TIME_PRESETS.map((p) => `<button type="button" class="pick-chip preset" data-mins="${p.mins}"><span>${p.label}</span><span class="faint">${timeLabel(p.mins)}</span></button>`).join("")}
        </div>
      </div>

      <div class="field">
        <label for="planTplSelect">Workout (optional)</label>
        <select id="planTplSelect">${tplOptsHtml}</select>
      </div>

      <div class="plan-summary" id="planSummary" aria-live="polite"></div>
      <button class="btn btn-primary btn-block" id="savePlanBtn">Propose to friends</button>
    `);

    document.getElementById("sheetClose").addEventListener("click", closeSheet);

    const titleInput = document.getElementById("planTitleInput");
    titleInput.addEventListener("input", refresh);
    document.querySelectorAll("#titleChips .pick-chip").forEach((b) => b.addEventListener("click", () => {
      titleInput.value = b.getAttribute("data-title");
      refresh();
    }));

    document.querySelectorAll("#dayStrip .day-pill[data-key]").forEach((b) => b.addEventListener("click", () => {
      dayKey = b.getAttribute("data-key");
      showMoreDates = false;
      refresh();
    }));
    document.getElementById("moreDatesBtn").addEventListener("click", () => {
      showMoreDates = !showMoreDates;
      refresh();
      if (showMoreDates) {
        const inp = document.getElementById("planDateInput");
        try { inp.showPicker(); } catch (e) { inp.focus(); }
      }
    });
    document.getElementById("planDateInput").addEventListener("change", (e) => {
      if (e.target.value) { dayKey = e.target.value; refresh(); }
    });

    // −/+ step 15 min; hold to keep going.
    document.querySelectorAll(".tp-step").forEach((b) => {
      const step = parseInt(b.getAttribute("data-step"), 10);
      let holdT = null, repT = null;
      const stop = () => { clearTimeout(holdT); clearInterval(repT); holdT = repT = null; };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        nudge(step);
        holdT = setTimeout(() => { repT = setInterval(() => nudge(step), 110); }, 400);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, stop));
      // Keyboard (Enter/Space) still works; pointer taps are handled above.
      b.addEventListener("click", (e) => { if (e.detail === 0) nudge(step); });
    });
    document.getElementById("tpNative").addEventListener("change", (e) => {
      const [h, m] = (e.target.value || "").split(":").map((n) => parseInt(n, 10));
      if (!isNaN(h) && !isNaN(m)) { minutes = h * 60 + m; refresh(); }
    });
    document.querySelectorAll("#timePresets .preset").forEach((b) => b.addEventListener("click", () => {
      minutes = parseInt(b.getAttribute("data-mins"), 10);
      refresh();
    }));

    document.getElementById("planTplSelect").addEventListener("change", (e) => {
      // Picking a workout names the session after it, unless a title was typed.
      const v = e.target.value;
      if (v && (!titleInput.value.trim() || TITLE_IDEAS.includes(titleInput.value.trim()))) titleInput.value = v;
      refresh();
    });

    document.getElementById("savePlanBtn").addEventListener("click", save);
    refresh();
    // Start with the chosen day centred (Today/Tomorrow just show the start).
    const strip = document.getElementById("dayStrip");
    const sel = strip.querySelector(".day-pill.active");
    if (sel) strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2);
  }

  function nudge(step) {
    minutes = Math.min(23 * 60 + 45, Math.max(0, Math.round((minutes + step) / 15) * 15));
    refresh();
  }

  // Updates the sheet in place (no re-render, so nothing jumps or loses focus).
  function refresh() {
    const inStrip = !!document.querySelector(`#dayStrip .day-pill[data-key="${dayKey}"]`);
    document.querySelectorAll("#dayStrip .day-pill[data-key]").forEach((b) => {
      const on = b.getAttribute("data-key") === dayKey;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on);
    });
    document.getElementById("moreDatesLabel").textContent = inStrip ? "Pick a later date" : "Change date";
    document.getElementById("moreDates").hidden = !(showMoreDates || !inStrip);
    document.getElementById("planDateInput").value = dayKey;

    document.getElementById("tpTime").textContent = timeLabel(minutes);
    document.getElementById("tpNative").value = hhmm(minutes);
    document.querySelectorAll("#timePresets .preset").forEach((b) => b.classList.toggle("active", parseInt(b.getAttribute("data-mins"), 10) === minutes));

    const title = document.getElementById("planTitleInput").value.trim();
    document.querySelectorAll("#titleChips .pick-chip").forEach((b) => b.classList.toggle("active", b.getAttribute("data-title") === title));

    const past = chosenDate().getTime() <= Date.now();
    const summary = document.getElementById("planSummary");
    summary.classList.toggle("warn", past);
    summary.innerHTML = past
      ? "That time has already passed — pick a later time or day."
      : `<strong>${escapeHtml(title || "Gym session")}</strong> · ${dayName(dayKey)} at ${timeLabel(minutes)}`;
    document.getElementById("savePlanBtn").disabled = past;
  }

  async function save() {
    const title = document.getElementById("planTitleInput").value.trim() || "Gym session";
    const dt = chosenDate();
    if (dt.getTime() <= Date.now()) { toast("Pick a time in the future"); return; }
    const templateName = document.getElementById("planTplSelect").value || null;
    const btn = document.getElementById("savePlanBtn");
    btn.disabled = true; btn.textContent = "Proposing…";
    try {
      await ctx.db.createGymPlan(ctx.user.id, title, dt.toISOString(), templateName);
      closeSheet();
      toast("Session proposed — your friends will be notified");
      onDone();
    } catch (err) {
      toast("Couldn't propose that: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = "Propose to friends";
    }
  }

  draw();
}

const CAT_CLASS = { Chest: "c-chest", Back: "c-back", Legs: "c-legs", Shoulders: "c-shoulders", Arms: "c-arms", Core: "c-core" };

function prettyDate(dateKey) {
  const d = new Date(dateKey + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); // English to match the rest of the UI
}

// Full-screen, in-app photo/video viewer — tap a tile to open, swipe or use
// the arrows to move between that day's media, tap outside / X / Esc to
// close. Nothing is downloaded or saved to the phone's photo library.
// Your own photos/videos get a Delete button; onDelete(item) does the work.
function openLightbox(ctx, items, startIndex, onDelete) {
  let i = startIndex;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  document.body.appendChild(box);
  document.body.style.overflow = "hidden";

  function close() {
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    box.remove();
  }
  function go(delta) {
    if (items.length < 2) return;
    i = (i + delta + items.length) % items.length;
    draw();
  }
  function onKey(e) {
    if (!document.getElementById("dialog").hidden) return; // the "Delete?" prompt has the keyboard
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }
  function draw() {
    const it = items[i];
    box.innerHTML = `
      <button class="lb-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="lb-stage">
        ${it.mediaType === "video"
          ? `<video src="${it.mediaUrl}" controls autoplay playsinline></video>`
          : `<img src="${it.mediaUrl}" alt="Photo from ${ctx.escapeHtml(it.who)}">`}
      </div>
      <div class="lb-caption">
        <span>${ctx.escapeHtml(it.who)}${items.length > 1 ? ` · ${i + 1} / ${items.length}` : ""}</span>
        ${onDelete && it.userId === ctx.user.id ? `<button class="lb-del" aria-label="Delete this ${it.mediaType === "video" ? "video" : "photo"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg>Delete</button>` : ""}
      </div>
      ${items.length > 1 ? `
        <button class="lb-nav lb-prev" aria-label="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="lb-nav lb-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}
    `;
    box.querySelector(".lb-close").addEventListener("click", close);
    const prev = box.querySelector(".lb-prev"), next = box.querySelector(".lb-next");
    if (prev) prev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    if (next) next.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
    const del = box.querySelector(".lb-del");
    if (del) del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const kind = it.mediaType === "video" ? "video" : "photo";
      const ok = await ctx.confirm({
        title: `Delete this ${kind}?`,
        message: `It's removed for you and your friends. This can't be undone.`,
        confirmText: `Delete ${kind}`,
        cancelText: "Keep it",
        danger: true
      });
      if (!ok) return;
      del.disabled = true; del.lastChild.textContent = "Deleting…";
      try {
        await onDelete(it);
        items.splice(i, 1);
        ctx.toast(`${kind[0].toUpperCase() + kind.slice(1)} deleted`);
        if (!items.length) { close(); return; }
        i = Math.min(i, items.length - 1);
        draw();
      } catch (err) {
        ctx.toast("Couldn't delete that: " + (err.message || String(err)));
        del.disabled = false; del.lastChild.textContent = "Delete";
      }
    });
  }

  // Tap the dark backdrop to close; horizontal swipe to change photo.
  box.addEventListener("click", (e) => { if (e.target === box || e.target.classList.contains("lb-stage")) close(); });
  let sx = null, sy = null;
  box.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });
  document.addEventListener("keydown", onKey);
  draw();
}

// Supabase Storage's default per-file limit on the free plan.
const MAX_UPLOAD_MB = 50;

// onPostsChanged(posts) tells the calendar grid the day's media changed.
function openDaySheet(ctx, dateKey, dayWorkouts, initialPosts, nameById, onPostsChanged) {
  const { openSheet, closeSheet, toast, escapeHtml } = ctx;
  const unit = ctx.state.unit;

  function catsFor(w) {
    return [...new Set(w.exercises.map((e) => ctx.exCat(e.exerciseId)).filter(Boolean))];
  }

  function workoutCard(w) {
    const who = nameById[w.userId] || "Someone";
    const initial = who.trim().charAt(0).toUpperCase() || "?";
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    const volKg = w.exercises.reduce((n, e) => n + e.sets.reduce((m, st) => m + (st.kg || 0) * (st.reps || 0), 0), 0);
    const vol = ctx.fromKg(volKg, unit);
    const volStr = vol >= 1000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(vol) : Math.round(vol);
    const cats = catsFor(w);
    const exRows = w.exercises.map((e) => {
      const top = e.sets.reduce((b, st) => (!b || st.kg > b.kg ? st : b), null);
      const topStr = !top ? "—" : top.kg ? `${ctx.fmtNum(ctx.fromKg(top.kg, unit))} ${unit}` : "bodyweight";
      return `<li><span class="dw-ex">${escapeHtml(e.name)}</span><span class="dw-sets">${e.sets.length} × ${topStr}</span></li>`;
    }).join("");
    return `
      <article class="dw-card${w.userId === ctx.user.id ? " mine" : ""}">
        <header class="dw-head">
          <span class="dw-avatar">${escapeHtml(initial)}</span>
          <div class="dw-who">
            <div class="dw-name">${escapeHtml(who)}</div>
            <div class="dw-cats">${cats.map((c) => `<span class="cat-pill ${CAT_CLASS[c] || ""}">${escapeHtml(c)}</span>`).join("")}</div>
          </div>
        </header>
        <div class="dw-stats">
          <div><span class="v">${ctx.fmtDuration(w.durationSec)}</span><span class="l">Time</span></div>
          <div><span class="v">${sets}</span><span class="l">Sets</span></div>
          <div><span class="v">${volStr}</span><span class="l">Volume (${unit})</span></div>
        </div>
        <ul class="dw-list">${exRows}</ul>
      </article>`;
  }

  function draw(posts) {
    const whoHtml = dayWorkouts.length
      ? dayWorkouts.map(workoutCard).join("")
      : '<div class="card"><p class="muted">No workouts logged this day.</p></div>';

    const mediaHtml = posts.length ? `<div class="media-grid">${posts.map((p, idx) => `
      <button class="media-tile" data-idx="${idx}" aria-label="Open ${p.mediaType === "video" ? "video" : "photo"} full screen">
        ${p.mediaType === "video" ? `<video src="${p.mediaUrl}" muted playsinline preload="metadata"></video><span class="media-play">▶</span>` : `<img src="${p.mediaUrl}" alt="">`}
        <span class="media-who">${escapeHtml(nameById[p.userId] || "Someone")}</span>
      </button>`).join("")}</div>` : '<p class="muted">No photos or videos yet.</p>';

    openSheet(`
      <div class="sheet-title"><h3>${escapeHtml(prettyDate(dateKey))}</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="stack">
      <div class="section-label">Workouts</div>
      <div class="dw-stack">${whoHtml}</div>
      <div class="section-label">Photos &amp; videos</div>
      <div class="card">
        ${mediaHtml}
        <input type="file" id="dayMediaInput" accept="image/*,video/*" hidden>
        <button class="btn btn-secondary btn-block" id="addMediaBtn">+ Add a photo or video</button>
        <p class="faint">Only you and your friends can see photos and videos posted here. Tap one of yours to view or delete it.</p>
      </div>
      </div>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    const lbItems = posts.map((p) => ({ ...p, who: nameById[p.userId] || "Someone" }));
    let current = posts;
    const onDelete = async (item) => {
      await ctx.db.deleteDayPost(item.id, item.mediaUrl);
      current = current.filter((p) => p.id !== item.id);
      draw(current);
      if (onPostsChanged) onPostsChanged(current);
    };
    document.querySelectorAll(".media-tile[data-idx]").forEach((t) => t.addEventListener("click", () => openLightbox(ctx, lbItems, parseInt(t.getAttribute("data-idx"), 10), onDelete)));
    document.getElementById("addMediaBtn").addEventListener("click", () => document.getElementById("dayMediaInput").click());
    document.getElementById("dayMediaInput").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // lets the same file be picked again after an error
      if (!file) return;
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        toast(`That file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ${MAX_UPLOAD_MB} MB. Try a shorter video.`);
        return;
      }
      const btn = document.getElementById("addMediaBtn");
      btn.disabled = true; btn.textContent = "Uploading…";
      try {
        const { url, type } = await ctx.db.uploadDayMedia(ctx.user.id, file);
        const post = await ctx.db.addDayPost(ctx.user.id, dateKey, url, type, "");
        const next = [post, ...posts];
        draw(next);
        if (onPostsChanged) onPostsChanged(next);
        toast("Added");
      } catch (err) {
        toast("Couldn't upload: " + (err.message || String(err)));
        btn.disabled = false; btn.textContent = "+ Add a photo or video";
      }
    });
  }

  draw(initialPosts);
}
