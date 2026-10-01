// Profile sheet: display name (what friends see you as) + avatar picture.

// Shrinks whatever photo someone picks down to a small square before it
// ever touches the network — a full-res phone camera photo can be
// 10-20MB+ (especially iPhones shooting HEIC), which is the single most
// common reason an avatar upload silently times out or errors on a slow
// connection. This also fixes HEIC specifically: browsers other than
// Safari can't decode it at all, so without this step the upload could
// "succeed" (raw bytes go up fine) while the photo never actually renders
// anywhere in the app. Drawing it to a canvas forces a real decode up
// front, so a HEIC/corrupt file fails loudly, right here, with a clear
// message — instead of failing silently later.
function resizeImage(file, maxDim = 480, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height) { if (width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; } }
      else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const c2d = canvas.getContext("2d");
      c2d.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error("Couldn't process that image"));
      }, "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo couldn't be read — try a JPEG or PNG instead of HEIC/RAW"));
    };
    img.src = url;
  });
}

export function openProfileSheet(ctx) {
  const { openSheet, closeSheet, toast, escapeHtml, state, user } = ctx;
  let pendingFile = null;
  let previewUrl = state.profile.avatarUrl || "";
  let pushOn = !!state.pushEnabled;
  let pushBusy = false;

  // Push notifications on *this* device (each phone/browser is turned on separately).
  function notifSectionHtml() {
    const support = ctx.push.pushSupport();
    if (support === "ios-install-needed") {
      return `<p class="muted">On iPhone, notifications only work from the installed app: tap Share → <strong>Add to Home Screen</strong>, open Obonto from your home screen, then turn them on here.</p>`;
    }
    if (support === "denied") {
      return `<p class="muted">Notifications are blocked for Obonto. Allow them in your browser or phone settings, then come back here.</p>`;
    }
    if (support === "unsupported") {
      return `<p class="muted">This browser can't show notifications. You'll still see everything under the bell at the top.</p>`;
    }
    if (support === "not-configured") {
      return `<p class="muted">Push notifications aren't set up for this site yet (missing <code>VITE_VAPID_PUBLIC_KEY</code>). You'll still see everything under the bell at the top.</p>`;
    }
    return `
      <div class="field">
        <label>On this device</label>
        <div class="seg-toggle" id="pushToggle">
          <button type="button" data-on="1" class="${pushOn ? "active" : ""}"${pushBusy ? " disabled" : ""}>On</button>
          <button type="button" data-on="0" class="${pushOn ? "" : "active"}"${pushBusy ? " disabled" : ""}>Off</button>
        </div>
      </div>
      <p class="muted">Friend requests, sessions friends propose, who's in or can't make it, cancellations, and a reminder an hour before.</p>`;
  }

  async function setPush(on) {
    if (on === pushOn || pushBusy) return;
    pushBusy = true; draw();
    try {
      if (on) { await ctx.push.enablePush(); toast("Notifications on"); }
      else { await ctx.push.disablePush(); toast("Notifications off on this device"); }
      pushOn = on;
      ctx.onPushChanged(on);
    } catch (err) {
      toast(err.message === "denied" ? "Notifications are blocked — allow them in your browser settings"
        : err.message === "dismissed" ? "Notifications not turned on"
          : "Couldn't change notifications: " + (err.message || String(err)));
    }
    pushBusy = false; draw();
  }

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
      <div class="field"><label for="displayNameInput">Name</label><input type="text" id="displayNameInput" placeholder="What friends see" autocomplete="nickname" maxlength="40" value="${escapeHtml(state.profile.displayName || "")}"></div>
      <p class="muted">Friends see this name instead of your email: in Friends, the Calendar, gym-time plans and shared templates.</p>
      <button class="btn btn-primary btn-block" id="saveProfileBtn">Save</button>

      <div class="section-label">Settings</div>
      <div class="field">
        <label>Weight unit</label>
        <div class="seg-toggle" id="unitToggle">
          <button type="button" data-u="kg" class="${state.unit === "kg" ? "active" : ""}">kg</button>
          <button type="button" data-u="lb" class="${state.unit === "lb" ? "active" : ""}">lb</button>
        </div>
      </div>
      <div class="field">
        <label for="defaultRestInput">Default rest timer (seconds)</label>
        <input type="number" inputmode="numeric" id="defaultRestInput" min="5" step="5" value="${state.restDuration}">
      </div>
      <p class="muted">Used whenever an exercise doesn't have its own rest time set in a template.</p>
      ${(state.templatePrefs.hiddenBuiltin || []).length ? `
        <div class="field">
          <label>Default templates</label>
          <button type="button" class="btn btn-secondary btn-block" id="restoreTplBtn">Restore hidden default templates</button>
        </div>
      ` : ""}

      <div class="section-label">Notifications</div>
      ${notifSectionHtml()}

      <div class="section-label">Privacy</div>
      <button type="button" class="btn btn-secondary btn-block" id="privacyBtn">Read the privacy notice</button>
      <p class="faint" style="overflow-wrap:anywhere;">Signed in as ${escapeHtml(user.email || "")}</p>
    `);
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("pickAvatarBtn").addEventListener("click", () => document.getElementById("avatarInput").click());
    document.getElementById("avatarInput").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type || !file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
      const pickBtn = document.getElementById("pickAvatarBtn");
      pickBtn.disabled = true; pickBtn.textContent = "Processing…";
      try {
        const resized = await resizeImage(file);
        pendingFile = resized;
        previewUrl = URL.createObjectURL(resized);
        draw();
      } catch (err) {
        toast(err.message || "Couldn't process that photo");
        pickBtn.disabled = false; pickBtn.textContent = "Change photo";
      }
    });
    document.getElementById("saveProfileBtn").addEventListener("click", save);
    document.getElementById("privacyBtn").addEventListener("click", () => ctx.openPrivacy());
    const restoreBtn = document.getElementById("restoreTplBtn");
    if (restoreBtn) restoreBtn.addEventListener("click", () => { ctx.restoreBuiltinTemplates(); draw(); });
    document.querySelectorAll("#pushToggle button").forEach((b) => b.addEventListener("click", () => setPush(b.getAttribute("data-on") === "1")));
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

    // Upload the photo (if a new one was picked) separately from saving the
    // name, so a network hiccup on the upload doesn't also throw away a
    // name change — and so the error you see actually says which of the
    // two steps failed, instead of one generic "couldn't save" message.
    let avatarUrl = state.profile.avatarUrl;
    if (pendingFile) {
      try {
        avatarUrl = await ctx.db.uploadAvatar(user.id, pendingFile);
      } catch (err) {
        // Keep the sheet open with the preview so it's obvious the photo
        // didn't go through, instead of closing and silently reverting.
        toast("Couldn't upload photo: " + (err.message || String(err)));
        btn.disabled = false; btn.textContent = "Save";
        return;
      }
    }

    try {
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
  ctx.push.isPushEnabled().then((on) => {
    if (on === pushOn || !document.getElementById("pushToggle")) return;
    pushOn = on;
    document.querySelectorAll("#pushToggle button").forEach((b) => b.classList.toggle("active", (b.getAttribute("data-on") === "1") === on));
  });
}
