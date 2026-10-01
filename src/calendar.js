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
      b.addEventListener("click", () => openDaySheet(ctx, key, workoutsByDay[key] || [], postsByDay[key] || [], nameById));
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
      if (!confirm("Cancel this session? Everyone who's in will be notified.")) return;
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

// One date, one time (picked with a slider), one optional template — kept
// deliberately simple so proposing a session is a 10-second, no-friction
// action instead of a small poll-building exercise.
function openNewPlanSheet(ctx, onDone) {
  const { openSheet, closeSheet, toast, escapeHtml, state } = ctx;
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  let minutes = 18 * 60; // default 6:00 PM

  function draw() {
    const tplOptsHtml = `<option value="">No specific template</option>` +
      (state.templates || []).map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
    openSheet(`
      <div class="sheet-title"><h3>Propose a Time</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><label>Title</label><input type="text" id="planTitleInput" placeholder="e.g. Leg day?" value="Gym session"></div>
      <div class="field"><label>Date</label><input type="date" id="planDateInput" value="${dateStr}"></div>
      <div class="field">
        <label>Time — <span id="timeLabelOut">${timeLabel(minutes)}</span></label>
        <input type="range" id="planTimeSlider" class="time-slider" min="300" max="1380" step="15" value="${minutes}">
      </div>
      <div class="field"><label>Template (optional)</label><select id="planTplSelect">${tplOptsHtml}</select></div>
      <button class="btn btn-primary btn-block" id="savePlanBtn">Propose</button>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("planTimeSlider").addEventListener("input", (e) => {
      minutes = parseInt(e.target.value, 10);
      document.getElementById("timeLabelOut").textContent = timeLabel(minutes);
    });
    document.getElementById("savePlanBtn").addEventListener("click", save);
  }

  async function save() {
    const title = document.getElementById("planTitleInput").value.trim() || "Gym session";
    const dateVal = document.getElementById("planDateInput").value;
    if (!dateVal) { toast("Pick a date"); return; }
    const dt = new Date(dateVal + "T00:00:00");
    dt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const templateName = document.getElementById("planTplSelect").value || null;
    const btn = document.getElementById("savePlanBtn");
    btn.disabled = true; btn.textContent = "Proposing…";
    try {
      await ctx.db.createGymPlan(ctx.user.id, title, dt.toISOString(), templateName);
      closeSheet();
      toast("Session proposed");
      onDone();
    } catch (err) {
      toast("Couldn't propose that: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = "Propose";
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
function openLightbox(ctx, items, startIndex) {
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
      <div class="lb-caption">${ctx.escapeHtml(it.who)}${items.length > 1 ? ` · ${i + 1} / ${items.length}` : ""}</div>
      ${items.length > 1 ? `
        <button class="lb-nav lb-prev" aria-label="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="lb-nav lb-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}
    `;
    box.querySelector(".lb-close").addEventListener("click", close);
    const prev = box.querySelector(".lb-prev"), next = box.querySelector(".lb-next");
    if (prev) prev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    if (next) next.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
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

function openDaySheet(ctx, dateKey, dayWorkouts, initialPosts, nameById) {
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
      return `<li><span class="dw-ex">${escapeHtml(e.name)}</span><span class="dw-sets">${e.sets.length} × ${top ? `${ctx.fmtNum(ctx.fromKg(top.kg, unit))} ${unit}` : "—"}</span></li>`;
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
        <p class="faint">Only you and your friends can see photos and videos posted here.</p>
      </div>
      </div>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    const lbItems = posts.map((p) => ({ ...p, who: nameById[p.userId] || "Someone" }));
    document.querySelectorAll(".media-tile[data-idx]").forEach((t) => t.addEventListener("click", () => openLightbox(ctx, lbItems, parseInt(t.getAttribute("data-idx"), 10))));
    document.getElementById("addMediaBtn").addEventListener("click", () => document.getElementById("dayMediaInput").click());
    document.getElementById("dayMediaInput").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const btn = document.getElementById("addMediaBtn");
      btn.disabled = true; btn.textContent = "Uploading…";
      try {
        const { url, type } = await ctx.db.uploadDayMedia(ctx.user.id, file);
        const post = await ctx.db.addDayPost(ctx.user.id, dateKey, url, type, "");
        const next = [post, ...posts];
        draw(next);
        toast("Added");
      } catch (err) {
        toast("Couldn't upload: " + (err.message || String(err)));
        btn.disabled = false; btn.textContent = "+ Add a photo or video";
      }
    });
  }

  draw(initialPosts);
}
