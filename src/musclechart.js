// "Total volume by muscle group" radial chart for the home screen.
//
// Six wedges (one per muscle group) × four concentric rings. How many rings
// a wedge fills = how much volume (sets × reps × weight) that group got,
// relative to your most-trained group — so it's a quick read of balance,
// not an absolute scale. Each group keeps one fixed color (the same one its
// tag uses elsewhere in the app), and every wedge is direct-labeled with its
// name and number, so nothing depends on telling colors apart.

// Clockwise from the top, matching the reference layout.
const GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Core", "Arms"];

// Categorical palette validated against the app's dark surface (#111318):
// lightness band, chroma, CVD + normal-vision separation for every
// neighbouring pair around the circle (incl. Arms↔Chest), and 3:1 contrast.
export const GROUP_COLORS = {
  Chest: "#3987e5",
  Back: "#d95926",
  Legs: "#199e70",
  Shoulders: "#c98500",
  Core: "#d55181",
  Arms: "#008300"
};

const RINGS = 4;
const R0 = 26, RING_W = 17, RING_GAP = 4;
const HALF_SPAN = 26.5; // degrees each side of the wedge centre (gap = 7° between wedges)

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function arcPath(r1, r2, a1, a2) {
  const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2);
  const [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  const f = (n) => n.toFixed(2);
  return `M${f(x1)} ${f(y1)} A${r2} ${r2} 0 ${large} 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${r1} ${r1} 0 ${large} 0 ${f(x4)} ${f(y4)} Z`;
}

function compact(n) {
  if (!n) return "0";
  try { return new Intl.NumberFormat(undefined, { notation: "compact", maximumSignificantDigits: 3 }).format(n); }
  catch (e) { return String(Math.round(n)); }
}

export function computeGroupVolume(history, exCat, fromKg, unit, days) {
  const since = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const vol = {};
  GROUPS.forEach((g) => { vol[g] = 0; });
  (history || []).forEach((w) => {
    if (since && new Date(w.date).getTime() < since) return;
    (w.exercises || []).forEach((ex) => {
      const g = exCat(ex.exerciseId);
      if (!(g in vol)) return;
      (ex.sets || []).forEach((s) => { vol[g] += (s.kg || 0) * (s.reps || 0); });
    });
  });
  GROUPS.forEach((g) => { vol[g] = fromKg(vol[g], unit); });
  return vol;
}

export function muscleChartHtml({ history, exCat, fromKg, unit, days, escapeHtml }) {
  const vol = computeGroupVolume(history, exCat, fromKg, unit, days);
  const max = Math.max(0, ...GROUPS.map((g) => vol[g]));
  const total = GROUPS.reduce((n, g) => n + vol[g], 0);

  const wedges = GROUPS.map((g, k) => {
    const centre = -90 + k * 60;
    const a1 = centre - HALF_SPAN, a2 = centre + HALF_SPAN;
    const level = max > 0 && vol[g] > 0 ? Math.max(1, Math.ceil((vol[g] / max) * RINGS)) : 0;
    const color = GROUP_COLORS[g];
    const rings = [];
    for (let i = 0; i < RINGS; i++) {
      const r1 = R0 + i * (RING_W + RING_GAP), r2 = r1 + RING_W;
      if (i < level) {
        const isTop = i === level - 1;
        const op = isTop ? 1 : 0.28 + 0.5 * ((i + 1) / level);
        rings.push(`<path d="${arcPath(r1, r2, a1, a2)}" fill="${color}" fill-opacity="${op.toFixed(2)}"${isTop ? ` class="mv-top" style="--mv:${color}"` : ""}/>`);
      } else {
        rings.push(`<path d="${arcPath(r1, r2, a1, a2)}" class="mv-empty"/>`);
      }
    }
    return `<g class="mv-wedge" tabindex="0" role="img" aria-label="${g}: ${compact(vol[g])} ${unit}, ${level} of ${RINGS} rings">
      <title>${g}: ${compact(vol[g])} ${unit}</title>${rings.join("")}</g>`;
  }).join("");

  const LABEL_R = 138;
  const labels = GROUPS.map((g, k) => {
    const centre = -90 + k * 60;
    let [x, y] = polar(LABEL_R, centre);
    if (k === 0) y -= 4;          // top label: nudge up, clear of the rings
    if (k === 3) y += 4;          // bottom label: nudge down
    return `<g class="mv-label">
      <text x="${x.toFixed(1)}" y="${(y - 3).toFixed(1)}" class="mv-val">${compact(vol[g])} ${unit}</text>
      <circle cx="${(x - 1 - g.length * 3.6).toFixed(1)}" cy="${(y + 11).toFixed(1)}" r="3.5" fill="${GROUP_COLORS[g]}"/>
      <text x="${(x + 6).toFixed(1)}" y="${(y + 15).toFixed(1)}" class="mv-name">${g}</text>
    </g>`;
  }).join("");

  const tableRows = GROUPS.map((g) => `<tr><th scope="row">${g}</th><td>${compact(vol[g])} ${unit}</td></tr>`).join("");

  return `
    <div class="card mv-card">
      <div class="mv-head">
        <div>
          <h3 class="mv-title">Total volume</h3>
          <p class="mv-sub">${total > 0 ? `${compact(total)} ${unit} lifted` : "Log a workout to fill this in"}</p>
        </div>
        <div class="seg-toggle mv-toggle" role="group" aria-label="Time range">
          <button type="button" data-mv-days="30" class="${days === 30 ? "active" : ""}">30 days</button>
          <button type="button" data-mv-days="0" class="${!days ? "active" : ""}">All time</button>
        </div>
      </div>
      <svg class="mv-svg" viewBox="-178 -162 356 324" aria-hidden="false" role="group" aria-label="Volume by muscle group">
        ${wedges}
        ${labels}
      </svg>
      <table class="sr-only"><caption>Volume by muscle group${days ? ", last 30 days" : ", all time"}</caption><tbody>${tableRows}</tbody></table>
    </div>`;
}
