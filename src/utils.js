export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function byId(list, id) {
  for (const item of list) if (item.id === id) return item;
  return null;
}

export function toKg(val, unit) {
  return unit === "lb" ? val / 2.20462 : val;
}

export function fromKg(kg, unit) {
  return unit === "lb" ? kg * 2.20462 : kg;
}

export function roundDisp(n) {
  return Math.round(n * 10) / 10;
}

// Weight entry has to work the same whether the phone's keypad gives you a
// comma (NL/most of Europe) or a dot (US/UK). Inputs are plain text with
// inputmode="decimal" — type="number" silently rejects a comma in some
// browsers — and we accept either separator when reading them back.
export const DEC_SEP = (() => {
  try { return new Intl.NumberFormat().format(1.5).replace(/\d/g, "") || "."; } catch (e) { return "."; }
})();

export function parseNum(v) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "" || !/^-?\d*\.?\d*$/.test(s)) return NaN;
  return parseFloat(s);
}

// Formats a number with at most one decimal, using this device's decimal
// separator — so what you see matches what your keypad types.
export function fmtNum(n) {
  if (n == null || n === "" || isNaN(n)) return "";
  const r = Math.round(Number(n) * 10) / 10;
  return String(r).replace(".", DEC_SEP);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso) {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtShort(iso) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

export function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = (h > 0 && m < 10 ? "0" : "") + m;
  const ss = (s < 10 ? "0" : "") + s;
  return (h > 0 ? h + ":" : "") + mm + ":" + ss;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}
