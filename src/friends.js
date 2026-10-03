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
      <form class="card" id="addFriendForm" novalidate>
        <p class="muted">They need an Obonto account already — add them by the email they signed up with.</p>
        <div class="field"><label for="friendEmailInput" class="sr-only">Friend's email</label><input type="email" id="friendEmailInput" placeholder="their.email@example.com" autocomplete="off" autocapitalize="off" inputmode="email" enterkeyhint="send"></div>
        <button type="submit" class="btn btn-primary btn-block" id="sendReqBtn">Send request</button>
        <p class="muted" id="addFriendMsg" hidden></p>
      </form>
      ${outgoingHtml ? `<div class="section-label">Sent</div><div class="stack-sm">${outgoingHtml}</div>` : ""}
    `;

    // A form, so the keyboard's Send/Enter key submits too.
    document.getElementById("addFriendForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("friendEmailInput");
      const msg = document.getElementById("addFriendMsg");
      const btn = document.getElementById("sendReqBtn");
      const email = input.value.trim();
      if (btn.disabled) return;
      if (!email) { msg.hidden = false; msg.textContent = "Type your friend's email first."; input.focus(); return; }
      msg.hidden = false;
      msg.textContent = "Searching…";
      btn.disabled = true;
      try {
        const found = await ctx.db.findUserByEmail(email);
        if (!found) { msg.textContent = "No Obonto account with that email — check the spelling, or ask them to sign up first."; return; }
        if (found.id === ctx.user.id) { msg.textContent = "That's your own account."; return; }
        if (data.accepted.some((r) => r.otherId === found.id)) { msg.textContent = "You're already friends."; return; }
        if (data.incoming.some((r) => r.otherId === found.id)) { msg.textContent = "They've already sent you a request — accept it above."; return; }
        if (data.outgoing.some((r) => r.otherId === found.id)) { msg.textContent = "You've already sent them a request — waiting for them to accept."; return; }
        await ctx.db.sendFriendRequest(ctx.user.id, found.id);
        toast("Friend request sent");
        input.value = "";
        renderFriends(ctx);
      } catch (err) {
        msg.textContent = /duplicate|unique/i.test(err.message || "")
          ? "There's already a request between you two — open the Friends tab again to see it."
          : "Couldn't send that: " + (err.message || String(err));
      } finally {
        btn.disabled = false;
      }
    });

    el.querySelectorAll(".accept-btn").forEach((b) => b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true; b.textContent = "Accepting…";
      try { await ctx.db.acceptFriendRequest(b.getAttribute("data-id")); toast("You're friends now"); renderFriends(ctx); }
      catch (e) { toast("Couldn't accept that request"); b.disabled = false; b.textContent = "Accept"; }
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
      if (b.disabled) return;
      b.disabled = true;
      try {
        await ctx.db.removeFriendship(id);
        if (b.classList.contains("remove-btn")) toast("Friend removed");
        renderFriends(ctx);
      }
      catch (e) { toast("Couldn't update that"); b.disabled = false; }
    }));
  }

  draw();
}
