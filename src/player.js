// Template editor: name, exercises in order, and every set's own target
// weight / reps / rest — the same exercise cards the workout screen uses.
// Supersets are made with the chain between two cards. Pass template = null
// to create a brand new template.

import { templateSets, buildTarget, exerciseCardHtml, chainHtml, pickRest, exerciseMenu, openProgression } from "./setcards.js";

export function openTemplateEditor(ctx, template) {
  const { openSheet, closeSheet, toast, escapeHtml, state } = ctx;
  const isNew = !template;
  const isBuiltIn = !!(template && !template.isCustom);
  const unit = state.unit;
  let name = template ? template.name : "";
  // items: [{ exerciseId, supersetNext, sets: [{ w, reps, rest }] }] — w is the
  // weight as typed (current unit), "" for none.
  let items = (template ? template.exerciseIds : []).map((id) => {
    const tg = (template.targets || {})[id] || {};
    return {
      exerciseId: id,
      supersetNext: !!tg.supersetNext,
      sets: templateSets(tg, unit).map((s) => ({ w: s.weight == null ? "" : ctx.fmtNum(s.weight), reps: s.reps ?? null, rest: s.rest || state.restDuration }))
    };
  });
  let dirty = false;

  // Closing with unsaved edits (×, backdrop or pull-down) asks first.
  async function confirmClose() {
    if (!dirty) return true;
    return ctx.confirm({
      title: "Discard changes?",
      message: "Your edits to this template haven't been saved.",
      confirmText: "Discard",
      cancelText: "Keep editing",
      danger: true
    });
  }

  function markDirty() {
    dirty = true;
    const b = document.getElementById("saveTplEditBtn");
    if (b) b.disabled = false;
  }

  function syncName() {
    const inp = document.getElementById("tplNameInput");
    if (inp) name = inp.value;
  }

  function newSet(prev) {
    return prev ? { ...prev } : { w: "", reps: null, rest: state.restDuration };
  }

  function draw() {
    const nSets = items.reduce((n, it) => n + it.sets.length, 0);
    const cards = items.map((it, i) => {
      const last = ctx.lastSetsFor(it.exerciseId);
      return exerciseCardHtml({
        mode: "edit", index: i, unit,
        ex: ctx.byId(state.exercises, it.exerciseId) || { name: ctx.exName(it.exerciseId) },
        sets: it.sets,
        placeholders: it.sets.map((s, si) => {
          const ls = last && last.sets[si];
          return ls ? { w: ls.kg ? ctx.fmtNum(ctx.fromKg(ls.kg, unit)) : "BW", reps: String(ls.reps) } : {};
        }),
        linkedPrev: i > 0 && items[i - 1].supersetNext,
        linkedNext: it.supersetNext && i < items.length - 1
      }) + (i < items.length - 1 ? chainHtml(i, it.supersetNext) : "");
    }).join("");

    openSheet(`
      <div class="sheet-title"><h3>${isNew ? "New Template" : "Edit Template"}</h3><button class="icon-btn" id="sheetClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div id="tplEd" class="tpl-ed">
        <div class="field"><label for="tplNameInput">Name</label><input type="text" id="tplNameInput" value="${escapeHtml(name)}" placeholder="e.g. Shoulders + Abs" maxlength="60" autocomplete="off"></div>
        <p class="faint">${items.length} exercise${items.length === 1 ? "" : "s"}, ${nSets} set${nSets === 1 ? "" : "s"}${items.length > 1 ? " · tap the chain between two exercises to make a superset" : ""}</p>
        ${isBuiltIn ? '<p class="muted">This is a built-in template — saving creates your own editable copy.</p>' : ""}
        ${items.length ? `<div class="xlist">${cards}</div>` : '<div class="card"><p class="muted">No exercises yet — add some below. Each one gets its own sets, reps, weights and rest.</p></div>'}
        <div class="ed-bar">
          <button type="button" class="btn btn-secondary" id="addExToTplBtn">Add Exercise</button>
          <button type="button" class="btn btn-primary" id="saveTplEditBtn"${dirty ? "" : " disabled"}>${isNew ? "Save template" : "Save changes"}</button>
        </div>
      </div>
    `, { beforeClose: confirmClose });
    bind();
  }

  function bind() {
    const root = document.getElementById("tplEd");
    document.getElementById("sheetClose").addEventListener("click", closeSheet);
    document.getElementById("tplNameInput").addEventListener("input", () => { syncName(); markDirty(); });
    // A new exercise starts from your last session of it, or 3 blank sets.
    document.getElementById("addExToTplBtn").addEventListener("click", () => openPicker("Add Exercise", (id) => {
      const last = ctx.lastSetsFor(id);
      const sets = last
        ? last.sets.map((s) => ({ w: s.kg ? ctx.fmtNum(ctx.fromKg(s.kg, unit)) : "", reps: s.reps, rest: state.restDuration }))
        : [newSet(), newSet(), newSet()];
      items.push({ exerciseId: id, supersetNext: false, sets });
    }));
    document.getElementById("saveTplEditBtn").addEventListener("click", save);

    // Weight / reps typed into a set (no redraw, so the keyboard stays up).
    root.addEventListener("input", (e) => {
      const inp = e.target;
      if (!inp.matches(".xs-kg, .xs-reps")) return;
      const card = inp.closest(".xcard");
      const s = card && items[+card.getAttribute("data-exi")].sets[+inp.getAttribute("data-si")];
      if (!s) return;
      if (inp.classList.contains("xs-kg")) s.w = inp.value.trim();
      else { const v = parseInt(inp.value, 10); s.reps = isNaN(v) ? null : v; }
      markDirty();
    });

    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      if (b.classList.contains("xchain-btn")) {
        const i = +b.getAttribute("data-exi");
        if (items[i]) { syncName(); items[i].supersetNext = !items[i].supersetNext; markDirty(); draw(); }
        return;
      }
      const card = b.closest(".xcard");
      if (!card) return;
      syncName();
      const i = +card.getAttribute("data-exi"), it = items[i];
      const si = b.hasAttribute("data-si") ? +b.getAttribute("data-si") : -1;

      if (b.classList.contains("xs-restbtn") && it.sets[si]) {
        const sec = await pickRest(it.sets[si].rest, `Rest after set ${si + 1}`);
        if (sec == null) return;
        it.sets[si].rest = sec;
      } else if (b.classList.contains("xs-num") && it.sets[si]) {
        const ok = await ctx.confirm({ title: `Delete set ${si + 1}?`, message: ctx.exName(it.exerciseId), confirmText: "Delete set", cancelText: "Keep it", danger: true });
        if (!ok) return;
        it.sets.splice(si, 1);
      } else if (b.classList.contains("xc-add")) {
        it.sets.push(newSet(it.sets[it.sets.length - 1]));
      } else if (b.classList.contains("xc-rest")) {
        const sec = await pickRest(it.sets[0] ? it.sets[0].rest : state.restDuration, "Rest for every set");
        if (sec == null) return;
        it.sets.forEach((s) => { s.rest = sec; });
      } else if (b.classList.contains("xc-prog")) {
        openProgression({ history: state.history, unit, name: ctx.exName(it.exerciseId) }, it.exerciseId);
        return;
      } else if (b.classList.contains("xc-menu")) {
        const choice = await exerciseMenu(ctx.exName(it.exerciseId), { canUp: i > 0, canDown: i < items.length - 1 });
        if (!choice) return;
        if (choice === "up" || choice === "down") {
          const j = choice === "up" ? i - 1 : i + 1;
          [items[i], items[j]] = [items[j], items[i]];
          [Math.min(i, j) - 1, i, j].forEach((k) => { if (items[k]) items[k].supersetNext = false; });
        } else if (choice === "replace") {
          openPicker("Replace exercise", (id) => { it.exerciseId = id; });
          return;
        } else if (choice === "rest") {
          const sec = await pickRest(it.sets[0] ? it.sets[0].rest : state.restDuration, "Rest for every set");
          if (sec == null) return;
          it.sets.forEach((s) => { s.rest = sec; });
        } else if (choice === "remove") {
          if (items[i - 1] && !it.supersetNext) items[i - 1].supersetNext = false;
          items.splice(i, 1);
        }
      } else {
        return;
      }
      if (items.length) items[items.length - 1].supersetNext = false;
      markDirty();
      draw();
    });
  }

  // Closing the picker comes back here with everything intact.
  function openPicker(title, apply) {
    syncName();
    ctx.openExercisePicker(title, (id) => {
      apply(id);
      markDirty();
      draw();
    }, { onClose: draw, exclude: items.map((it) => it.exerciseId) });
  }

  async function save() {
    syncName();
    const trimmed = name.trim();
    if (!trimmed) { toast("Give the template a name"); document.getElementById("tplNameInput").focus(); return; }
    if (!items.length) { toast("Add at least one exercise"); return; }
    const empty = items.find((it) => !it.sets.length);
    if (empty) { toast(`${ctx.exName(empty.exerciseId)} has no sets`); return; }
    const ids = items.map((it) => it.exerciseId);
    const targets = {};
    items.forEach((it, i) => {
      targets[it.exerciseId] = buildTarget(it.sets.map((s) => {
        const w = ctx.parseNum(s.w);
        return { weight: s.w === "" || isNaN(w) ? null : w, reps: s.reps, rest: s.rest };
      }), unit, it.supersetNext && i < items.length - 1);
    });
    const btn = document.getElementById("saveTplEditBtn");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (isNew || isBuiltIn) {
        const created = await ctx.db.addTemplate(ctx.user.id, trimmed, ids, targets);
        state.templates.push(created);
        if (isBuiltIn) ctx.replaceBuiltinWithCopy(template, created);
      } else {
        const updated = await ctx.db.updateTemplate(template.id, trimmed, ids, targets);
        const idx = state.templates.findIndex((t) => t.id === template.id);
        if (idx > -1) state.templates[idx] = updated;
      }
      dirty = false;
      closeSheet(true);
      ctx.renderCurrentTab();
      toast("Template saved");
    } catch (err) {
      toast("Couldn't save template: " + (err.message || String(err)));
      btn.disabled = false; btn.textContent = isNew ? "Save template" : "Save changes";
    }
  }

  draw();
}
