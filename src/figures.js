// Drawn exercise animations: a simple grey mannequin that moves between a
// start and an end pose, with the equipment (barbell, dumbbells, cable,
// machine pads, bench…) drawn around it. Pure SVG + SMIL, no images.
//
// Poses are joint angles (degrees; 0 = pointing right, 90 = down, -90 = up).
// The figure faces right in side view. Each pose is built from the hip
// outwards, then shifted so its `anchor` joint sits at `at` — that keeps
// feet planted in a squat, hands on the bar in a pull-up, and so on.

const L = { torso: 27, neck: 8, head: 6.2, ua: 13.5, fa: 13, th: 17, sh: 17, foot: 6 };
const rad = (d) => (d * Math.PI) / 180;
const step = (p, len, deg) => [p[0] + len * Math.cos(rad(deg)), p[1] + len * Math.sin(rad(deg))];
const r1 = (n) => Math.round(n * 10) / 10;

// Side-view skeleton. pose: { torso, ua, fa, th, sh, ua2?, fa2?, th2?, sh2?,
//   anchor: "hip"|"ankle"|"ankle2"|"neck"|"hand"|"knee", at: [x, y], torsoLen?, footDeg? }
function sideJoints(p) {
  const hip = [0, 0];
  const neck = step(hip, p.torsoLen || L.torso, p.torso);
  const head = step(neck, L.neck, p.headDeg ?? p.torso);
  const elbow = step(neck, L.ua, p.ua), hand = step(elbow, L.fa, p.fa);
  const elbow2 = step(neck, L.ua, p.ua2 ?? p.ua), hand2 = step(elbow2, L.fa, p.fa2 ?? p.fa);
  const knee = step(hip, L.th, p.th), ankle = step(knee, L.sh, p.sh);
  const knee2 = step(hip, L.th, p.th2 ?? p.th), ankle2 = step(knee2, L.sh, p.sh2 ?? p.sh);
  const toe = step(ankle, L.foot, p.footDeg ?? (p.sh - 90));
  const toe2 = step(ankle2, L.foot, p.footDeg2 ?? p.footDeg ?? ((p.sh2 ?? p.sh) - 90));
  const j = { hip, neck, head, elbow, hand, elbow2, hand2, knee, ankle, knee2, ankle2, toe, toe2 };
  const a = j[p.anchor || "hip"];
  const at = p.at || [50, 60];
  const dx = at[0] - a[0], dy = at[1] - a[1];
  Object.keys(j).forEach((k) => { j[k] = [j[k][0] + dx, j[k][1] + dy]; });
  return j;
}

// Front-view skeleton (lateral raises, flys, hip abduction). Arms/legs are
// mirrored; angles describe the figure's right side (screen left).
function frontJoints(p) {
  const cx = 50, hipY = p.hipY ?? 60;
  const neck = [cx, hipY - L.torso];
  const head = [cx, neck[1] - L.neck];
  const shR = [cx - 8, neck[1] + 2], shL = [cx + 8, neck[1] + 2];
  const hipR = [cx - 5, hipY], hipL = [cx + 5, hipY];
  const mir = (deg) => 180 - deg;
  const elbow = step(shR, L.ua, p.ua), hand = step(elbow, L.fa, p.fa);
  const elbow2 = step(shL, L.ua, mir(p.ua)), hand2 = step(elbow2, L.fa, mir(p.fa));
  const thLen = p.seated ? 7 : L.th;
  const knee = step(hipR, thLen, p.th ?? 92), ankle = step(knee, L.sh, p.sh ?? 90);
  const knee2 = step(hipL, thLen, mir(p.th ?? 92)), ankle2 = step(knee2, L.sh, mir(p.sh ?? 90));
  return { neck, head, shR, shL, hipR, hipL, elbow, hand, elbow2, hand2, knee, ankle, knee2, ankle2, hip: [cx, hipY] };
}

/* ---------- SVG helpers (static, or animated A → B → A) ---------- */
const DUR = "2.6s";
const SPL = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"';
function anim(attr, a, b) {
  return a === b ? "" : `<animate attributeName="${attr}" values="${a};${b};${a}" dur="${DUR}" repeatCount="indefinite" ${SPL}/>`;
}
function seg(A, B, k1, k2, cls, animate) {
  const [x1, y1, x2, y2] = [r1(A[k1][0]), r1(A[k1][1]), r1(A[k2][0]), r1(A[k2][1])];
  if (!animate || !B) return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const [bx1, by1, bx2, by2] = [r1(B[k1][0]), r1(B[k1][1]), r1(B[k2][0]), r1(B[k2][1])];
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${anim("x1", x1, bx1)}${anim("y1", y1, by1)}${anim("x2", x2, bx2)}${anim("y2", y2, by2)}</line>`;
}
function dot(A, B, k, r, cls, animate) {
  const [x, y] = [r1(A[k][0]), r1(A[k][1])];
  if (!animate || !B) return `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`;
  return `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}">${anim("cx", x, r1(B[k][0]))}${anim("cy", y, r1(B[k][1]))}</circle>`;
}
// A prop drawn around (0,0) that follows joint k.
function follow(A, B, k, inner, animate, rotA = 0, rotB = rotA) {
  const a = `${r1(A[k][0])},${r1(A[k][1])}`;
  if (!animate || !B) return `<g transform="translate(${a}) rotate(${rotA})">${inner}</g>`;
  const b = `${r1(B[k][0])},${r1(B[k][1])}`;
  const rot = rotA === rotB ? "" : `<animateTransform attributeName="transform" type="rotate" additive="sum" values="${rotA};${rotB};${rotA}" dur="${DUR}" repeatCount="indefinite" ${SPL}/>`;
  return `<g><g transform="translate(${a})"><animateTransform attributeName="transform" type="translate" values="${a};${b};${a}" dur="${DUR}" repeatCount="indefinite" ${SPL}/><g transform="rotate(${rotA})">${rot}${inner}</g></g></g>`;
}
// A cable from a fixed pulley to joint k.
function cable(A, B, k, anchor, animate) {
  const pul = `<circle class="fg-pulley" cx="${anchor[0]}" cy="${anchor[1]}" r="2.6"/>`;
  const line = animate && B
    ? `<line class="fg-cable" x1="${anchor[0]}" y1="${anchor[1]}" x2="${r1(A[k][0])}" y2="${r1(A[k][1])}">${anim("x2", r1(A[k][0]), r1(B[k][0]))}${anim("y2", r1(A[k][1]), r1(B[k][1]))}</line>`
    : `<line class="fg-cable" x1="${anchor[0]}" y1="${anchor[1]}" x2="${r1(A[k][0])}" y2="${r1(A[k][1])}"/>`;
  return line + pul;
}

const PLATE = '<circle class="fg-plate" r="7.5"/><circle class="fg-hub" r="1.6"/>';
const DB = '<rect class="fg-db" x="-4.5" y="-2.2" width="9" height="4.4" rx="1.6"/><rect class="fg-db-end" x="-5.5" y="-3.3" width="2.4" height="6.6" rx="1"/><rect class="fg-db-end" x="3.1" y="-3.3" width="2.4" height="6.6" rx="1"/>';
const HANDLE = '<rect class="fg-handle" x="-3.2" y="-1.4" width="6.4" height="2.8" rx="1.4"/>';
const KB = '<circle class="fg-db" r="4.2" cy="2"/><path class="fg-db-end" d="M-2.6 -1.5 Q0 -5.5 2.6 -1.5" fill="none" stroke-width="1.6"/>';

/* ---------- movement patterns ---------- */
// Each returns { view, A, B, env(static svg), hold: prop joint, cableFrom?, bar? }
const STAND = { torso: -90, ua: 90, fa: 90, th: 90, sh: 90, anchor: "ankle", at: [48, 93] };
const P = {
  benchPress: { A: { torso: 180, ua: 100, fa: -90, th: 25, sh: 95, anchor: "hip", at: [64, 63] }, B: { torso: 180, ua: -90, fa: -90, th: 25, sh: 95, anchor: "hip", at: [64, 63] }, env: "bench", hold: "hand" },
  inclinePress: { A: { torso: -140, ua: 110, fa: -75, th: 5, sh: 92, anchor: "hip", at: [60, 70] }, B: { torso: -140, ua: -75, fa: -75, th: 5, sh: 92, anchor: "hip", at: [60, 70] }, env: "incline", hold: "hand" },
  declinePress: { A: { torso: 165, ua: 105, fa: -80, th: 20, sh: 90, anchor: "hip", at: [62, 60] }, B: { torso: 165, ua: -85, fa: -85, th: 20, sh: 90, anchor: "hip", at: [62, 60] }, env: "bench", hold: "hand" },
  chestPress: { A: { torso: -92, ua: 120, fa: -8, th: 0, sh: 90, anchor: "hip", at: [38, 76] }, B: { torso: -92, ua: 2, fa: 0, th: 0, sh: 90, anchor: "hip", at: [38, 76] }, env: "seat", hold: "hand" },
  pushUp: { A: { torso: -6, headDeg: -10, ua: 150, fa: 75, th: 172, sh: 174, anchor: "hand", at: [66, 92] }, B: { torso: -22, headDeg: -22, ua: 92, fa: 90, th: 157, sh: 160, anchor: "hand", at: [66, 92] }, env: "floor" },
  dip: { A: { torso: -82, ua: 140, fa: 40, th: 100, sh: 150, anchor: "hand", at: [52, 50] }, B: { torso: -90, ua: 92, fa: 88, th: 100, sh: 150, anchor: "hand", at: [52, 50] }, env: "dipBars" },
  flyFront: { view: "front", A: { ua: 175, fa: 185, hipY: 62 }, B: { ua: 110, fa: 30, hipY: 62 }, env: "floorFront", hold: "hand" },
  ohp: { A: { ...STAND, ua: 55, fa: -95 }, B: { ...STAND, ua: -85, fa: -88 }, env: "floor", hold: "hand" },
  seatedOhp: { A: { torso: -90, ua: 55, fa: -95, th: 0, sh: 90, anchor: "hip", at: [44, 76] }, B: { torso: -90, ua: -85, fa: -88, th: 0, sh: 90, anchor: "hip", at: [44, 76] }, env: "seat", hold: "hand" },
  lateral: { view: "front", A: { ua: 98, fa: 95 }, B: { ua: 185, fa: 180 }, env: "floorFront", hold: "hand" },
  frontRaise: { A: { ...STAND, ua: 85, fa: 85 }, B: { ...STAND, ua: -5, fa: -8 }, env: "floor", hold: "hand" },
  rearFly: { A: { torso: -25, ua: 95, fa: 92, th: 70, sh: 100, anchor: "ankle", at: [44, 93] }, B: { torso: -25, ua: 185, fa: 190, th: 70, sh: 100, anchor: "ankle", at: [44, 93] }, env: "floor", hold: "hand" },
  facePull: { A: { ...STAND, ua: -5, fa: -5 }, B: { ...STAND, ua: 190, fa: -25 }, env: "floor", hold: "hand", cableFrom: [94, 26] },
  uprightRow: { A: { ...STAND, ua: 82, fa: 88 }, B: { ...STAND, ua: -25, fa: 120 }, env: "floor", hold: "hand" },
  shrug: { A: { ...STAND, ua: 90, fa: 90 }, B: { ...STAND, torsoLen: 30.5, ua: 90, fa: 90 }, env: "floor", hold: "hand" },
  bentRow: { A: { torso: -32, headDeg: -20, ua: 92, fa: 90, th: 72, sh: 100, anchor: "ankle", at: [44, 93] }, B: { torso: -32, headDeg: -20, ua: 168, fa: 92, th: 72, sh: 100, anchor: "ankle", at: [44, 93] }, env: "floor", hold: "hand" },
  seatedRow: { A: { torso: -95, ua: 2, fa: 2, th: -6, sh: 10, anchor: "hip", at: [30, 78] }, B: { torso: -95, ua: 150, fa: 5, th: -6, sh: 10, anchor: "hip", at: [30, 78] }, env: "rowSeat", hold: "hand", cableFrom: [93, 54] },
  pulldown: { A: { torso: -96, ua: -82, fa: -86, th: 0, sh: 90, anchor: "hip", at: [44, 74] }, B: { torso: -100, ua: 100, fa: -70, th: 0, sh: 90, anchor: "hip", at: [44, 74] }, env: "pulldownSeat", hold: "hand", cableFrom: [48, 4] },
  straightPulldown: { A: { torso: -75, ua: -45, fa: -45, th: 92, sh: 92, anchor: "ankle", at: [40, 93] }, B: { torso: -75, ua: 75, fa: 75, th: 92, sh: 92, anchor: "ankle", at: [40, 93] }, env: "floor", hold: "hand", cableFrom: [88, 8] },
  pullUp: { A: { torso: -90, ua: -88, fa: -92, th: 100, sh: 125, anchor: "hand", at: [50, 11] }, B: { torso: -90, ua: -150, fa: -28, th: 100, sh: 125, anchor: "hand", at: [50, 11] }, env: "bar" },
  deadlift: { A: { torso: -28, headDeg: -15, ua: 90, fa: 90, th: 18, sh: 110, anchor: "ankle", at: [46, 93] }, B: { torso: -90, ua: 92, fa: 90, th: 92, sh: 90, anchor: "ankle", at: [46, 93] }, env: "floor", hold: "hand", thumb: "A" },
  rdl: { A: { torso: -18, headDeg: -10, ua: 92, fa: 90, th: 75, sh: 98, anchor: "ankle", at: [46, 93] }, B: { torso: -88, ua: 92, fa: 90, th: 90, sh: 92, anchor: "ankle", at: [46, 93] }, env: "floor", hold: "hand", thumb: "A" },
  squat: { A: { torso: -88, ua: 150, fa: -40, th: 92, sh: 90, anchor: "ankle", at: [48, 93] }, B: { torso: -55, headDeg: -70, ua: 165, fa: -30, th: 8, sh: 118, anchor: "ankle", at: [48, 93] }, env: "floor", hold: "neck" },
  frontSquat: { A: { torso: -88, ua: 35, fa: -150, th: 92, sh: 90, anchor: "ankle", at: [48, 93] }, B: { torso: -68, ua: 50, fa: -140, th: 8, sh: 118, anchor: "ankle", at: [48, 93] }, env: "floor", hold: "hand" },
  gobletSquat: { A: { torso: -88, ua: 70, fa: -120, th: 92, sh: 90, anchor: "ankle", at: [48, 93] }, B: { torso: -70, ua: 85, fa: -105, th: 8, sh: 118, anchor: "ankle", at: [48, 93] }, env: "floor", hold: "hand" },
  hackSquat: { A: { torso: -110, ua: 120, fa: -50, th: 100, sh: 80, anchor: "ankle", at: [56, 90] }, B: { torso: -110, ua: 120, fa: -50, th: 15, sh: 110, anchor: "ankle", at: [56, 90] }, env: "hackSled", hold: "neck" },
  lunge: { A: { torso: -90, ua: 90, fa: 90, th: 88, sh: 92, th2: 95, sh2: 88, anchor: "ankle", at: [58, 93] }, B: { torso: -90, ua: 90, fa: 90, th: -5, sh: 95, th2: 115, sh2: 175, footDeg2: 160, anchor: "ankle", at: [58, 93] }, env: "floor", hold: "hand" },
  splitSquat: { A: { torso: -90, ua: 90, fa: 90, th: 75, sh: 100, th2: 125, sh2: 180, footDeg2: 180, anchor: "ankle", at: [60, 93] }, B: { torso: -85, ua: 90, fa: 90, th: 5, sh: 100, th2: 110, sh2: 175, footDeg2: 180, anchor: "ankle", at: [60, 93] }, env: "benchBack", hold: "hand" },
  stepUp: { A: { torso: -84, ua: 90, fa: 90, th: 3, sh: 100, th2: 100, sh2: 95, anchor: "ankle", at: [62, 78] }, B: { torso: -90, ua: 90, fa: 90, th: 90, sh: 90, th2: 115, sh2: 80, footDeg2: 10, anchor: "ankle", at: [62, 78] }, env: "box", hold: "hand" },
  legPress: { A: { torso: -150, ua: 60, fa: 20, th: -55, sh: 25, anchor: "hip", at: [36, 72] }, B: { torso: -150, ua: 60, fa: 20, th: -28, sh: -24, anchor: "hip", at: [36, 72] }, env: "legPress", hold: "ankle" },
  legExt: { A: { torso: -96, ua: 95, fa: 70, th: 0, sh: 95, anchor: "hip", at: [42, 70] }, B: { torso: -96, ua: 95, fa: 70, th: 0, sh: 5, anchor: "hip", at: [42, 70] }, env: "legExtSeat", hold: "ankle" },
  lyingCurl: { A: { torso: 180, headDeg: 175, ua: 120, fa: 30, th: 0, sh: 0, anchor: "hip", at: [52, 64] }, B: { torso: 180, headDeg: 175, ua: 120, fa: 30, th: 0, sh: -115, footDeg: -25, anchor: "hip", at: [52, 64] }, env: "flatBench", hold: "ankle" },
  seatedCurl: { A: { torso: -96, ua: 95, fa: 70, th: 0, sh: 8, anchor: "hip", at: [40, 70] }, B: { torso: -96, ua: 95, fa: 70, th: 0, sh: 125, anchor: "hip", at: [40, 70] }, env: "legExtSeat", hold: "ankle" },
  calfRaise: { A: { ...STAND, footDeg: 0, anchor: "toe", at: [54, 93] }, B: { ...STAND, footDeg: 50, anchor: "toe", at: [54, 93] }, env: "step", hold: "hand" },
  seatedCalf: { A: { torso: -90, ua: 70, fa: 20, th: 0, sh: 90, footDeg: 0, anchor: "toe", at: [64, 93] }, B: { torso: -90, ua: 70, fa: 20, th: 0, sh: 90, footDeg: 45, anchor: "toe", at: [64, 93] }, env: "step", hold: "knee" },
  hipThrust: { A: { torso: -160, headDeg: -160, ua: 60, fa: 20, th: 20, sh: 95, anchor: "ankle", at: [66, 93] }, B: { torso: 180, headDeg: 180, ua: 60, fa: 20, th: 56, sh: 95, anchor: "ankle", at: [66, 93] }, env: "thrustBench", hold: "hip" },
  abduction: { view: "front", A: { ua: 120, fa: 60, th: 95, sh: 90, seated: true, hipY: 66 }, B: { ua: 120, fa: 60, th: 125, sh: 118, seated: true, hipY: 66 }, env: "frontSeat" },
  adduction: { view: "front", A: { ua: 120, fa: 60, th: 125, sh: 118, seated: true, hipY: 66 }, B: { ua: 120, fa: 60, th: 95, sh: 90, seated: true, hipY: 66 }, env: "frontSeat" },
  kickback: { A: { torso: -70, ua: 30, fa: 30, th: 95, sh: 92, th2: 90, sh2: 90, anchor: "ankle2", at: [46, 93] }, B: { torso: -70, ua: 30, fa: 30, th: 150, sh: 160, th2: 90, sh2: 90, anchor: "ankle2", at: [46, 93] }, env: "floor", hold: "ankle", cableFrom: [80, 88] },
  backExt: { A: { torso: 100, headDeg: 110, ua: 60, fa: 100, th: 175, sh: 178, anchor: "hip", at: [54, 52] }, B: { torso: 5, headDeg: 0, ua: 60, fa: 100, th: 175, sh: 178, anchor: "hip", at: [54, 52] }, env: "hyper" },
  curl: { A: { ...STAND, ua: 92, fa: 90 }, B: { ...STAND, ua: 96, fa: -65 }, env: "floor", hold: "hand" },
  preacherCurl: { A: { torso: -85, ua: 40, fa: 45, th: 0, sh: 90, anchor: "hip", at: [40, 74] }, B: { torso: -85, ua: 40, fa: -80, th: 0, sh: 90, anchor: "hip", at: [40, 74] }, env: "preacher", hold: "hand" },
  pushdown: { A: { ...STAND, ua: 98, fa: -25 }, B: { ...STAND, ua: 98, fa: 88 }, env: "floor", hold: "hand", cableFrom: [70, 6] },
  overheadExt: { A: { ...STAND, ua: -105, fa: 95 }, B: { ...STAND, ua: -100, fa: -92 }, env: "floor", hold: "hand" },
  overheadExtCable: { A: { torso: -60, ua: -45, fa: 140, th: 72, sh: 100, anchor: "ankle", at: [36, 93] }, B: { torso: -60, ua: -45, fa: -40, th: 72, sh: 100, anchor: "ankle", at: [36, 93] }, env: "floor", hold: "hand", cableFrom: [10, 74] },
  skullCrusher: { A: { torso: 180, ua: -105, fa: 165, th: 25, sh: 95, anchor: "hip", at: [64, 63] }, B: { torso: 180, ua: -100, fa: -95, th: 25, sh: 95, anchor: "hip", at: [64, 63] }, env: "bench", hold: "hand" },
  crunch: { A: { torso: 180, headDeg: 180, ua: 200, fa: 20, th: -45, sh: 50, anchor: "hip", at: [58, 89] }, B: { torso: -150, headDeg: -140, ua: 210, fa: 30, th: -45, sh: 50, anchor: "hip", at: [58, 89] }, env: "floor" },
  cableCrunch: { A: { torso: -80, ua: -60, fa: 200, th: 0, sh: 90, footDeg: 180, anchor: "knee", at: [48, 91] }, B: { torso: -15, headDeg: 30, ua: 30, fa: -60, th: 0, sh: 90, footDeg: 180, anchor: "knee", at: [48, 91] }, env: "floor", hold: "hand", cableFrom: [72, 6] },
  machineCrunch: { A: { torso: -95, ua: -40, fa: 10, th: 0, sh: 90, anchor: "hip", at: [40, 74] }, B: { torso: -40, headDeg: -20, ua: 20, fa: 60, th: 0, sh: 90, anchor: "hip", at: [40, 74] }, env: "seat", hold: "hand" },
  hangingLegRaise: { A: { torso: -90, ua: -90, fa: -90, th: 92, sh: 92, anchor: "hand", at: [50, 11] }, B: { torso: -90, ua: -90, fa: -90, th: -5, sh: -5, anchor: "hand", at: [50, 11] }, env: "bar" },
  lyingLegRaise: { A: { torso: 180, headDeg: 180, ua: 175, fa: 180, th: 0, sh: 0, anchor: "hip", at: [52, 88] }, B: { torso: 180, headDeg: 180, ua: 175, fa: 180, th: -85, sh: -85, anchor: "hip", at: [52, 88] }, env: "floor" },
  plank: { A: { torso: 178, headDeg: 175, ua: 95, fa: 180, th: 3, sh: 4, anchor: "elbow", at: [28, 92] }, B: { torso: 174, headDeg: 172, ua: 95, fa: 180, th: 6, sh: 6, anchor: "elbow", at: [28, 92] }, env: "floor" },
  sidePlank: { A: { torso: 160, headDeg: 155, ua: 90, fa: 180, th: -15, sh: -14, anchor: "elbow", at: [30, 92] }, B: { torso: 152, headDeg: 150, ua: 90, fa: 180, th: -24, sh: -22, anchor: "elbow", at: [30, 92] }, env: "floor" },
  russianTwist: { A: { torso: -125, ua: 40, fa: 10, th: -25, sh: 40, anchor: "hip", at: [46, 88] }, B: { torso: -125, ua: 80, fa: 60, th: -25, sh: 40, anchor: "hip", at: [46, 88] }, env: "floor", hold: "hand" },
  woodchop: { A: { ...STAND, torso: -95, ua: -40, fa: -40 }, B: { ...STAND, torso: -80, ua: 60, fa: 75 }, env: "floor", hold: "hand", cableFrom: [92, 10] },
  abWheel: { A: { torso: -40, headDeg: -10, ua: 92, fa: 90, th: 85, sh: 180, footDeg: 180, anchor: "knee", at: [36, 91] }, B: { torso: -8, headDeg: -5, ua: 10, fa: 15, th: 20, sh: 180, footDeg: 180, anchor: "knee", at: [36, 91] }, env: "floor", hold: "hand" },
  stand: { A: { ...STAND }, B: { ...STAND, ua: 95, fa: 95 }, env: "floor" }
};

/* ---------- environment (static) ---------- */
const ENV = {
  floor: '<line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  floorFront: '<line class="fg-floor" x1="14" y1="94" x2="86" y2="94"/>',
  bench: '<rect class="fg-bench" x="22" y="66" width="52" height="5" rx="2"/><line class="fg-frame" x1="28" y1="71" x2="28" y2="94"/><line class="fg-frame" x1="68" y1="71" x2="68" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  flatBench: '<rect class="fg-bench" x="18" y="67" width="54" height="5" rx="2"/><line class="fg-frame" x1="24" y1="72" x2="24" y2="94"/><line class="fg-frame" x1="66" y1="72" x2="66" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  incline: '<line class="fg-pad" x1="62" y1="74" x2="38" y2="52"/><rect class="fg-bench" x="54" y="72" width="16" height="5" rx="2"/><line class="fg-frame" x1="60" y1="77" x2="60" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  seat: '<rect class="fg-bench" x="32" y="78" width="22" height="5" rx="2"/><line class="fg-pad" x1="38" y1="78" x2="38" y2="46"/><line class="fg-frame" x1="44" y1="83" x2="44" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  rowSeat: '<rect class="fg-bench" x="16" y="80" width="30" height="5" rx="2"/><line class="fg-pad" x1="68" y1="64" x2="68" y2="84"/><line class="fg-frame" x1="93" y1="40" x2="93" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  pulldownSeat: '<rect class="fg-bench" x="34" y="76" width="20" height="5" rx="2"/><rect class="fg-pad-r" x="55" y="68" width="10" height="5" rx="2.5"/><line class="fg-frame" x1="44" y1="81" x2="44" y2="94"/><line class="fg-frame" x1="20" y1="4" x2="76" y2="4"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  bar: '<line class="fg-bar" x1="22" y1="11" x2="78" y2="11"/><line class="fg-frame" x1="24" y1="11" x2="24" y2="94"/><line class="fg-frame" x1="76" y1="11" x2="76" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  dipBars: '<line class="fg-bar" x1="34" y1="52" x2="70" y2="52"/><line class="fg-frame" x1="38" y1="52" x2="38" y2="94"/><line class="fg-frame" x1="66" y1="52" x2="66" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  hackSled: '<line class="fg-pad" x1="44" y1="84" x2="22" y2="20"/><line class="fg-frame" x1="62" y1="90" x2="38" y2="14"/><rect class="fg-bench" x="46" y="90" width="20" height="3" rx="1.5"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  legPress: '<rect class="fg-bench" x="18" y="72" width="24" height="5" rx="2"/><line class="fg-pad" x1="24" y1="72" x2="8" y2="50"/><line class="fg-frame" x1="30" y1="77" x2="30" y2="94"/><line class="fg-frame" x1="40" y1="94" x2="90" y2="30"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  legExtSeat: '<rect class="fg-bench" x="30" y="72" width="30" height="5" rx="2"/><line class="fg-pad" x1="35" y1="72" x2="33" y2="44"/><line class="fg-frame" x1="45" y1="77" x2="45" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  preacher: '<rect class="fg-bench" x="28" y="76" width="22" height="5" rx="2"/><line class="fg-pad" x1="48" y1="68" x2="60" y2="56"/><line class="fg-frame" x1="54" y1="62" x2="54" y2="94"/><line class="fg-frame" x1="38" y1="81" x2="38" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  step: '<rect class="fg-bench" x="44" y="93" width="22" height="3" rx="1"/><line class="fg-floor" x1="6" y1="96" x2="94" y2="96"/>',
  box: '<rect class="fg-bench" x="50" y="78" width="26" height="16" rx="2"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  benchBack: '<rect class="fg-bench" x="8" y="72" width="22" height="5" rx="2"/><line class="fg-frame" x1="14" y1="77" x2="14" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  thrustBench: '<rect class="fg-bench" x="6" y="62" width="22" height="6" rx="2"/><line class="fg-frame" x1="12" y1="68" x2="12" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  hyper: '<rect class="fg-pad-r" x="48" y="54" width="14" height="6" rx="3"/><line class="fg-frame" x1="55" y1="60" x2="70" y2="94"/><line class="fg-frame" x1="78" y1="60" x2="84" y2="94"/><line class="fg-floor" x1="6" y1="94" x2="94" y2="94"/>',
  frontSeat: '<rect class="fg-bench" x="30" y="64" width="40" height="6" rx="2"/><line class="fg-floor" x1="14" y1="94" x2="86" y2="94"/>'
};

// Machine handles / pads that ride on the moving joint.
const MACHINE_PROP = { legPress: '<line class="fg-pad" x1="0" y1="-9" x2="0" y2="9"/>', legExt: '<rect class="fg-pad-r" x="-3" y="-3" width="6" height="6" rx="3"/>', lyingCurl: '<rect class="fg-pad-r" x="-3" y="-3" width="6" height="6" rx="3"/>', seatedCurl: '<rect class="fg-pad-r" x="-3" y="-3" width="6" height="6" rx="3"/>', hipThrust: '<rect class="fg-plate" x="-6" y="-4" width="12" height="4" rx="2"/>' };

function bodySvg(view, A, B, animate) {
  const s = (k1, k2, cls) => seg(A, B, k1, k2, cls, animate);
  if (view === "front") {
    return `<g class="fg-far">${s("shL", "elbow2", "fg-limb")}${s("elbow2", "hand2", "fg-limb")}${s("hipL", "knee2", "fg-limb")}${s("knee2", "ankle2", "fg-limb")}</g>
      ${s("neck", "hip", "fg-torso")}${seg(A, B, "shR", "shL", "fg-limb", animate)}${seg(A, B, "hipR", "hipL", "fg-limb", animate)}
      ${s("shR", "elbow", "fg-limb")}${s("elbow", "hand", "fg-limb")}${s("hipR", "knee", "fg-limb")}${s("knee", "ankle", "fg-limb")}
      ${dot(A, B, "head", L.head, "fg-head", animate)}`;
  }
  return `<g class="fg-far">${s("neck", "elbow2", "fg-limb")}${s("elbow2", "hand2", "fg-limb")}${s("hip", "knee2", "fg-limb")}${s("knee2", "ankle2", "fg-limb")}${s("ankle2", "toe2", "fg-foot")}</g>
    ${s("hip", "knee", "fg-limb")}${s("knee", "ankle", "fg-limb")}${s("ankle", "toe", "fg-foot")}
    ${s("hip", "neck", "fg-torso")}${dot(A, B, "head", L.head, "fg-head", animate)}
    ${s("neck", "elbow", "fg-limb")}${s("elbow", "hand", "fg-limb")}`;
}

// Which pattern + equipment an exercise uses: ex.fig = "pattern" and
// ex.equipment ("barbell" | "dumbbell" | "cable" | "machine" | "body only" |
// "kettlebell"). Unknown/custom exercises get a standing figure.
// opts.pose "B" draws the end position (static); default is the start;
// "auto" picks the pattern's most recognisable frame (for thumbnails).
// opts.fit zooms the view onto the figure (for small thumbnails).
export function figureSvg(ex, { animate = false, cls = "", pose = "A", fit = false } = {}) {
  const key = (ex && ex.fig && P[ex.fig]) ? ex.fig : "stand";
  const pat = P[key];
  const view = pat.view || "side";
  const make = (p) => (view === "front" ? frontJoints(p) : sideJoints(p));
  let A = make(pat.A), B = make(pat.B);
  if (pose === "auto") pose = pat.thumb || "B";
  if (pose === "B" && !animate) A = B;
  const eq = (ex && ex.equipment) || "";
  let props = "", behind = "";
  if (pat.cableFrom || eq === "cable") {
    const from = pat.cableFrom || [92, 20];
    behind += cable(A, B, pat.hold || "hand", from, animate);
    if (view === "front") behind += cable(A, B, "hand2", [100 - from[0], from[1]], animate);
    props += follow(A, B, pat.hold || "hand", HANDLE, animate);
  } else if (eq === "barbell" && pat.hold) {
    props += follow(A, B, pat.hold, PLATE, animate);
  } else if (eq === "dumbbell" && pat.hold) {
    props += follow(A, B, pat.hold, DB, animate);
    if (view === "front") props += follow(A, B, "hand2", DB, animate);
  } else if (eq === "kettlebell" && pat.hold) {
    props += follow(A, B, pat.hold, KB, animate);
  } else if (eq === "machine" && pat.hold) {
    props += follow(A, B, pat.hold, MACHINE_PROP[key] || HANDLE, animate);
  }
  let vb = "0 0 100 100";
  if (fit) {
    // Square box around every joint the figure uses (both poses if animated).
    const pts = [A, animate ? B : A].flatMap((j) => Object.values(j));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const pad = 9, minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const size = Math.max(46, maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    vb = `${r1(cx - size / 2)} ${r1(cy - size / 2)} ${r1(size)} ${r1(size)}`;
  }
  return `<svg class="fig ${cls}" viewBox="${vb}" role="img" aria-label="${(ex && ex.name) || "Exercise"} demonstration">
    <g class="fg-env">${ENV[pat.env] || ENV.floor}</g>${behind}${bodySvg(view, A, B, animate)}${props}</svg>`;
}

export const FIGURE_PATTERNS = Object.keys(P);
