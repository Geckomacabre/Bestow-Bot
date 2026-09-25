import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { drawQuad, encode, project, renderLoop, rotX, rotY, stillOf, type Pt, type V3 } from './anim.js';
import type { Job, Out } from './effects.js';

/**
 * /media makesweet: the picture placed into small animated 3D scenes, all drawn here (no templates, no outside service):
 * billboard, flag, flag2, rubiks, book, toaster, valentine, circuitboard, fortunecookie, backtattoo, heartlocket.
 * Every scene loops seamlessly (t runs 0 → 1).
 */

export const TEMPLATES = ['billboard', 'flag', 'flag2', 'rubiks', 'book', 'toaster', 'valentine', 'circuitboard', 'fortunecookie', 'backtattoo', 'heartlocket'] as const;
export type Template = (typeof TEMPLATES)[number];

const TAU = Math.PI * 2;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 0 → 1 → 0 across [a, b] … [c, d] with a plateau in between. */
const window_ = (t: number, a: number, b: number, c: number, d: number) => (t < a || t > d ? 0 : t < b ? ease((t - a) / (b - a)) : t <= c ? 1 : ease(1 - (t - c) / (d - c)));

/** Deterministic pseudo-random numbers so scenes are identical frame to frame. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; }

function heartPath(g: SKRSContext2D, cx: number, cy: number, s: number) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.35);
  g.bezierCurveTo(cx - s * 0.05, cy + s * 0.3, cx - s * 0.5, cy + s * 0.05, cx - s * 0.5, cy - s * 0.2);
  g.bezierCurveTo(cx - s * 0.5, cy - s * 0.45, cx - s * 0.25, cy - s * 0.55, cx, cy - s * 0.32);
  g.bezierCurveTo(cx + s * 0.25, cy - s * 0.55, cx + s * 0.5, cy - s * 0.45, cx + s * 0.5, cy - s * 0.2);
  g.bezierCurveTo(cx + s * 0.5, cy + s * 0.05, cx + s * 0.05, cy + s * 0.3, cx, cy + s * 0.35);
  g.closePath();
}

/**
 * Cover-fit the picture into w×h (centre crop), returned as a decoded image for texture mapping — drawing from an Image is far
 * cheaper than drawing from a canvas, which gets snapshotted on every drawImage call. (loadImage, not `new Image()` + src: the
 * latter reports `complete` before its pixels are decoded, and draws nothing until then.)
 */
async function fitted(img: Image, w: number, h: number): Promise<Image> {
  const c = createCanvas(w, h), g = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return loadImage(c.toBuffer('image/png'));
}

// ─── Scenes ──────────────────────────────────────────────────────────────────

async function flag(img: Image) {
  const W = 480, H = 360, fw = 360, fh = Math.min(250, Math.round(fw * img.height / img.width)), x0 = 64, y0 = 44, N = 60;
  const tex = await fitted(img, 720, Math.round(720 * fh / fw));
  return renderLoop(30, W, H, (g, t) => {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(1, '#cfe8ff'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6b6f76'; g.fillRect(54, 26, 10, H); g.fillStyle = '#d4af37'; g.beginPath(); g.arc(59, 24, 9, 0, TAU); g.fill();
    for (let i = 0; i < N; i++) {
      const u = i / N, ph = u * 3 * Math.PI - t * TAU, amp = 16 * u, dy = amp * Math.sin(ph), slope = Math.cos(ph);
      const x = x0 + u * fw, sw = fw / N + 0.8;
      g.drawImage(tex, u * tex.width, 0, tex.width / N + 1, tex.height, x, y0 + dy, sw, fh + amp * 0.15 * slope);
      g.fillStyle = slope > 0 ? `rgba(255,255,255,${0.22 * slope * u})` : `rgba(0,0,0,${-0.32 * slope * u})`;
      g.fillRect(x, y0 + dy, sw, fh + amp * 0.15 * slope);
    }
  });
}

async function flag2(img: Image) {
  const W = 400, H = 400, fw = 300, fh = 210, x0 = 60, y0 = 70, C = 16, R = 12;
  const tex = await fitted(img, 600, 420);
  return renderLoop(30, W, H, (g, t) => {
    g.fillStyle = '#20242c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#9aa0a6'; g.fillRect(40, 60, 320, 10);
    const P = (u: number, v: number): Pt => [x0 + u * fw + 7 * Math.sin(TAU * (v * 1.1 - t)) * v, y0 + v * fh + 12 * Math.sin(TAU * (u * 1.4 - t)) * u];
    const shade = (u: number) => Math.cos(TAU * (u * 1.4 - t));
    for (let i = 0; i < C; i++) for (let j = 0; j < R; j++) {
      const u0 = i / C, u1 = (i + 1) / C, v0 = j / R, v1 = (j + 1) / R;
      const q: [Pt, Pt, Pt, Pt] = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
      drawQuad(g, tex, q, { src: [u0 * tex.width, v0 * tex.height, tex.width / C, tex.height / R], steps: 1 });
      const s = shade((u0 + u1) / 2) * u0;
      g.fillStyle = s > 0 ? `rgba(255,255,255,${0.2 * s})` : `rgba(0,0,0,${-0.35 * s})`;
      g.beginPath(); g.moveTo(...q[0]); g.lineTo(...q[1]); g.lineTo(...q[2]); g.lineTo(...q[3]); g.closePath(); g.fill();
    }
  });
}

async function billboard(img: Image) {
  const W = 480, H = 360, r = rng(7);
  const buildings = Array.from({ length: 14 }, (_, k) => ({ x: k * 36 - 10 + r() * 10, w: 40 + r() * 30, h: 120 + r() * 200, lights: Array.from({ length: 40 }, () => [r(), r(), r()] as const) }));
  const quad: [Pt, Pt, Pt, Pt] = [[140, 58], [400, 40], [406, 214], [146, 222]];
  const tex = await fitted(img, 520, 360);
  return renderLoop(24, W, H, (g, t, k) => {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#070b1e'); sky.addColorStop(1, '#2a1b3d'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const b of buildings) {
      g.fillStyle = '#10131c'; g.fillRect(b.x, H - b.h, b.w, b.h);
      for (const [lx, ly, on] of b.lights) if ((on + k * 0.013 * (lx > 0.5 ? 1 : -1)) % 1 > 0.45) { g.fillStyle = on > 0.8 ? '#ffd27a' : '#f5e6b0'; g.fillRect(b.x + 4 + lx * (b.w - 10), H - b.h + 6 + ly * (b.h - 14), 3, 4); }
    }
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(quad[0][0] - 10, quad[0][1] - 10); g.lineTo(quad[1][0] + 10, quad[1][1] - 10); g.lineTo(quad[2][0] + 10, quad[2][1] + 10); g.lineTo(quad[3][0] - 10, quad[3][1] + 10); g.closePath(); g.fill();
    drawQuad(g, tex, quad, { steps: 10 });
    const glow = 0.06 + 0.04 * Math.sin(t * TAU * 2);
    g.fillStyle = `rgba(255,255,255,${glow})`; g.beginPath(); g.moveTo(...quad[0]); g.lineTo(...quad[1]); g.lineTo(...quad[2]); g.lineTo(...quad[3]); g.closePath(); g.fill();
    g.fillStyle = '#2b2b2b'; g.fillRect(268, 222, 10, H - 222);
    for (let n = 0; n < 7; n++) { g.fillStyle = (n + k) % 3 === 0 ? '#ffdf6b' : '#8a7a3a'; g.beginPath(); g.arc(150 + n * 42, 232 - n * 1.3, 3, 0, TAU); g.fill(); }
  });
}

async function rubiks(img: Image) {
  const W = 400, H = 400, tex = await fitted(img, 360, 360), gap = 0.07, s = 1;
  // Each face: centre, u axis, v axis (unit cube, half-size s).
  const faces: { c: V3; u: V3; v: V3; n: V3 }[] = [
    { c: [0, 0, -s], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] }, { c: [0, 0, s], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    { c: [s, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] }, { c: [-s, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [-1, 0, 0] },
    { c: [0, -s, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] }, { c: [0, s, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  ];
  const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  return renderLoop(36, W, H, (g, t) => {
    const bg = g.createRadialGradient(200, 200, 40, 200, 200, 280); bg.addColorStop(0, '#3a3f4b'); bg.addColorStop(1, '#16181d'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const ay = t * TAU, ax = 0.55 + 0.15 * Math.sin(t * TAU);
    const tf = (p: V3) => rotX(rotY(p, ay), ax);
    const proj = (p: V3) => project(tf(p), 200, 200, 330, 4.2);
    const visible = faces.map(f => ({ f, n: tf(f.n), z: tf(f.c)[2] })).filter(x => x.n[2] < 0).sort((a, b) => b.z - a.z);
    for (const { f, n } of visible) {
      const corner = (a: number, b: number) => proj(add(add(f.c, f.u, a * s), f.v, b * s));
      g.fillStyle = '#0b0b0b'; g.beginPath(); g.moveTo(...corner(-1, -1)); g.lineTo(...corner(1, -1)); g.lineTo(...corner(1, 1)); g.lineTo(...corner(-1, 1)); g.closePath(); g.fill();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const a0 = -1 + (2 * i) / 3 + gap, a1 = -1 + (2 * (i + 1)) / 3 - gap, b0 = -1 + (2 * j) / 3 + gap, b1 = -1 + (2 * (j + 1)) / 3 - gap;
        drawQuad(g, tex, [corner(a0, b0), corner(a1, b0), corner(a1, b1), corner(a0, b1)], { src: [i * 120, j * 120, 120, 120], steps: 2 });
      }
      const light = Math.max(0, -n[2]) * 0.8 + 0.2;
      g.fillStyle = `rgba(0,0,0,${(1 - light) * 0.55})`; g.beginPath(); g.moveTo(...corner(-1, -1)); g.lineTo(...corner(1, -1)); g.lineTo(...corner(1, 1)); g.lineTo(...corner(-1, 1)); g.closePath(); g.fill();
    }
  });
}

async function book(img: Image) {
  const W = 480, H = 360, spine = 240, pw = 190, top = 60, bottom = 300, tex = await fitted(img, 380, 480);
  return renderLoop(40, W, H, (g, t) => {
    g.fillStyle = '#5b3a21'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(spine - pw - 6, top + 8, pw * 2 + 12, bottom - top);
    g.fillStyle = '#f4efe3'; g.fillRect(spine - pw, top, pw, bottom - top); g.fillRect(spine, top, pw, bottom - top);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(spine - 8, top, 16, bottom - top);
    drawQuad(g, tex, [[spine + 12, top + 14], [spine + pw - 12, top + 14], [spine + pw - 12, bottom - 14], [spine + 12, bottom - 14]], { steps: 1 });
    // The page turns over the picture and back, revealing it again.
    const th = Math.PI * window_(t, 0.15, 0.5, 0.55, 0.9);
    const tipX = spine + pw * Math.cos(th), lift = pw * Math.sin(th) * 0.12;
    const q: [Pt, Pt, Pt, Pt] = [[spine, top], [tipX, top - lift], [tipX, bottom + lift], [spine, bottom]];
    if (th > 0.01) { // once fully over (th = π) the page lies on the left, back side up
      const front = th < Math.PI / 2;
      if (front) drawQuad(g, tex, q, { steps: 4 });
      g.fillStyle = front ? `rgba(0,0,0,${0.3 * Math.sin(th)})` : '#e8e2d4';
      g.beginPath(); g.moveTo(...q[0]); g.lineTo(...q[1]); g.lineTo(...q[2]); g.lineTo(...q[3]); g.closePath(); g.fill();
    }
  });
}

async function toaster(img: Image) {
  const W = 400, H = 400, tex = await fitted(img, 150, 150), slotY = 232;
  return renderLoop(36, W, H, (g, t) => {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#fbe9d7'); bg.addColorStop(1, '#e7c9a9'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c9a27c'; g.fillRect(0, 330, W, 70);
    const rise = window_(t, 0.2, 0.33, 0.75, 0.9), bounce = t > 0.33 && t < 0.45 ? Math.sin((t - 0.33) / 0.12 * Math.PI) * 10 : 0;
    const toastTop = slotY - 10 - rise * 150 - bounce;
    g.save(); g.beginPath(); g.rect(0, 0, W, slotY); g.clip();
    g.fillStyle = '#c98b4a'; g.beginPath(); g.roundRect(123, toastTop, 154, 170, 22); g.fill();
    g.drawImage(tex, 130, toastTop + 8, 140, 140);
    g.restore();
    const body = g.createLinearGradient(80, 0, 320, 0); body.addColorStop(0, '#9aa3ad'); body.addColorStop(0.35, '#f1f4f7'); body.addColorStop(0.6, '#c3cad2'); body.addColorStop(1, '#7c858f');
    g.fillStyle = body; g.beginPath(); g.roundRect(80, slotY - 12, 240, 110, 30); g.fill();
    g.fillStyle = '#2d2d2d'; g.beginPath(); g.roundRect(118, slotY - 8, 164, 12, 6); g.fill();
    g.fillStyle = '#444'; g.fillRect(312, 262 + (1 - rise) * 20, 26, 10);
    g.fillStyle = '#e04b4b'; g.beginPath(); g.arc(200, 300, 7, 0, TAU); g.fill();
  });
}

async function valentine(img: Image) {
  const W = 400, H = 400, tex = await fitted(img, 240, 240), r = rng(3);
  const hearts = Array.from({ length: 14 }, () => ({ x: r() * W, y: r() * H, s: 12 + r() * 18, p: r() }));
  return renderLoop(36, W, H, (g, t) => {
    g.fillStyle = '#ffd6e2'; g.fillRect(0, 0, W, H);
    for (const h of hearts) { g.fillStyle = 'rgba(232,67,114,0.35)'; heartPath(g, h.x + 8 * Math.sin(TAU * (t + h.p)), ((h.y - t * 60) % H + H) % H, h.s); g.fill(); }
    g.fillStyle = '#fff'; g.fillRect(76, 76, 248, 248); g.drawImage(tex, 80, 80);
    const open = window_(t, 0.1, 0.35, 0.7, 0.92), a = open * 1.35;
    for (const side of [-1, 1] as const) {
      const hinge = side < 0 ? 76 : 324, w = 124 * Math.cos(a);
      if (w < 1) continue;
      const x = side < 0 ? hinge : hinge - w;
      g.fillStyle = '#d7263d'; g.fillRect(x, 76, w, 248);
      g.fillStyle = `rgba(0,0,0,${0.25 * Math.sin(a)})`; g.fillRect(x, 76, w, 248);
      g.save(); g.translate(hinge + (side < 0 ? w : -w) / 2, 200); g.scale(Math.cos(a), 1); g.fillStyle = '#fff'; heartPath(g, 0, 0, 70); g.fill(); g.restore();
    }
  });
}

async function circuitboard(img: Image) {
  const W = 480, H = 360, r = rng(11), tex = await fitted(img, 170, 170);
  const traces = Array.from({ length: 34 }, () => {
    const horiz = r() > 0.5, fixed = horiz ? 20 + r() * (H - 40) : 20 + r() * (W - 40);
    const a = r() * (horiz ? W : H), len = 60 + r() * 180;
    return { horiz, fixed, a, b: a + len, speed: 0.5 + r(), off: r() };
  });
  return renderLoop(30, W, H, (g, t) => {
    g.fillStyle = '#0f5132'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1f7a4c'; g.lineWidth = 3;
    for (const tr of traces) {
      g.beginPath(); if (tr.horiz) { g.moveTo(tr.a, tr.fixed); g.lineTo(tr.b, tr.fixed); } else { g.moveTo(tr.fixed, tr.a); g.lineTo(tr.fixed, tr.b); } g.stroke();
      g.fillStyle = '#c9a54a'; for (const e of [tr.a, tr.b]) { g.beginPath(); tr.horiz ? g.arc(e, tr.fixed, 4, 0, TAU) : g.arc(tr.fixed, e, 4, 0, TAU); g.fill(); }
      const pos = tr.a + (((t * tr.speed + tr.off) % 1) * (tr.b - tr.a));
      g.fillStyle = 'rgba(160,255,200,0.9)'; g.beginPath(); tr.horiz ? g.arc(pos, tr.fixed, 3, 0, TAU) : g.arc(tr.fixed, pos, 3, 0, TAU); g.fill();
    }
    g.fillStyle = '#c9a54a';
    for (let k = 0; k < 10; k++) { const o = 150 + k * 18; g.fillRect(o, 76, 6, 14); g.fillRect(o, 270, 6, 14); g.fillRect(146, o - 60, 14, 6); g.fillRect(320, o - 60, 14, 6); }
    g.fillStyle = '#111'; g.fillRect(150, 86, 180, 188);
    g.drawImage(tex, 155, 95);
    g.fillStyle = `rgba(120,255,180,${0.08 + 0.06 * Math.sin(t * TAU)})`; g.fillRect(150, 86, 180, 188);
  });
}

async function fortunecookie(img: Image) {
  const W = 400, H = 400, tex = await fitted(img, 200, 120);
  const half = (g: SKRSContext2D, cx: number, cy: number, dir: -1 | 1, tilt: number) => {
    g.save(); g.translate(cx, cy); g.rotate(tilt * dir); g.scale(dir, 1);
    const grad = g.createLinearGradient(-90, -60, 20, 60); grad.addColorStop(0, '#f2c46d'); grad.addColorStop(1, '#b8772d');
    g.fillStyle = grad; g.beginPath(); g.moveTo(0, -55); g.bezierCurveTo(-120, -70, -130, 50, -20, 60); g.bezierCurveTo(-60, 20, -50, -30, 0, -20); g.closePath(); g.fill();
    g.restore();
  };
  return renderLoop(36, W, H, (g, t) => {
    g.fillStyle = '#7a1f1f'; g.fillRect(0, 0, W, H); g.fillStyle = '#5e1414'; g.beginPath(); g.ellipse(200, 250, 170, 60, 0, 0, TAU); g.fill();
    const apart = window_(t, 0.2, 0.4, 0.8, 0.95), shake = t < 0.2 ? Math.sin(t * 90) * 3 : 0;
    const slip = window_(t, 0.35, 0.55, 0.8, 0.95);
    if (slip > 0) {
      const w = 60 + slip * 180, h = 30 + slip * 110, y = 200 - slip * 70;
      g.fillStyle = '#fdfbf5'; g.fillRect(200 - w / 2, y - h / 2, w, h);
      g.drawImage(tex, 200 - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12);
    }
    half(g, 200 - apart * 70 + shake, 215, -1, apart * 0.35);
    half(g, 200 + apart * 70 + shake, 215, 1, apart * 0.35);
  });
}

/**
 * The picture as tattoo ink: mostly desaturated with a bit more contrast. Baked into the texture once — canvas `filter` doesn't
 * survive the clipped triangle draws drawQuad makes.
 */
async function inked(img: Image, size: number): Promise<Image> {
  const c = createCanvas(size, size), g = c.getContext('2d');
  g.drawImage(await fitted(img, size, size), 0, 0);
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let k = 0; k < d.length; k += 4) {
    const lum = d[k]! * 0.3 + d[k + 1]! * 0.59 + d[k + 2]! * 0.11;
    for (let ch = 0; ch < 3; ch++) d[k + ch] = ((d[k + ch]! * 0.4 + lum * 0.6) - 128) * 1.2 + 128;
  }
  g.putImageData(id, 0, 0);
  return loadImage(c.toBuffer('image/png'));
}

async function backtattoo(img: Image) {
  const W = 360, H = 440, tex = await inked(img, 180);
  // The tattoo is drawn flat on its own layer, then multiplied onto the skin in one go: multiplying each subdivision
  // triangle directly would darken the hairline overlaps between them into a visible grid.
  const layer = createCanvas(W, H), lg = layer.getContext('2d');
  return renderLoop(30, W, H, (g, t) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, W, H);
    const skin = g.createRadialGradient(180, 180, 40, 180, 240, 260); skin.addColorStop(0, '#e8b894'); skin.addColorStop(1, '#a8714f');
    g.fillStyle = skin; g.beginPath(); g.moveTo(40, 80); g.bezierCurveTo(90, 40, 270, 40, 320, 80); g.bezierCurveTo(350, 200, 300, 380, 290, H); g.lineTo(70, H); g.bezierCurveTo(60, 380, 10, 200, 40, 80); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(90,50,30,0.35)'; g.lineWidth = 6; g.beginPath(); g.moveTo(180, 70); g.bezierCurveTo(176, 200, 184, 300, 180, H); g.stroke();
    for (const x of [110, 250]) { g.fillStyle = 'rgba(90,50,30,0.12)'; g.beginPath(); g.ellipse(x, 170, 55, 80, 0, 0, TAU); g.fill(); }
    // Breathing: the back swells a little and the shoulders rise and fall.
    const breathe = 1 + 0.035 * Math.sin(t * TAU), cx = 180, cy = 190 - 4 * Math.sin(t * TAU), s = 85 * breathe;
    lg.clearRect(0, 0, W, H);
    drawQuad(lg, tex, [[cx - s, cy - s * 0.95], [cx + s, cy - s * 0.95], [cx + s * 0.92, cy + s], [cx - s * 0.92, cy + s]], { steps: 6 });
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.9;
    g.drawImage(layer, 0, 0);
    g.restore();
  });
}

async function heartlocket(img: Image, img2: Image | null, text: string | null) {
  const W = 400, H = 400, front = await fitted(img, 220, 220), back = img2 ? await fitted(img2, 220, 220) : null;
  return renderLoop(36, W, H, (g, t) => {
    const bg = g.createRadialGradient(200, 200, 30, 200, 200, 280); bg.addColorStop(0, '#4a2c3a'); bg.addColorStop(1, '#140a10'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d4af37'; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(200, 0); g.lineTo(200, 88); g.stroke(); g.setLineDash([]);
    const a = t * TAU, cs = Math.cos(a), sx = Math.max(0.02, Math.abs(cs));
    g.save(); g.translate(200, 215); g.scale(sx, 1);
    const gold = g.createLinearGradient(-110, 0, 110, 0); gold.addColorStop(0, '#8a6d1f'); gold.addColorStop(0.5, '#f7e08a'); gold.addColorStop(1, '#8a6d1f');
    g.fillStyle = gold; heartPath(g, 0, 0, 250); g.fill();
    g.save(); heartPath(g, 0, 0, 215); g.clip();
    if (cs > 0) g.drawImage(front, -110, -115);
    else if (back) g.drawImage(back, -110, -115);
    else {
      g.fillStyle = '#e6c867'; g.fillRect(-120, -120, 240, 240);
      if (text) { g.fillStyle = '#8a6d1f'; g.font = 'bold 26px "BestowCaption", serif'; g.textAlign = 'center'; g.fillText(text.slice(0, 30), 0, 0, 170); }
    }
    g.restore();
    g.fillStyle = `rgba(0,0,0,${0.35 * (1 - sx)})`; heartPath(g, 0, 0, 250); g.fill();
    g.restore();
    g.fillStyle = '#d4af37'; g.beginPath(); g.arc(200, 92, 9, 0, TAU); g.lineWidth = 4; g.strokeStyle = '#d4af37'; g.stroke();
  });
}

/** Each scene renders its loop of PNG frames from the picture (and, for the locket, the optional back image/text). */
export const SCENES: Record<Template, (img: Image, img2: Image | null, text: string | null) => Promise<Buffer[]>> = {
  billboard, flag, flag2, rubiks, book, toaster, valentine, circuitboard, fortunecookie, backtattoo, heartlocket,
};

export async function makesweet(job: Job, template: Template, o: { output?: 'gif' | 'mp4'; image2?: Image | null; text?: string | null } = {}): Promise<Out> {
  const frames = await SCENES[template](await stillOf(job, 900), o.image2 ?? null, o.text ?? null);
  return encode(job.dir, frames, 20, o.output === 'mp4' ? 'mp4' : 'gif', template);
}
