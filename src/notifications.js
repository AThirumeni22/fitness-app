// Bell in the top bar: unread dot + a sheet listing recent notifications
// (friend requests, session proposals/replies/cancellations/reminders).
// Rows are written by database triggers (migration_6); this only reads them.

const ICONS = {
  friend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12l5 5L20 6"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';

function iconFor(kind) {
  if (kind === "friend_request" || kind === "friend_accepted") return ["friend", ICONS.friend];
  if (kind === "plan_joined") return ["in", ICONS.in];
  if (kind === "plan_declined" || kind === "plan_left" || kind === "plan_cancelled") return ["out", ICONS.out];
  if (kind === "plan_reminder") return ["clock", ICONS.clock];
  return ["plan", ICONS.plan];
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Turns "/?tab=calendar" into "calendar" (only tabs that exist).
export function tabFromUrl(url) {
  try {
    const t = new URL(url, location.origin).searchParams.get("tab");
    return ["train", "history", "exercises", "friends", "calendar"].includes(t) ? t : null;
  } catch (e) { return null; }
}

export function mountNotifications(ctx) {
  const { user, db, supabase, openSheet, closeSheet, escapeHtml, toast } = ctx;
  let items = [];
  let available = true; // false until migration_6 has been run

  const actions = document.querySelector(".topbar .actions");
  const btn = document.createElement("button");
  btn.className = "chip-btn bell-btn";
  btn.id = "bellBtn";
  btn.title = "Notifications";
  btn.setAttribute("aria-label", "Notifications");
  btn.innerHTML = BELL;
  actions.insertBefore(btn, actions.firstChild);
  btn.addEventListener("click", openInbox);

  function unreadCount() { return items.filter((n) => !n.read_at).length; }

  function updateDot() {
    const n = unreadCount();
    let dot = btn.querySelector(".bell-dot");
    if (n && !dot) { dot = document.createElement("i"); dot.className = "bell-dot"; btn.appendChild(dot); }
    if (!n && dot) dot.remove();
    btn.setAttribute("aria-label", n ? `Notifications, ${n} unread` : "Notifications");
    // Number on the installed app's home-screen icon, where supported.
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) {}
  }

  async function refresh() {
    try {
      items = await db.listNotifications(user.id);
      available = true;
    } catch (e) {
      available = false; // table not created yet → bell just stays empty
      items = [];
    }
    updateDot();
    const sh = document.getElementById("sheetInner");
    if (sh && sh.querySelector("#notifList")) drawInbox();
  }

  function drawInbox() {
    const listHtml = !available
      ? `<div class="card"><p class="muted">Notifications aren't set up yet — run <code>migration_6_notifications.sql</code> in Supabase (see the README).</p></div>`
      : !items.length
        ? `<div class="card notif-empty"><p class="muted">Nothing yet. You'll see friend requests, proposed sessions and replies here.</p></div>`
        : items.map((n) => {
          const [cls, icon] = iconFor(n.kind);
          return `<button class="notif-row${n.read_at ? "" : " unread"}" data-url="${escapeHtml(n.url || "/")}">
            <span class="notif-icon ${cls}">${icon}</span>
            <span class="notif-text">
              <strong>${escapeHtml(n.title)}</strong>
              ${n.body ? `<span>${escapeHtml(n.body)}</span>` : ""}
              <span class="faint">${timeAgo(n.created_at)}</span>
            </span>
          </button>`;
        }).join("");
    openSheet(`
      <div class="sheet-title"><h3>Notifications</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="notif-list" id="notifList">${listHtml}</div>
      ${items.length ? `<button class="btn btn-secondary btn-block" id="clearNotifsBtn">Clear all</button>` : ""}
      <button class="btn btn-secondary btn-block" id="notifSettingsBtn">Notification settings</button>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.querySelectorAll(".notif-row").forEach((r) => r.addEventListener("click", () => {
      const tab = tabFromUrl(r.getAttribute("data-url"));
      closeSheet();
      if (tab) ctx.setTab(tab);
    }));
    const clearBtn = document.getElementById("clearNotifsBtn");
    if (clearBtn) clearBtn.addEventListener("click", async () => {
      try { await db.clearNotifications(user.id); items = []; updateDot(); drawInbox(); }
      catch (e) { toast("Couldn't clear notifications"); }
    });
    document.getElementById("notifSettingsBtn").addEventListener("click", () => ctx.openProfile());
  }

  async function openInbox() {
    drawInbox();
    await refresh();
    if (!unreadCount()) return;
    try {
      await db.markNotificationsRead(user.id);
      // The open list keeps its highlight until it's redrawn; the dot goes now.
      const stamp = new Date().toISOString();
      items = items.map((n) => (n.read_at ? n : { ...n, read_at: stamp }));
      updateDot();
    } catch (e) {}
  }

  // Live: a new row for me → refresh the dot (and the list if it's open).
  try {
    supabase
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => refresh())
      .subscribe();
  } catch (e) {}

  // Fallbacks: coming back to the app, and pushes the service worker received.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const msg = e.data || {};
      if (msg.type === "obonto-notification") refresh();
      if (msg.type === "obonto-open") {
        const tab = tabFromUrl(msg.url);
        closeSheet();
        if (tab) ctx.setTab(tab);
        refresh();
      }
    });
  }

  refresh();
  return { refresh };
}
