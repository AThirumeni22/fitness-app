// Friends tab: send/accept/decline requests by email, list current friends.
// ctx is built once in app.js and passed to every render call; see the
// "shared ctx" comment near the top of app.js for what it carries.

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

  function nameFor(p) {
    return p && p.display_name ? escapeHtml(p.display_name) : "Someone (hasn't set a name yet)";
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
           <button class="icon-btn decline-btn" data-id="${r.id}" title="Decline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "wants to be friends")).join('<div style="height:8px"></div>')
      : "";

    const outgoingHtml = data.outgoing.length
      ? data.outgoing.map((r) => row(r,
          `<button class="icon-btn cancel-btn" data-id="${r.id}" title="Cancel request"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "Request sent — waiting")).join('<div style="height:8px"></div>')
      : "";

    const friendsHtml = data.accepted.length
      ? data.accepted.map((r) => row(r,
          `<button class="icon-btn remove-btn" data-id="${r.id}" title="Remove friend"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
          "Friends")).join('<div style="height:8px"></div>')
      : '<p class="muted">No friends yet — add one by email below.</p>';

    el.innerHTML = `
      <div class="card">
        <h2 style="font-size:19px; margin-bottom:10px;">Add a friend</h2>
        <p class="muted" style="margin-bottom:10px;">They need a Trainlog account already — add them by the email they signed up with.</p>
        <div class="field" style="margin-bottom:8px;"><input type="email" id="friendEmailInput" placeholder="their.email@example.com"></div>
        <button class="btn btn-primary btn-block" id="sendReqBtn">Send Request</button>
        <p class="muted" id="addFriendMsg" style="margin-top:8px; min-height:16px;"></p>
      </div>
      ${incomingHtml ? `<div class="section-label" style="margin-top:6px;">Requests</div>${incomingHtml}` : ""}
      ${outgoingHtml ? `<div class="section-label" style="margin-top:6px;">Sent</div>${outgoingHtml}` : ""}
      <div class="section-label" style="margin-top:6px;">Friends</div>
      ${friendsHtml}
    `;

    document.getElementById("sendReqBtn").addEventListener("click", async () => {
      const input = document.getElementById("friendEmailInput");
      const msg = document.getElementById("addFriendMsg");
      const email = input.value.trim();
      if (!email) return;
      msg.textContent = "Searching…";
      try {
        const found = await ctx.db.findUserByEmail(email);
        if (!found) { msg.textContent = "No Trainlog account with that email."; return; }
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
      try { await ctx.db.removeFriendship(b.getAttribute("data-id")); renderFriends(ctx); }
      catch (e) { toast("Couldn't update that"); }
    }));
  }

  draw();
}
