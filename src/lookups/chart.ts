import { createCanvas } from '@napi-rs/canvas';

/** A small, readable line chart (PNG) for price/value history: dark card, gridlines, axis labels, one line per series. */

export interface Series { label: string; color: string; points: { x: number; y: number }[] }

export function niceStep(range: number, ticks = 5): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const raw = range / ticks, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
}

export const shortNum = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${+n.toFixed(2)}`;
  return n.toPrecision(3);
};

export function lineChart(series: Series[], o: { title?: string; width?: number; height?: number; xLabel?: (x: number) => string; yLabel?: (y: number) => string } = {}): Buffer {
  const W = o.width ?? 900, H = o.height ?? 420;
  const pad = { l: 70, r: 24, t: o.title ? 48 : 20, b: 40 };
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#1e1f22'; g.fillRect(0, 0, W, H);
  const all = series.flatMap(s => s.points);
  if (all.length < 2) {
    g.fillStyle = '#b5bac1'; g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText('Not enough data to chart', W / 2, H / 2);
    return c.toBuffer('image/png');
  }
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= Math.abs(y0) * 0.05 || 1; y1 += Math.abs(y1) * 0.05 || 1; }
  const step = niceStep(y1 - y0);
  y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  const px = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const py = (y: number) => H - pad.b - ((y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  if (o.title) { g.fillStyle = '#f2f3f5'; g.font = 'bold 20px sans-serif'; g.textAlign = 'left'; g.fillText(o.title, pad.l, 30); }
  g.font = '13px sans-serif'; g.fillStyle = '#949ba4'; g.strokeStyle = '#2e3035'; g.lineWidth = 1;
  g.textAlign = 'right';
  for (let y = y0; y <= y1 + step / 2; y += step) {
    g.beginPath(); g.moveTo(pad.l, py(y)); g.lineTo(W - pad.r, py(y)); g.stroke();
    g.fillText((o.yLabel ?? shortNum)(y), pad.l - 8, py(y) + 4);
  }
  g.textAlign = 'center';
  for (let n = 0; n <= 4; n++) { const x = x0 + ((x1 - x0) * n) / 4; g.fillText((o.xLabel ?? (v => new Date(v).toISOString().slice(0, 10)))(x), px(x), H - 14); }

  for (const s of series) {
    if (s.points.length < 2) continue;
    g.strokeStyle = s.color; g.lineWidth = 2.5; g.beginPath();
    s.points.forEach((p, n) => (n ? g.lineTo(px(p.x), py(p.y)) : g.moveTo(px(p.x), py(p.y))));
    g.stroke();
  }
  // Legend
  let lx = W - pad.r;
  g.font = '14px sans-serif'; g.textAlign = 'right';
  for (const s of [...series].reverse()) {
    g.fillStyle = '#dbdee1'; g.fillText(s.label, lx, 30); lx -= g.measureText(s.label).width + 8;
    g.fillStyle = s.color; g.fillRect(lx - 12, 20, 12, 12); lx -= 28;
  }
  return c.toBuffer('image/png');
}
