// Calendar tab: a monthly grid of your + your friends' gym visits, a
// day-detail sheet (who trained + what split, plus a BeReal-style
// photo/video feed for that day), and a "propose a time to train" poll
// with multi-select voting.

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
      <div class="cal-dow-row">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${cells}</div>
      <div class="section-label" style="margin-top:6px;">Plan a session</div>
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
    if (!plansList.length) return `<div class="card"><p class="muted">No sessions proposed yet.</p></div>${newBtnHtml}`;
    const cardsHtml = plansList.map((p) => {
      const opt = p.options[0];
      if (!opt) return "";
      const mine = opt.voterIds.includes(ctx.user.id);
      const names = opt.voterIds.map((id) => nameById[id] || "Someone");
      return `<div class="plan-card">
        <div class="plan-card-head">
          <div>
            <h4>${ctx.escapeHtml(p.title)}</h4>
            <div class="plan-when">${fmtWhen(opt.startsAt)}</div>
            ${p.templateName ? `<span class="plan-tpl-badge">${ctx.escapeHtml(p.templateName)}</span>` : ""}
          </div>
          ${p.creatorId === ctx.user.id ? `<button class="icon-btn del-plan" data-id="${p.id}" title="Delete" aria-label="Delete plan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
        </div>
        <button class="btn ${mine ? "btn-primary" : "btn-secondary"} btn-block join-plan" data-plan="${p.id}" data-opt="${opt.id}" data-mine="${mine ? "1" : "0"}">${mine ? "You're in" : "I'm in"}</button>
        <p class="plan-who muted">${names.length ? ctx.escapeHtml(names.join(", ")) : "No one yet"}</p>
      </div>`;
    }).join("");
    return cardsHtml + newBtnHtml;
  }

  function bindPlans() {
    const newBtn = document.getElementById("newPlanBtn");
    if (newBtn) newBtn.addEventListener("click", () => openNewPlanSheet(ctx, () => renderCalendar(ctx)));
    el.querySelectorAll(".join-plan").forEach((b) => b.addEventListener("click", async () => {
      const planId = b.getAttribute("data-plan"), optId = b.getAttribute("data-opt");
      const mine = b.getAttribute("data-mine") === "1";
      try {
        if (mine) await ctx.db.unvoteGymPlanOption(optId, ctx.user.id);
        else await ctx.db.voteGymPlanOption(planId, optId, ctx.user.id);
        renderCalendar(ctx);
      } catch (err) { ctx.toast("Couldn't update your vote"); }
    }));
    el.querySelectorAll(".del-plan").forEach((b) => b.addEventListener("click", async () => {
      try { await ctx.db.deleteGymPlan(b.getAttribute("data-id")); renderCalendar(ctx); }
      catch (err) { ctx.toast("Couldn't delete that"); }
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

function openDaySheet(ctx, dateKey, dayWorkouts, initialPosts, nameById) {
  const { openSheet, closeSheet, toast, escapeHtml } = ctx;

  function splitFor(w) {
    const cats = [...new Set(w.exercises.map((e) => ctx.exCat(e.exerciseId)).filter(Boolean))];
    return cats.length ? cats.join(", ") : w.exercises.map((e) => e.name).slice(0, 3).join(", ");
  }

  function draw(posts) {
    const whoHtml = dayWorkouts.length ? dayWorkouts.map((w) => `
      <div class="session-ex">
        <div class="exn">${escapeHtml(nameById[w.userId] || "Someone")} — ${escapeHtml(splitFor(w))}</div>
        <div class="exs">${escapeHtml(w.exercises.map((e) => e.name).join(", "))}</div>
      </div>`).join("") : '<p class="muted">No workouts logged this day.</p>';

    const mediaHtml = posts.length ? `<div class="media-grid">${posts.map((p) => `
      <div class="media-tile">
        ${p.mediaType === "video" ? `<video src="${p.mediaUrl}" controls playsinline></video>` : `<img src="${p.mediaUrl}" alt="">`}
        <span class="media-who">${escapeHtml(nameById[p.userId] || "Someone")}</span>
      </div>`).join("")}</div>` : '<p class="muted">No photos or videos yet.</p>';

    openSheet(`
      <div class="sheet-title"><h3>${escapeHtml(dateKey)}</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="section-label">Who trained</div>
      <div class="card" style="margin-bottom:14px;">${whoHtml}</div>
      <div class="section-label">Photos &amp; Videos</div>
      <div class="card">
        ${mediaHtml}
        <input type="file" id="dayMediaInput" accept="image/*,video/*" hidden>
        <button class="btn btn-secondary btn-block" id="addMediaBtn" style="margin-top:10px;">+ Add a photo or video</button>
      </div>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
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
