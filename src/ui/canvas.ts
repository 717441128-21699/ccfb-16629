import type { BottleAnalysis, Raster } from '../core/types';
import type { LehrStat, MoldStat } from '../core/types';

export function rasterToImageData(raster: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
}

export function paintRaster(canvas: HTMLCanvasElement, raster: Raster): void {
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(rasterToImageData(raster), 0, 0);
}

export function paintAnalysisHeatmap(canvas: HTMLCanvasElement, analysis: BottleAnalysis): void {
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !analysis.stressHeatmap) return;
  ctx.putImageData(rasterToImageData(analysis.stressHeatmap), 0, 0);
}

const REGION_COLORS: Record<number, [number, number, number]> = {
  1: [56, 189, 248],
  2: [251, 191, 36],
  3: [244, 114, 182]
};

export function paintRegionMap(canvas: HTMLCanvasElement, analysis: BottleAnalysis): void {
  const { width: w, height: h, regions, mask } = analysis;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i += 1) {
    const p = i * 4;
    if (!mask[i]) {
      img.data[p + 3] = 0;
      continue;
    }
    const c = REGION_COLORS[regions[i]] ?? [148, 163, 184];
    img.data[p] = c[0];
    img.data[p + 1] = c[1];
    img.data[p + 2] = c[2];
    img.data[p + 3] = 115;
  }
  ctx.putImageData(img, 0, 0);
}

export function paintMarks(canvas: HTMLCanvasElement, analysis: BottleAnalysis): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = '600 13px system-ui, sans-serif';
  for (const mark of analysis.marks) {
    const color = mark.severity === 'reject' ? '#ef4444' : '#f59e0b';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mark.x - mark.radius - 6, mark.y);
    ctx.lineTo(mark.x - mark.radius + 2, mark.y - 7);
    ctx.lineTo(mark.x - mark.radius + 2, mark.y + 7);
    ctx.closePath();
    ctx.fill();
    const label = `${mark.grade}级 ${mark.retardationNm.toFixed(0)}nm`;
    const tx = Math.min(analysis.width - 118, mark.x + mark.radius + 6);
    const ty = Math.max(18, mark.y - 8);
    const metrics = ctx.measureText(label);
    ctx.fillStyle = 'rgba(15,23,42,.82)';
    ctx.fillRect(tx - 5, ty - 14, metrics.width + 10, 20);
    ctx.fillStyle = color;
    ctx.fillText(label, tx, ty + 1);
  }
  ctx.restore();
}

export function paintContour(canvas: HTMLCanvasElement, analysis: BottleAnalysis): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h, mask } = analysis;
  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,.9)';
  ctx.lineWidth = 1.2;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.restore();
}

export function drawMoldBarChart(canvas: HTMLCanvasElement, molds: MoldStat[]): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 280;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = { l: 42, r: 16, t: 18, b: 54 };
  const chartW = cssW - pad.l - pad.r;
  const chartH = cssH - pad.t - pad.b;
  ctx.strokeStyle = 'rgba(148,163,184,.28)';
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + chartH);
  ctx.lineTo(pad.l + chartW, pad.t + chartH);
  ctx.stroke();
  const max = Math.max(0.1, ...molds.map((m) => m.rejectRate));
  const bw = chartW / Math.max(1, molds.length) * 0.62;
  molds.forEach((m, i) => {
    const x = pad.l + (i + 0.2) * chartW / molds.length;
    const h = (m.rejectRate / max) * chartH;
    const y = pad.t + chartH - h;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, m.rejectRate > 0.12 ? '#ef4444' : m.rejectRate > 0.05 ? '#f59e0b' : '#22c55e');
    grad.addColorStop(1, 'rgba(56,189,248,.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, bw, h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${(m.rejectRate * 100).toFixed(0)}%`, x + bw / 2, y - 5);
    ctx.save();
    ctx.translate(x + bw / 2, pad.t + chartH + 16);
    ctx.rotate(-0.35);
    ctx.fillText(m.moldId, 0, 0);
    ctx.restore();
  });
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText('拒检率', 8, 16);
}

export function drawLehrHeatmap(canvas: HTMLCanvasElement, lehr: LehrStat[]): void {
  const zones = [...new Set(lehr.map((l) => l.lehrZone))];
  const sides: Array<LehrStat['side']> = ['L', 'C', 'R'];
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 260;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const cellW = Math.min(150, (cssW - 150) / Math.max(1, zones.length));
  const cellH = 58;
  const x0 = 92;
  const y0 = 34;
  ctx.font = '13px system-ui';
  ctx.textBaseline = 'middle';
  sides.forEach((side, r) => {
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'right';
    ctx.fillText(side === 'L' ? '左侧' : side === 'C' ? '中间' : '右侧', x0 - 12, y0 + r * cellH + cellH / 2);
    zones.forEach((zone, c) => {
      const stat = lehr.find((l) => l.lehrZone === zone && l.side === side);
      const rate = stat?.rejectRate ?? 0;
      const alpha = 0.18 + Math.min(0.72, rate * 3.2);
      ctx.fillStyle = rate > 0.12 ? `rgba(239,68,68,${alpha})` : rate > 0.05 ? `rgba(245,158,11,${alpha})` : `rgba(34,197,94,${alpha})`;
      const x = x0 + c * cellW;
      const y = y0 + r * cellH;
      ctx.fillRect(x + 4, y + 4, cellW - 8, cellH - 8);
      ctx.strokeStyle = 'rgba(226,232,240,.25)';
      ctx.strokeRect(x + 4, y + 4, cellW - 8, cellH - 8);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(`${(rate * 100).toFixed(0)}% · n${stat?.count ?? 0}`, x + cellW / 2, y + cellH / 2);
    });
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cbd5e1';
  zones.forEach((zone, c) => ctx.fillText(zone, x0 + c * cellW + cellW / 2, 18));
}
