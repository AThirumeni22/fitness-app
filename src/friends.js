// Friends tab: send/accept/decline requests by email, list current friends.
// ctx is built once in app.js and passed to every render call; see the
// "shared ctx" comment near the top of app.js for what it carries.

const FEED_DAYS = 21;
const FEED_LIMIT = 15;

export async function renderFriends(ctx) {
  const { toast, escapeHtml } = ctx;
  const el = document.getElementById("tab-friends");
  if (!el) return;
  el.innerHTML = `<div class="card"><p class="muted">Loading friends…</p></div>`;

  let data;
  try {
    data = await ctx.db.listFriendships(ctx.user.id);
    ctx.state.friends = data;
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="muted">Couldn't load friends: ${escapeHtml(err.message || String(err))}</p></div>`;
    return;
  }

  // Friends can already read each other's workouts (see "workouts: friends
  // can read" in migration_2_social.sql) — this just gives that visibility
  // an actual place to show up, instead of only surfacing one day at a
  // time in the Calendar's day-detail view.
  const friendIds = data.accepted.map((r) => r.otherId);
  let feed = [];
  if (friendIds.length) {
    try {
      const since = new Date(Date.now() - FEED_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const rows = await ctx.db.listWorkoutsInRange([ctx.user.id, ...friendIds], since, until);
      const nameById = {};
      data.accepted.forEach((r) => { nameById[r.otherId] = r.otherProfile; });
      feed = rows
        .slice()
        .sort((x, y) => new Date(y.date) - new Date(x.date))
        .slice(0, FEED_LIMIT)
        .map((w) => ({
          ...w,
          who: w.userId === ctx.user.id ? "You" : nameFor(nameById[w.userId])
        }));
    } catch (err) {
      feed = [];
    }
  }

  function nameFor(p) {
    return p && p.display_name ? escapeHtml(p.display_name) : "Someone (hasn't set a name yet)";
  }

  function feedCard(w) {
    const names = w.exercises.map((e) => e.name);
    const summary = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
    const totalSets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    return `
      <div class="feed-card">
        <div class="feed-card-head">
          <span class="feed-who">${w.who === "You" ? "You" : w.who}</span>
          <span class="feed-when">${ctx.fmtDate(w.date)}</span>
        </div>
        <p class="feed-summary">${escapeHtml(summary || "Workout")}</p>
        <p class="feed-meta muted">${totalSets} set${totalSets === 1 ? "" : "s"} · ${ctx.fmtDuration(w.durationSec)}</p>
      </div>`;
  }

  function row(r, actionsHtml, sub) {
    return `
      <div class="tpl-list-card">
        <div class="info"><h4>${nameFor(r.otherProfile)}</h4><p>${sub}</p></div>
        ${actionsHtml}
      </div>`;
  }

  function draw() {
    const incomingHtml = data.incoming.length
      ? data.incoming.map((r) => row(r,
          `<button class="btn btn-primary btn-sm accept-btn" data-id="${r.id}">Accept</button>
           <button class="icon-btn decline-btn" data-id="${r.id}" title="Decline" aria-label="Decline request"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "wants to be friends")).join("")
      : "";

    const outgoingHtml = data.outgoing.length
      ? data.outgoing.map((r) => row(r,
          `<button class="icon-btn cancel-btn" data-id="${r.id}" title="Cancel request" aria-label="Cancel request"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "Request sent — waiting")).join("")
      : "";

    const friendsHtml = data.accepted.length
      ? data.accepted.map((r) => row(r,
          `<button class="icon-btn remove-btn" data-id="${r.id}" title="Remove friend" aria-label="Remove friend"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "Friends")).join("")
      : '<div class="card"><p class="muted">No friends yet — add one by email below.</p></div>';

    const feedHtml = data.accepted.length ? `
      <div class="section-label">Recent activity</div>
      ${feed.length ? `<div class="stack-sm">${feed.map(feedCard).join("")}</div>` : '<div class="card"><p class="muted">No workouts from you or your friends in the last three weeks.</p></div>'}
    ` : "";

    // Order: incoming requests (need action) → your friends → their recent
    // workouts → add a friend → requests you've sent.
    el.innerHTML = `
      ${incomingHtml ? `<div class="section-label">Requests</div><div class="stack-sm">${incomingHtml}</div>` : ""}
      <div class="section-label">Friends</div>
      ${data.accepted.length ? `<div class="stack-sm">${friendsHtml}</div>` : friendsHtml}
      ${feedHtml}
      <div class="section-label">Add a friend</div>
      <div class="card">
        <p class="muted">They need an Obonto account already — add them by the email they signed up with.</p>
        <div class="field"><label for="friendEmailInput" class="sr-only">Friend's email</label><input type="email" id="friendEmailInput" placeholder="their.email@example.com" autocomplete="off" autocapitalize="off" inputmode="email" enterkeyhint="send"></div>
        <button class="btn btn-primary btn-block" id="sendReqBtn">Send request</button>
        <p class="muted" id="addFriendMsg" hidden></p>
      </div>
      ${outgoingHtml ? `<div class="section-label">Sent</div><div class="stack-sm">${outgoingHtml}</div>` : ""}
    `;

    document.getElementById("sendReqBtn").addEventListener("click", async () => {
      const input = document.getElementById("friendEmailInput");
      const msg = document.getElementById("addFriendMsg");
      const email = input.value.trim();
      if (!email) return;
      msg.hidden = false;
      msg.textContent = "Searching…";
      try {
        const found = await ctx.db.findUserByEmail(email);
        if (!found) { msg.textContent = "No Obonto account with that email."; return; }
        if (found.id === ctx.user.id) { msg.textContent = "That's your own account."; return; }
        const already = [...data.accepted, ...data.incoming, ...data.outgoing].find((r) => r.otherId === found.id);
        if (already) { msg.textContent = "You've already got a request with them."; return; }
        await ctx.db.sendFriendRequest(ctx.user.id, found.id);
        toast("Friend request sent");
        input.value = "";
        renderFriends(ctx);
      } catch (err) {
        msg.textContent = "Couldn't send that: " + (err.message || String(err));
      }
    });

    el.querySelectorAll(".accept-btn").forEach((b) => b.addEventListener("click", async () => {
      try { await ctx.db.acceptFriendRequest(b.getAttribute("data-id")); toast("You're friends now"); renderFriends(ctx); }
      catch (e) { toast("Couldn't accept that request"); }
    }));
    el.querySelectorAll(".decline-btn, .cancel-btn, .remove-btn").forEach((b) => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      if (b.classList.contains("remove-btn")) {
        const r = data.accepted.find((x) => x.id === id);
        const name = (r && r.otherProfile.display_name) || "this friend";
        const ok = await ctx.confirm({
          title: `Remove ${name}?`,
          message: "You'll stop seeing each other's workouts, calendar days and sessions. To be friends again, one of you will have to send a new request.",
          confirmText: "Remove friend",
          cancelText: "Keep friend",
          danger: true
        });
        if (!ok) return;
      }
      try {
        await ctx.db.removeFriendship(id);
        if (b.classList.contains("remove-btn")) toast("Friend removed");
        renderFriends(ctx);
      }
      catch (e) { toast("Couldn't update that"); }
    }));
  }

  draw();
}
