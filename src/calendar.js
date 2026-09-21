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
      <div class="card" style="display:flex; align-items:center; justify-content:space-between;">
        <button class="icon-btn" id="prevMonthBtn">‹</button>
        <h2 style="font-size:17px;">${MONTH_NAMES[month]} ${year}</h2>
        <button class="icon-btn" id="nextMonthBtn">›</button>
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
      const optsHtml = p.options.map((o) => {
        const mine = o.voterIds.includes(ctx.user.id);
        const names = o.voterIds.map((id) => nameById[id] || "Someone").join(", ");
        return `
          <button class="vote-option${mine ? " mine" : ""}" data-plan="${p.id}" data-opt="${o.id}">
            <span>${fmtWhen(o.startsAt)}</span>
            <span class="vote-count">${o.voterIds.length ? o.voterIds.length + " · " + ctx.escapeHtml(names) : "No votes yet"}</span>
          </button>`;
      }).join("");
      return `<div class="card" style="margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <h4 style="font-size:15px;">${ctx.escapeHtml(p.title)}</h4>
          ${p.creatorId === ctx.user.id ? `<button class="icon-btn del-plan" data-id="${p.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">${optsHtml}</div>
      </div>`;
    }).join("");
    return cardsHtml + newBtnHtml;
  }

  function bindPlans() {
    const newBtn = document.getElementById("newPlanBtn");
    if (newBtn) newBtn.addEventListener("click", () => openNewPlanSheet(ctx, () => renderCalendar(ctx)));
    el.querySelectorAll(".vote-option").forEach((b) => b.addEventListener("click", async () => {
      const planId = b.getAttribute("data-plan"), optId = b.getAttribute("data-opt");
      const mine = b.classList.contains("mine");
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

function openNewPlanSheet(ctx, onDone) {
  const { openSheet, closeSheet, toast } = ctx;
  let options = [""];

  function draw() {
    const optsHtml = options.map((v, i) => `
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <input type="datetime-local" class="plan-opt-input" data-i="${i}" value="${v}" style="flex:1; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-s); padding:10px; font-size:13.5px;">
        ${options.length > 1 ? `<button class="icon-btn rm-opt" data-i="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
      </div>`).join("");
    openSheet(`
      <div class="sheet-title"><h3>Propose a Time</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><label>Title</label><input type="text" id="planTitleInput" placeholder="e.g. Leg day?" value="Gym session"></div>
      <label style="font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); font-weight:600;">Time options — friends can vote for as many as they like</label>
      <div id="planOptsWrap" style="margin-top:8px;">${optsHtml}</div>
      <button class="btn btn-secondary btn-block" id="addOptBtn" style="margin-bottom:14px;">+ Add another time</button>
      <button class="btn btn-primary btn-block" id="savePlanBtn">Create Poll</button>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.querySelectorAll(".plan-opt-input").forEach((inp) => inp.addEventListener("input", (e) => {
      options[parseInt(e.target.getAttribute("data-i"), 10)] = e.target.value;
    }));
    document.querySelectorAll(".rm-opt").forEach((b) => b.addEventListener("click", () => {
      options.splice(parseInt(b.getAttribute("data-i"), 10), 1);
      draw();
    }));
    document.getElementById("addOptBtn").addEventListener("click", () => { options.push(""); draw(); });
    document.getElementById("savePlanBtn").addEventListener("click", save);
  }

  async function save() {
    const title = document.getElementById("planTitleInput").value.trim() || "Gym session";
    const isoOptions = options.filter(Boolean).map((v) => new Date(v).toISOString());
    if (!isoOptions.length) { toast("Add at least one time option"); return; }
    const btn = document.getElementById("savePlanBtn");
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      await ctx.db.createGymPlan(ctx.user.id, title, isoOptions);
      closeSheet();
      toast("Poll created");
      onDone();
    } catch (err) {
      toast("Couldn't create poll: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = "Create Poll";
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
      <div class="sheet-title"><h3>${escapeHtml(dateKey)}</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
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
