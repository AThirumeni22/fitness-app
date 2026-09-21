// Template editor: rename, reorder, add/remove exercises, and set a
// per-exercise target (sets / reps / weight) used by the guided "Run"
// player in app.js. Pass template = null to create a brand new template.

export function openTemplateEditor(ctx, template) {
  const { openSheet, closeSheet, toast, escapeHtml, state } = ctx;
  const isNew = !template;
  const isBuiltIn = !!(template && !template.isCustom);
  let name = template ? template.name : "";
  let ids = template ? [...template.exerciseIds] : [];
  let targets = template ? { ...template.targets } : {};

  function targetFor(id) {
    const t = targets[id] || {};
    return { sets: t.sets || 3, reps: t.reps ?? "", weight: t.weight ?? "" };
  }

  function syncName() {
    const inp = document.getElementById("tplNameInput");
    if (inp) name = inp.value;
  }

  function draw() {
    const rowsHtml = ids.length ? ids.map((id, i) => {
      const t = targetFor(id);
      return `
        <div class="tpl-edit-row" data-i="${i}" style="border:1px solid var(--border); border-radius:var(--r-m); padding:10px 12px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
            <span style="font-weight:600; font-size:14px;">${escapeHtml(ctx.exName(id))}</span>
            <div style="display:flex; gap:4px; flex-shrink:0;">
              <button class="icon-btn move-up" data-i="${i}" title="Move up">↑</button>
              <button class="icon-btn move-down" data-i="${i}" title="Move down">↓</button>
              <button class="icon-btn remove-ex" data-i="${i}" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
            <label style="font-size:11px; color:var(--ink-faint); display:flex; flex-direction:column; gap:3px;">Sets
              <input type="number" class="t-sets" data-i="${i}" value="${t.sets}" min="1" style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-s); padding:8px; font-size:13.5px;">
            </label>
            <label style="font-size:11px; color:var(--ink-faint); display:flex; flex-direction:column; gap:3px;">Reps
              <input type="number" class="t-reps" data-i="${i}" value="${t.reps}" placeholder="—" style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-s); padding:8px; font-size:13.5px;">
            </label>
            <label style="font-size:11px; color:var(--ink-faint); display:flex; flex-direction:column; gap:3px;">Weight (${state.unit})
              <input type="number" class="t-weight" data-i="${i}" value="${t.weight}" placeholder="—" style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-s); padding:8px; font-size:13.5px;">
            </label>
          </div>
        </div>`;
    }).join("") : '<p class="muted" style="margin-bottom:10px;">No exercises yet — add some below.</p>';

    openSheet(`
      <div class="sheet-title"><h3>${isNew ? "New Template" : "Edit Template"}</h3><button class="icon-btn" id="sheetClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="field"><label>Name</label><input type="text" id="tplNameInput" value="${escapeHtml(name)}" placeholder="e.g. Upper Body A"></div>
      ${isBuiltIn ? '<p class="muted" style="margin-bottom:10px;">This is a built-in template — saving will create your own editable copy.</p>' : ""}
      <div id="tplEditRows">${rowsHtml}</div>
      <button class="btn btn-secondary btn-block" id="addExToTplBtn" style="margin-bottom:14px;">+ Add Exercise</button>
      <button class="btn btn-primary btn-block" id="saveTplEditBtn">Save Template</button>
    `);
    bind();
  }

  function bind() {
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("tplNameInput").addEventListener("input", syncName);
    document.querySelectorAll(".t-sets, .t-reps, .t-weight").forEach((inp) => inp.addEventListener("input", (e) => {
      const i = parseInt(e.target.getAttribute("data-i"), 10);
      const id = ids[i];
      const cur = targets[id] || {};
      const field = e.target.classList.contains("t-sets") ? "sets" : e.target.classList.contains("t-reps") ? "reps" : "weight";
      const raw = e.target.value;
      const v = raw === "" ? (field === "sets" ? 3 : null) : Number(raw);
      targets[id] = { ...cur, [field]: v };
    }));
    document.querySelectorAll(".move-up").forEach((b) => b.addEventListener("click", () => {
      syncName();
      const i = parseInt(b.getAttribute("data-i"), 10);
      if (i <= 0) return;
      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      draw();
    }));
    document.querySelectorAll(".move-down").forEach((b) => b.addEventListener("click", () => {
      syncName();
      const i = parseInt(b.getAttribute("data-i"), 10);
      if (i >= ids.length - 1) return;
      [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
      draw();
    }));
    document.querySelectorAll(".remove-ex").forEach((b) => b.addEventListener("click", () => {
      syncName();
      const i = parseInt(b.getAttribute("data-i"), 10);
      delete targets[ids[i]];
      ids.splice(i, 1);
      draw();
    }));
    document.getElementById("addExToTplBtn").addEventListener("click", () => {
      syncName();
      ctx.openExercisePicker("Add Exercise", (id) => {
        if (!ids.includes(id)) ids.push(id);
        draw();
      });
    });
    document.getElementById("saveTplEditBtn").addEventListener("click", save);
  }

  async function save() {
    syncName();
    const trimmed = name.trim();
    if (!trimmed) { toast("Enter a template name"); return; }
    if (!ids.length) { toast("Add at least one exercise"); return; }
    const btn = document.getElementById("saveTplEditBtn");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (isNew || isBuiltIn) {
        const created = await ctx.db.addTemplate(ctx.user.id, trimmed, ids, targets);
        state.templates.push(created);
      } else {
        const updated = await ctx.db.updateTemplate(template.id, trimmed, ids, targets);
        const idx = state.templates.findIndex((t) => t.id === template.id);
        if (idx > -1) state.templates[idx] = updated;
      }
      closeSheet();
      ctx.renderCurrentTab();
      toast("Template saved");
    } catch (err) {
      toast("Couldn't save template: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = "Save Template";
    }
  }

  draw();
}
