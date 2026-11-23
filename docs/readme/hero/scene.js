// Hero scene of the README: the idea of RequestFlow in eight seconds, drawn with three.js and timed by
// one GSAP timeline. A request mail arrives, four values leave their source line and stay linked to it,
// one is marked "unsicher", a person approves, and one export reaches the ERP – a repeated delivery
// gets the same reference back. Colours, type and radii are the app's own tokens (src/app/globals.css);
// the dark variant is derived from them for the README only (the app has no dark mode).
// The texts are those of the prepared sample "Werk Ost" (src/features/samples) – synthetic data.
// The timeline is paused; docs/readme/hero.mjs seeks it frame by frame (window.__seek), so no real time
// is involved in what is recorded.
import * as THREE from "three";
import { gsap } from "gsap";

const W = 1600;
const H = 600;
const dark = new URLSearchParams(location.search).get("theme") === "dark";

const light = {
  bg: "#f6f5f1", surface: "#fffefb", header: "#efede7", border: "#dcd9d1", rule: "#ebe8e1",
  text: "#1d1c1a", text2: "#3d3b37", muted: "#6b6860", brand: "#1f4fa3", onBrand: "#ffffff",
  okBg: "#e3f0e4", okText: "#1f4a24", warnBg: "#fdf0cc", warnText: "#5c3c00", warnLine: "#b58100",
  blueBg: "#e6ebf7", blueText: "#1a2f66", cited: "#fff8c5", mark: "#ffd33d", markText: "#1d1c1a", line: "#c9c5bb",
};
const night = {
  bg: "#181715", surface: "#211f1c", header: "#2a2824", border: "#3b3934", rule: "#2f2d29",
  text: "#eeebe4", text2: "#d3cfc6", muted: "#a9a499", brand: "#7ea2e8", onBrand: "#0f1a33",
  okBg: "#1d3322", okText: "#a6d8ab", warnBg: "#3a2f12", warnText: "#f3cc72", warnLine: "#d8a52a",
  blueBg: "#1c2740", blueText: "#bccdf2", cited: "#3a3418", mark: "#ffd33d", markText: "#1d1c1a", line: "#4a4740",
};
const C = dark ? night : light;
const SANS = '"IBM Plex Sans"';
const MONO = '"IBM Plex Mono"';
const S = 2; // texture supersampling

// --- fonts (self-hosted IBM Plex, as in the app) ------------------------------------------------------
const faces = [
  [SANS, 400, "/fonts/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2"],
  [SANS, 500, "/fonts/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2"],
  [SANS, 600, "/fonts/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2"],
  [MONO, 400, "/fonts/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"],
];
await Promise.all(
  faces.map(async ([family, weight, url]) => {
    const face = new FontFace(family.replaceAll('"', ""), `url(${url})`, { weight: String(weight) });
    document.fonts.add(await face.load());
  }),
);

// --- renderer, camera --------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setClearColor(C.bg);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOV = 28;
const DIST = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const camera = new THREE.PerspectiveCamera(FOV, W / H, 10, 6000);
const cam = { x: 0, y: 0, tilt: 0 };

// World units are pixels of the 1600 × 600 frame; (0, 0) is the top-left corner, y grows downwards.
const px = (x) => x - W / 2;
const py = (y) => H / 2 - y;

// --- 2D drawing helpers for card textures -------------------------------------------------------------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function box(g, x, y, w, h, fill, stroke) {
  roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 3);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }
}
function text(g, value, x, y, { size = 14, weight = 400, color = C.text, font = SANS, align = "left" } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(value, x, y);
}
function badge(g, label, x, y, kind) {
  const [bg, fg, border] = { ok: [C.okBg, C.okText, null], warn: [C.warnBg, C.warnText, C.warnLine], blue: [C.blueBg, C.blueText, null] }[kind];
  g.font = `600 13px ${SANS}`;
  const w = g.measureText(label).width + 14;
  box(g, x, y, w, 22, bg, border);
  text(g, label, x + 7, y + 16, { size: 13, weight: 600, color: fg });
  return w;
}

/** A flat card: a plane with a canvas texture, positioned by its top-left corner in frame pixels. */
function card(w, h, draw, { x = 0, y = 0, z = 0 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w * S;
  canvas.height = h * S;
  const g = canvas.getContext("2d");
  g.scale(S, S);
  draw(g, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  // Draw order follows the layer (z), not the distance to the camera: every card is transparent.
  mesh.renderOrder = Math.round(z * 10);
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(px(x + w / 2), py(y + h / 2), z);
  group.userData = { w, h, material };
  scene.add(group);
  return group;
}
const at = (group, x, y, z = 0) => ({ x: px(x + group.userData.w / 2), y: py(y + group.userData.h / 2), z });

// --- content: the prepared sample "Werk Ost" (synthetic) --------------------------------------------
const MAIL = { x: 60, y: 70, w: 580, h: 460 };
const mailLines = [
  ["Kopf", "From: Einkauf <einkauf@beispiel-anlagenbau.example.com>"],
  ["Kopf", "Subject: Anfrage Rohrbogen und Flansche fuer Werk Ost"],
  ["1", "Guten Tag,"],
  ["3", "wir bitten um ein Angebot fuer folgende Positionen:"],
  ["5", "1) 8 Stk. Rohrbogen 90 Grad DN 80, Werkstoff P235GH"],
  ["6", "2) 16 Stk. Vorschweissflansch DN 80 PN 40"],
  ["9", "Gewuenschter Liefertermin: KW 48"],
  ["11", "Mit freundlichen Gruessen"],
  ["12", "Jana Beispiel"],
  ["13", "Beispiel Anlagenbau GmbH"],
  ["14", "Tel. +49 40 5550123"],
];
const LINE_TOP = MAIL.y + 90;
const LINE_H = 30;
const lineY = (i) => LINE_TOP + i * LINE_H;

const mail = card(MAIL.w, MAIL.h, (g, w, h) => {
  box(g, 0, 0, w, h, C.surface, C.border);
  text(g, "Eingang", 20, 30, { size: 13, weight: 600, color: C.muted });
  text(g, "werk-ost.eml – E-Mail", 20, 56, { size: 19, weight: 600 });
  let cx = w - 20;
  for (const type of ["DOCX", "XLSX", "PDF"]) {
    g.font = `400 12px ${MONO}`;
    const cw = g.measureText(type).width + 16;
    cx -= cw;
    box(g, cx, 38, cw, 22, C.header, C.border);
    text(g, type, cx + 8, 54, { size: 12, weight: 400, font: MONO, color: C.text2 });
    cx -= 6;
  }
  g.fillStyle = C.rule;
  g.fillRect(20, 74, w - 40, 1);
}, { x: MAIL.x, y: MAIL.y });
mail.position.x -= 60;

// One row per source line, so a cited line can light up on its own.
const rows = mailLines.map(([label, value], i) =>
  card(MAIL.w - 40, LINE_H - 2, (g) => {
    text(g, label === "Kopf" ? "Kopf" : `Zeile ${label}`, 10, 19, { size: 12, font: MONO, color: C.muted });
    text(g, value, 80, 20, { size: 15, color: C.text });
  }, { x: MAIL.x + 20, y: lineY(i), z: 1 }),
);
const cites = mailLines.map((_, i) =>
  card(MAIL.w - 40, LINE_H - 2, (g, w, h) => {
    box(g, 0, 0, w, h, C.cited, null);
    g.fillStyle = C.mark;
    g.fillRect(0, 0, 3, h);
  }, { x: MAIL.x + 20, y: lineY(i), z: 0.5 }),
);

// Four extracted values; each keeps a link to the line it was quoted from.
const FIELD = { x: 770, w: 390, h: 72, gap: 12, top: 84 };
const fields = [
  { label: "Firma", value: "Beispiel Anlagenbau GmbH", line: 9, status: "ok" },
  { label: "Ansprechpartner:in", value: "Jana Beispiel", line: 8, status: "ok" },
  { label: "Telefon", value: "+49 40 5550123", line: 10, status: "ok" },
  { label: "Gewünschter Liefertermin", value: "KW 48", line: 6, status: "warn" },
].map((f, i) => {
  const y = FIELD.top + i * (FIELD.h + FIELD.gap);
  const group = card(FIELD.w, FIELD.h, (g, w, h) => {
    box(g, 0, 0, w, h, f.status === "warn" ? C.blueBg : C.surface, C.border);
    text(g, f.label, 16, 27, { size: 14, weight: 600, color: C.muted });
    text(g, f.value, 16, 56, { size: 19, weight: 500 });
    const label = f.status === "warn" ? "▲ unsicher" : "belegt";
    g.font = `600 13px ${SANS}`;
    badge(g, label, w - 16 - (g.measureText(label).width + 14), 14, f.status);
    text(g, "Quelle anzeigen", w - 16, 57, { size: 13, color: C.brand, align: "right" });
  }, { x: FIELD.x, y, z: 2 });
  return { ...f, group, y, home: at(group, FIELD.x, y, 2) };
});

// Links: a tube from the field back to its source line, drawn progressively.
function link(field) {
  const from = new THREE.Vector3(px(MAIL.x + MAIL.w - 60 - 26), py(lineY(field.line) + LINE_H / 2 - 1), 1.5);
  const to = new THREE.Vector3(px(FIELD.x), py(field.y + FIELD.h / 2), 1.5);
  const mid = new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2, 60);
  const curve = new THREE.CatmullRomCurve3([from, new THREE.Vector3(from.x + 40, from.y, 20), mid, new THREE.Vector3(to.x - 40, to.y, 20), to]);
  const tubular = 120;
  const radial = 6;
  const geometry = new THREE.TubeGeometry(curve, tubular, 1.3, radial, false);
  const material = new THREE.MeshBasicMaterial({ color: field.status === "warn" ? C.warnLine : C.brand, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 15;
  geometry.setDrawRange(0, 0);
  scene.add(mesh);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(4, 24), material);
  dot.position.copy(from);
  dot.renderOrder = 15;
  dot.scale.setScalar(0.001);
  scene.add(dot);
  const state = { p: 0 };
  return { mesh, dot, material, state, total: tubular * radial * 6, apply: () => geometry.setDrawRange(0, Math.round(state.p * tubular) * radial * 6) };
}
const links = fields.map(link);

// Decision: a person approves.
const DECIDE = { x: FIELD.x, y: FIELD.top + 4 * (FIELD.h + FIELD.gap) + 8, w: FIELD.w, h: 64 };
const decide = card(DECIDE.w, DECIDE.h, (g, w, h) => {
  box(g, 0, 0, w, h, C.surface, C.border);
  box(g, 14, 12, w - 28, 40, C.surface, C.border);
  text(g, "Freigeben", w / 2, 38, { size: 17, weight: 600, color: C.brand, align: "center" });
}, { x: DECIDE.x, y: DECIDE.y, z: 2 });
const approved = card(DECIDE.w, DECIDE.h, (g, w, h) => {
  box(g, 0, 0, w, h, C.surface, C.border);
  box(g, 14, 12, w - 28, 40, C.brand, null);
  text(g, "✓ Freigegeben", w / 2, 38, { size: 17, weight: 600, color: C.onBrand, align: "center" });
}, { x: DECIDE.x, y: DECIDE.y, z: 2.2 });

// ERP and the export.
const ERP = { x: 1250, y: 130, w: 300, h: 300 };
const erp = card(ERP.w, ERP.h, (g, w, h) => {
  box(g, 0, 0, w, h, C.header, C.border);
  text(g, "ERP", 20, 36, { size: 21, weight: 600 });
  text(g, "Angebotsanfragen", 20, 58, { size: 14, color: C.muted });
  g.fillStyle = C.rule;
  g.fillRect(20, 72, w - 40, 1);
}, { x: ERP.x, y: ERP.y });
const received = card(ERP.w - 40, 100, (g, w, h) => {
  box(g, 0, 0, w, h, C.surface, C.border);
  text(g, "Werk Ost", 14, 28, { size: 17, weight: 600 });
  badge(g, "exportiert · 1×", 14, 40, "ok");
  text(g, "Referenz QR-7F3A0C92D1", 14, 86, { size: 13, font: MONO, color: C.text2 });
}, { x: ERP.x + 20, y: ERP.y + 90, z: 1 });
const replayNote = card(ERP.w - 40, 70, (g) => {
  text(g, "Wiederholung mit gleichem", 0, 18, { size: 14, color: C.muted });
  text(g, "Idempotency-Key:", 0, 40, { size: 14, color: C.muted });
  text(g, "dieselbe Referenz", 0, 62, { size: 14, weight: 600, color: C.text2 });
}, { x: ERP.x + 20, y: ERP.y + 208, z: 1 });

function packet(label, ghost) {
  return card(196, 36, (g, w, h) => {
    if (ghost) {
      g.setLineDash([4, 3]);
      box(g, 0, 0, w, h, C.surface, C.muted);
      g.setLineDash([]);
    } else {
      box(g, 0, 0, w, h, C.brand, null);
    }
    text(g, label, w / 2, 23, { size: 13, weight: 400, font: MONO, color: ghost ? C.muted : C.onBrand, align: "center" });
  }, { x: DECIDE.x + DECIDE.w / 2 - 98, y: DECIDE.y + 14, z: 4 });
}
const exportPacket = packet("Export · Key a91c…", false);
const ghostPacket = packet("Export · Key a91c…", true);

// Captions along the bottom: the four steps.
const steps = ["Eingang", "Erkennen mit Quelle", "Prüfen und freigeben", "Genau einmal exportiert"].map((label, i) =>
  card(300, 28, (g) => {
    text(g, `${i + 1}`, 0, 20, { size: 15, weight: 600, font: MONO, color: C.brand });
    text(g, label, 24, 20, { size: 17, weight: 500, color: C.text2 });
  }, { x: [60, 470, 770, 1250][i], y: 552 }),
);

// --- timeline -----------------------------------------------------------------------------------------
const tl = gsap.timeline({ paused: true });
const fade = (group, opacity, d, t) => tl.to(group.userData.material, { opacity, duration: d, ease: "power1.out" }, t);
const move = (group, to, d, t, ease = "power3.out") => tl.to(group.position, { ...to, duration: d, ease }, t);

// 1 – the mail arrives, its lines appear.
fade(mail, 1, 0.5, 0);
move(mail, { x: px(MAIL.x + MAIL.w / 2) }, 0.8, 0);
fade(steps[0], 1, 0.4, 0.2);
rows.forEach((row, i) => {
  row.position.x -= 30;
  fade(row, 1, 0.35, 0.45 + i * 0.07);
  move(row, { x: at(row, MAIL.x + 20, lineY(i), 1).x }, 0.5, 0.45 + i * 0.07);
});

// 2 – four values leave their source line; the link stays.
fade(steps[1], 1, 0.4, 1.6);
fields.forEach((f, i) => {
  const t = 1.7 + i * 0.55;
  const src = at(f.group, MAIL.x + MAIL.w - 40 - FIELD.w, lineY(f.line) - (FIELD.h - LINE_H) / 2, 40);
  f.group.position.set(src.x, src.y, src.z);
  f.group.scale.setScalar(0.6);
  fade(cites[f.line], 1, 0.25, t);
  fade(f.group, 1, 0.3, t + 0.1);
  move(f.group, f.home, 0.75, t + 0.1);
  tl.to(f.group.scale, { x: 1, y: 1, z: 1, duration: 0.75, ease: "power3.out" }, t + 0.1);
  const l = links[i];
  tl.to(l.state, { p: 1, duration: 0.75, ease: "power2.inOut", onUpdate: l.apply }, t + 0.15);
  tl.to(l.dot.scale, { x: 1, y: 1, z: 1, duration: 0.2 }, t + 0.1);
});

// 3 – a person approves.
fade(steps[2], 1, 0.4, 3.9);
fade(decide, 1, 0.35, 3.95);
tl.to(decide.scale, { x: 0.97, y: 0.97, duration: 0.12, yoyo: true, repeat: 1 }, 4.45);
fade(approved, 1, 0.2, 4.55);

// 4 – one export reaches the ERP; a repeated delivery changes nothing.
fade(erp, 1, 0.4, 4.6);
fade(steps[3], 1, 0.4, 4.9);
const erpIn = at(exportPacket, ERP.x + 57, ERP.y + 120, 4);
fade(exportPacket, 1, 0.2, 4.8);
tl.to(exportPacket.position, { keyframes: [{ x: px(1150), y: py(DECIDE.y + 32), z: 60, duration: 0.45, ease: "power1.out" }, { ...erpIn, duration: 0.45, ease: "power2.in" }] }, 4.85);
fade(exportPacket, 0, 0.15, 5.7);
fade(received, 1, 0.3, 5.7);
tl.from(received.scale, { x: 0.92, y: 0.92, duration: 0.4, ease: "back.out(2)" }, 5.7);
fade(ghostPacket, 1, 0.2, 6.0);
tl.to(ghostPacket.position, { keyframes: [{ x: px(1150), y: py(DECIDE.y + 32), z: 60, duration: 0.4, ease: "power1.out" }, { ...erpIn, duration: 0.4, ease: "power2.in" }] }, 6.05);
fade(ghostPacket, 0, 0.2, 6.8);
fade(replayNote, 1, 0.35, 6.8);
tl.to(received.position, { x: "+=4", duration: 0.06, yoyo: true, repeat: 3 }, 6.82);

// Hold, then everything fades back to the empty frame, so the loop is seamless.
const END = 9.6;
const all = [mail, ...rows, ...cites, ...fields.map((f) => f.group), decide, approved, erp, received, replayNote, ...steps];
all.forEach((group) => fade(group, 0, 0.45, END - 0.55));
links.forEach((l) => {
  tl.to(l.material, { opacity: 0, duration: 0.45 }, END - 0.55);
});
tl.set({}, {}, END);

// A slow camera drift, so the flat cards read as a scene.
tl.fromTo(cam, { x: -70, y: 18, tilt: 0.05 }, { x: 70, y: -18, tilt: -0.05, duration: END, ease: "sine.inOut" }, 0);

function render() {
  camera.position.set(cam.x, cam.y, DIST);
  camera.lookAt(cam.x * 0.25, cam.y * 0.25, 0);
  camera.rotation.z += cam.tilt * 0.05;
  renderer.render(scene, camera);
}

window.__duration = END;
window.__seek = (t) => {
  tl.seek(t, false);
  links.forEach((l) => l.apply());
  render();
};
window.__seek(0);
window.__ready = true;
