// Profile sheet: display name (what friends see you as) + avatar picture.

export function openProfileSheet(ctx) {
  const { openSheet, closeSheet, toast, escapeHtml, state, user } = ctx;
  let pendingFile = null;
  let previewUrl = state.profile.avatarUrl || "";

  function draw() {
    const initial = (state.profile.displayName || user.email || "?").trim().charAt(0).toUpperCase();
    openSheet(`
      <div class="sheet-title"><h3>Your Profile</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="avatar-wrap">
        <div id="avatarPreviewWrap" class="avatar-lg">
          ${previewUrl ? `<img id="avatarPreviewImg" src="${previewUrl}">` : escapeHtml(initial)}
        </div>
        <input type="file" id="avatarInput" accept="image/*" hidden>
        <button class="btn btn-secondary btn-sm" id="pickAvatarBtn">Change photo</button>
      </div>
      <div class="field"><label>Name</label><input type="text" id="displayNameInput" placeholder="What friends see" value="${escapeHtml(state.profile.displayName || "")}"></div>
      <p class="muted" style="margin-bottom:14px;">Friends see this name instead of your email, in Friends, the Calendar, and gym-time polls.</p>
      <button class="btn btn-primary btn-block" id="saveProfileBtn">Save</button>

      <div class="section-label mt">Settings</div>
      <div class="field">
        <label>Weight unit</label>
        <div class="seg-toggle" id="unitToggle">
          <button type="button" data-u="kg" class="${state.unit === "kg" ? "active" : ""}">kg</button>
          <button type="button" data-u="lb" class="${state.unit === "lb" ? "active" : ""}">lb</button>
        </div>
      </div>
      <div class="field">
        <label>Default rest timer (seconds)</label>
        <input type="number" id="defaultRestInput" min="5" step="5" value="${state.restDuration}">
      </div>
      <p class="muted" style="margin-bottom:14px;">Used whenever an exercise doesn't have its own rest time set in a template.</p>

      <p class="muted" style="word-break:break-all;">Signed in as ${escapeHtml(user.email || "")}</p>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("pickAvatarBtn").addEventListener("click", () => document.getElementById("avatarInput").click());
    document.getElementById("avatarInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      pendingFile = file;
      previewUrl = URL.createObjectURL(file);
      draw();
    });
    document.getElementById("saveProfileBtn").addEventListener("click", save);
    document.querySelectorAll("#unitToggle button").forEach((b) => b.addEventListener("click", () => {
      ctx.setUnit(b.getAttribute("data-u"));
      draw();
    }));
    document.getElementById("defaultRestInput").addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) { ctx.saveRestDuration(v); toast("Default rest timer updated"); }
    });
  }

  async function save() {
    const btn = document.getElementById("saveProfileBtn");
    const name = document.getElementById("displayNameInput").value.trim();
    if (!name) { toast("Enter a name so friends know it's you"); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      let avatarUrl = state.profile.avatarUrl;
      if (pendingFile) avatarUrl = await ctx.db.uploadAvatar(user.id, pendingFile);
      const updated = await ctx.db.updateProfile(user.id, { displayName: name, avatarUrl });
      state.profile.displayName = updated.display_name;
      state.profile.avatarUrl = updated.avatar_url;
      pendingFile = null;
      ctx.refreshTopbar();
      toast("Profile saved");
      closeSheet();
    } catch (err) {
      toast("Couldn't save profile: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = "Save";
    }
  }

  draw();
}
