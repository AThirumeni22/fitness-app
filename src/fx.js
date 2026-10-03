// fx.js — purely presentational interaction layer.
// Everything here is delegated / observer-based so it works with the app's
// innerHTML re-renders without touching any app logic. Safe to remove: delete
// this file and its import in main.js and the app behaves exactly as before.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionOK = () => !reduceMotion.matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

/* ---------- 1. press ripple ---------- */
const RIPPLE_SEL = ".btn, .chip-btn, .icon-btn, .home-tile, .tabbar button, .cat-chip, .seg-toggle button, .metric-toggle button, .preset-row button, .auth-tabs button, .wb-big";
document.addEventListener("pointerdown", (e) => {
  if (!motionOK()) return;
  const el = e.target.closest(RIPPLE_SEL);
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "fx-ripple";
  s.style.width = s.style.height = size + "px";
  s.style.left = (e.clientX - r.left - size / 2) + "px";
  s.style.top = (e.clientY - r.top - size / 2) + "px";
  el.appendChild(s);
  s.addEventListener("animationend", () => s.remove());
}, { passive: true });

/* ---------- 2. cursor spotlight on surfaces + tilt on home tiles ---------- */
const SPOT_SEL = ".card, .xcard, .session-card, .tpl-list-card, .pin-tile, .feed-card, .plan-card, .dw-card, .home-tile, .stat-tile, .auth-card, details.cat-group";
document.addEventListener("pointermove", (e) => {
  if (!finePointer.matches) return;
  const el = e.target.closest(SPOT_SEL);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  el.style.setProperty("--mx", x + "px");
  el.style.setProperty("--my", y + "px");
  if (motionOK() && el.classList.contains("home-tile")) {
    el.style.setProperty("--rx", ((x / r.width - 0.5) * 10).toFixed(2) + "deg");
    el.style.setProperty("--ry", ((0.5 - y / r.height) * 10).toFixed(2) + "deg");
  }
}, { passive: true });
document.addEventListener("pointerout", (e) => {
  if (!finePointer.matches) return;
  const el = e.target.closest && e.target.closest(".home-tile");
  if (el && !el.contains(e.relatedTarget)) { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); }
}, { passive: true });

/* ---------- 3. sliding tab-bar indicator ---------- */
function setupTabbar(bar) {
  if (bar.dataset.fx) return;
  bar.dataset.fx = "1";
  bar.classList.add("has-ind");
  const ind = document.createElement("span");
  ind.className = "tab-ind";
  ind.setAttribute("aria-hidden", "true");
  bar.prepend(ind);
  let raf = 0, until = 0;
  const place = () => {
    const a = bar.querySelector("button.active");
    if (!a) return;
    ind.style.transform = `translateX(${a.offsetLeft}px)`;
    ind.style.width = a.offsetWidth + "px";
  };
  // the active button's label animates its width, so follow it for a moment
  const follow = () => {
    until = performance.now() + 520;
    cancelAnimationFrame(raf);
    const step = () => { place(); if (performance.now() < until) raf = requestAnimationFrame(step); };
    step();
  };
  new MutationObserver(follow).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", place);
  ind.classList.add("instant");
  place();
  requestAnimationFrame(() => ind.classList.remove("instant"));
  follow();
}

/* ---------- 4. count-up numbers ---------- */
function countUp(el) {
  if (el.dataset.counted) return;
  el.dataset.counted = "1";
  const raw = el.textContent.trim();
  if (!/^[\d,]+(\.\d+)?$/.test(raw) || !motionOK()) return;
  const target = parseFloat(raw.replace(/,/g, ""));
  if (!isFinite(target) || target === 0) return;
  const decimals = (raw.split(".")[1] || "").length;
  const useCommas = raw.includes(",") || target >= 1000;
  const fmt = (v) => useCommas
    ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals);
  const dur = 900, t0 = performance.now();
  const step = (t) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(target * eased);
    if (p < 1) requestAnimationFrame(step); else el.textContent = raw;
  };
  requestAnimationFrame(step);
}

/* ---------- 5. set-complete burst + haptic ---------- */
function burst(x, y, color) {
  if (!motionOK()) return;
  const b = document.createElement("div");
  b.className = "fx-burst";
  b.style.left = x + "px"; b.style.top = y + "px";
  if (color) b.style.setProperty("--c", color);
  for (let i = 0; i < 10; i++) {
    const p = document.createElement("i");
    p.style.setProperty("--a", (i * 36) + "deg");
    p.style.setProperty("--d", (22 + Math.random() * 14) + "px");
    b.appendChild(p);
  }
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 700);
}
// Called by the workout screen once a set's row has re-rendered as done.
export function celebrateSet(btn) {
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
  const row = btn.closest(".xs-row");
  if (row) { row.classList.remove("fx-done"); void row.offsetWidth; row.classList.add("fx-done"); }
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
}

/* ---------- 6. confetti for PRs and finished workouts ---------- */
const CONFETTI = ["#818CF8", "#22D3EE", "#A78BFA", "#FBBF24", "#F472B6", "#34D399"];
function confetti() {
  if (!motionOK() || !document.body.animate) return;
  const host = document.createElement("div");
  host.className = "fx-confetti";
  document.body.appendChild(host);
  const W = window.innerWidth, H = window.innerHeight;
  const count = finePointer.matches ? 70 : 36; // lighter on phones
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const c = CONFETTI[i % CONFETTI.length];
    p.style.background = c;
    p.style.left = (W / 2) + "px";
    p.style.top = (H * 0.62) + "px";
    if (i % 3 === 0) p.style.borderRadius = "50%";
    host.appendChild(p);
    const ang = (-90 + (Math.random() - 0.5) * 110) * Math.PI / 180;
    const v = 260 + Math.random() * 320;
    const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v;
    const rot = (Math.random() - 0.5) * 900;
    p.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.8}px, ${dy}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy + H * 0.55}px) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" });
  }
  setTimeout(() => host.remove(), 2400);
}
function watchToast(t) {
  if (t.dataset.fx) return;
  t.dataset.fx = "1";
  new MutationObserver(() => {
    if (t.hidden) return;
    const msg = t.textContent || "";
    if (/New PR|Workout saved|Template updated/.test(msg)) { confetti(); t.classList.add("celebrate"); }
    else t.classList.remove("celebrate");
  }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

/* ---------- 7. entry animations only when a view actually changes ----------
   The app re-renders whole tabs on every edit (adding a set, toggling a
   chart range). Without this, every card re-plays its entrance each time. */
function viewSig(tab) {
  const f = tab.firstElementChild;
  return f ? f.tagName + "." + f.className : "";
}
function watchTab(tab) {
  if (tab.dataset.fx) return;
  tab.dataset.fx = "1";
  let sig = viewSig(tab);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes" && m.attributeName === "hidden" && !tab.hidden) { tab.removeAttribute("data-settled"); sig = viewSig(tab); }
      if (m.type === "childList") {
        const s = viewSig(tab);
        if (s !== sig) { tab.removeAttribute("data-settled"); sig = s; }
      }
    }
  }).observe(tab, { childList: true, attributes: true, attributeFilter: ["hidden"] });
}
document.addEventListener("pointerdown", (e) => {
  const tab = e.target.closest && e.target.closest(".tab");
  if (tab) setTimeout(() => tab.setAttribute("data-settled", ""), 0);
}, true);
document.addEventListener("keydown", (e) => {
  const tab = e.target.closest && e.target.closest(".tab");
  if (tab) tab.setAttribute("data-settled", "");
}, true);

/* ---------- 8. topbar lifts once you scroll ---------- */
let scrollRaf = 0;
window.addEventListener("scroll", () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const tb = document.querySelector(".topbar");
    if (tb) tb.classList.toggle("scrolled", window.scrollY > 6);
  });
}, { passive: true });

/* ---------- wire-up: scan whenever the DOM changes ---------- */
function scan(root) {
  const q = (s) => (root.querySelectorAll ? root.querySelectorAll(s) : []);
  q(".tabbar").forEach(setupTabbar);
  q(".stat-tile .v, .dw-stats .v").forEach(countUp);
  q("#toast").forEach(watchToast);
  q(".tab").forEach(watchTab);
}
let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; scan(document); });
}).observe(document.body, { childList: true, subtree: true });
scan(document);
