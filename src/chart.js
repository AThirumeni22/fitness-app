import { fromKg, roundDisp, fmtShort } from "./utils.js";

// Renders a small SVG line chart of `points` ([{date, value(kg)}, ...])
// into `container`, with a hover/tap tooltip. `metric` is "weight" or
// "volume", used only to label the tooltip.
export function drawChart(container, points, metric, unit) {
  if (!points.length) {
    container.innerHTML = '<p class="muted">No data yet.</p>';
    return;
  }
  const W = 520, H = 180, padL = 40, padR = 12, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = points.map((p) => fromKg(p.value, unit));
  let maxV = Math.max(...vals), minV = Math.min(...vals);
  if (maxV === minV) {
    maxV += 1;
    minV = Math.max(0, minV - 1);
  }
  const range = maxV - minV;
  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - minV) / range) * innerH;

  const ticks = 4;
  let gridHtml = "", labelHtml = "";
  for (let t = 0; t <= ticks; t++) {
    const v = minV + (range * t) / ticks;
    const yy = y(v);
    gridHtml += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>`;
    labelHtml += `<text x="${padL - 8}" y="${yy + 3}" text-anchor="end" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="var(--ink-faint)">${Math.round(v)}</text>`;
  }

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(fromKg(p.value, unit)).toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${x(points.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;

  const dots = points
    .map((p, i) => {
      const isLast = i === points.length - 1;
      return `<circle class="pt" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(fromKg(p.value, unit)).toFixed(1)}" r="${isLast ? 5 : 3.5}" fill="${isLast ? "var(--accent)" : "var(--surface)"}" stroke="var(--accent)" stroke-width="2"/>`;
    })
    .join("");

  const firstLabel = fmtShort(points[0].date);
  const lastLabel = fmtShort(points[points.length - 1].date);

  container.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; overflow:visible;" id="chartSvg">` +
    `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>` +
    `<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    gridHtml + labelHtml +
    `<path d="${areaPath}" fill="url(#areaGrad)" stroke="none"/>` +
    `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    dots +
    `<text x="${padL}" y="${H - 4}" font-size="10" font-family="IBM Plex Sans, sans-serif" fill="var(--ink-faint)">${firstLabel}</text>` +
    `<text x="${W - padR}" y="${H - 4}" text-anchor="end" font-size="10" font-family="IBM Plex Sans, sans-serif" fill="var(--ink-faint)">${lastLabel}</text>` +
    `</svg><div class="chart-tooltip" id="chartTooltip"></div>`;

  const tip = container.querySelector("#chartTooltip");
  const svgEl = container.querySelector("#chartSvg");

  function showTip(i) {
    const p = points[i];
    const val = roundDisp(fromKg(p.value, unit));
    tip.textContent = `${fmtShort(p.date)} · ${val}${metric === "weight" ? " " + unit : " " + unit + " vol"}`;
    const rect = container.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const px = svgRect.left - rect.left + (x(i) / W) * svgRect.width;
    const py = svgRect.top - rect.top + (y(fromKg(p.value, unit)) / H) * svgRect.height;
    tip.style.left = `${px}px`;
    tip.style.top = `${py}px`;
    tip.style.opacity = "1";
  }
  function hideTip() {
    tip.style.opacity = "0";
  }

  container.querySelectorAll(".pt").forEach((dot) => {
    dot.style.cursor = "pointer";
    dot.addEventListener("mouseenter", () => showTip(parseInt(dot.getAttribute("data-i"), 10)));
    dot.addEventListener("mouseleave", hideTip);
    dot.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        showTip(parseInt(dot.getAttribute("data-i"), 10));
      },
      { passive: false }
    );
  });
  container.addEventListener("mouseleave", hideTip);
}
