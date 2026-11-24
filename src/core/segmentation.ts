import { BOTTLE_PROFILES, criticalBottomCenterMask, mouthCriticalMask, type BottleProfile } from './bottleGeometry';
import { tintGains } from './colorLut';
import { clamp } from './mathUtils';
import type { BottleModel, CalibrationConfig, Raster } from './types';

export interface SegmentationResult {
  mask: Uint8Array;
  regions: Uint8Array;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  contour: Array<{ x: number; y: number }>;
  thicknessMm: Float32Array;
  bottomCenterMask: Uint8Array;
  mouthCriticalMask: Uint8Array;
  /** Eroded ROI: excludes Fresnel/rim highlights at the glass contour. */
  measureMask: Uint8Array;
  profile: BottleProfile;
  threshold: number;
}

function linearByte(v: number): number {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function otsuThreshold(scores: Float32Array, n: number): number {
  const hist = new Uint32Array(256);
  let max = 1e-6;
  for (let i = 0; i < n; i += 1) max = Math.max(max, scores[i]);
  for (let i = 0; i < n; i += 1) hist[Math.min(255, Math.floor((scores[i] / max) * 255))] += 1;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 0.18 * max;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = (t / 255) * max;
    }
  }
  return threshold;
}

function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  let current = 0;
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    let size = 0;
    labels[start] = current;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop()!;
      size += 1;
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x > 0) {
        const n = idx - 1;
        if (mask[n] && labels[n] === -1) { labels[n] = current; stack.push(n); }
      }
      if (x + 1 < w) {
        const n = idx + 1;
        if (mask[n] && labels[n] === -1) { labels[n] = current; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - w;
        if (mask[n] && labels[n] === -1) { labels[n] = current; stack.push(n); }
      }
      if (y + 1 < h) {
        const n = idx + w;
        if (mask[n] && labels[n] === -1) { labels[n] = current; stack.push(n); }
      }
    }
    sizes.push(size);
    current += 1;
  }
  if (sizes.length === 0) return mask;
  let best = 0;
  for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i += 1) if (labels[i] === best) out[i] = 1;
  return out;
}

function smoothRowIntervals(mask: Uint8Array, w: number, h: number): void {
  // Fill each row between robust extrema and median-smooth interval edges.
  const left = new Int32Array(h).fill(w);
  const right = new Int32Array(h).fill(-1);
  const count = new Int32Array(h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]) {
        count[y] += 1;
        if (x < left[y]) left[y] = x;
        if (x > right[y]) right[y] = x;
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    if (count[y] < 5) {
      left[y] = w;
      right[y] = -1;
    }
  }
  const med = (arr: Int32Array, y: number, fallback: number) => {
    const vals = [arr[Math.max(0, y - 1)], arr[y], arr[Math.min(h - 1, y + 1)]].filter((v) => v !== fallback && v >= 0);
    if (!vals.length) return arr[y];
    vals.sort((a, b) => a - b);
    return vals[1];
  };
  for (let y = 0; y < h; y += 1) {
    if (right[y] < 0) continue;
    const l = med(left, y, w);
    const r = med(right, y, -1);
    for (let x = Math.max(0, l); x <= Math.min(w - 1, r); x += 1) mask[y * w + x] = 1;
  }
}

function erodeMask(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let src = mask;
  for (let iter = 0; iter < iterations; iter += 1) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (src[i] && src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) out[i] = 1;
      }
    }
    src = out;
  }
  return src;
}

function estimateThickness(
  w: number,
  h: number,
  mask: Uint8Array,
  regions: Uint8Array,
  bbox: SegmentationResult['bbox'],
  model: BottleModel
): Float32Array {
  const p = BOTTLE_PROFILES[model];
  const out = new Float32Array(w * h);
  const bh = Math.max(1, bbox.y1 - bbox.y0);
  for (let y = bbox.y0; y <= bbox.y1; y += 1) {
    const yf = (y - bbox.y0) / bh;
    // Use detected row width for local tangent factor.
    let minX = w;
    let maxX = -1;
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    const rowHalf = Math.max(1, (maxX - minX) / 2);
    const cx = (minX + maxX) / 2;
    for (let x = minX; x <= maxX; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const xn = (x - cx) / rowHalf;
      const region = regions[i];
      let t: number;
      if (region === 3) {
        const thread = 0.85 + 0.35 * Math.exp(-((Math.abs(xn) - 0.72) ** 2) / 0.05);
        t = p.mouthThicknessMm * thread;
      } else if (region === 2) {
        const bottomY = (yf - p.bottomStartY) / Math.max(0.01, 1 - p.bottomStartY);
        const heel = Math.exp(-((Math.abs(xn) - 0.78) ** 2) / 0.025 - ((bottomY - 0.32) ** 2) / 0.12);
        const centerPad = Math.exp(-(xn * xn) / 0.28 - ((bottomY - 0.72) ** 2) / 0.22);
        t = p.wallThicknessMm * 1.7 + p.bottomThicknessMm * (0.45 * centerPad + 0.85 * heel);
      } else {
        const tangent = 1 + 1.65 * Math.pow(Math.abs(xn), 5);
        t = 2 * p.wallThicknessMm * tangent;
      }
      out[i] = t;
    }
  }
  return out;
}

export function segmentBottle(
  image: Raster,
  calibration: CalibrationConfig,
  model: BottleModel = 'beer500'
): SegmentationResult {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const scores = new Float32Array(n);
  const border: number[][] = [[], [], []];
  const borderCount = 3;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const isBorder = x < borderCount || y < borderCount || x >= w - borderCount || y >= h - borderCount;
      if (!isBorder) continue;
      const i = (y * w + x) * 4;
      border[0].push(linearByte(data[i]));
      border[1].push(linearByte(data[i + 1]));
      border[2].push(linearByte(data[i + 2]));
    }
  }
  const median = (a: number[]) => {
    a.sort((x, y) => x - y);
    return a[a.length >> 1] ?? 0.02;
  };
  const bg = [median(border[0]), median(border[1]), median(border[2])];
  const dark = [linearByte(calibration.darkLevel[0]), linearByte(calibration.darkLevel[1]), linearByte(calibration.darkLevel[2])];

  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const r = Math.max(0, linearByte(data[p]) - dark[0]);
    const g = Math.max(0, linearByte(data[p + 1]) - dark[1]);
    const b = Math.max(0, linearByte(data[p + 2]) - dark[2]);
    const dr = r - bg[0];
    const dg = g - bg[1];
    const db = b - bg[2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    scores[i] = Math.sqrt(0.9 * dr * dr + 1.1 * dg * dg + 0.8 * db * db) + 0.22 * chroma + 0.1 * lum;
  }

  // In a calibrated dark-field station the unstressed bottle body is only a
  // few linear percent above the crossed-polarizer background. Otsu is useful
  // for exposure drift but must not be allowed to jump to the bright fringe
  // mode; clamp it to a narrow calibrated segmentation band.
  const threshold = clamp(otsuThreshold(scores, n) * 0.18, 0.014, 0.026);
  let mask: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) mask[i] = scores[i] > threshold ? 1 : 0;

  // Remove isolated camera noise and retain the bottle connected component.
  mask = largestComponent(mask, w, h);
  smoothRowIntervals(mask, w, h);

  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 <= x0 || y1 <= y0) {
    x0 = Math.floor(w * 0.2); x1 = Math.floor(w * 0.8);
    y0 = Math.floor(h * 0.05); y1 = Math.floor(h * 0.95);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) mask[y * w + x] = 1;
  }

  const profile = BOTTLE_PROFILES[model];
  const regions = new Uint8Array(n);
  const bh = Math.max(1, y1 - y0);
  for (let y = y0; y <= y1; y += 1) {
    const yf = (y - y0) / bh;
    let region = 1;
    if (yf <= profile.mouthEndY) region = 3;
    else if (yf >= profile.bottomStartY) region = 2;
    for (let x = x0; x <= x1; x += 1) {
      const i = y * w + x;
      if (mask[i]) regions[i] = region;
    }
  }

  const geo = { width: w, height: h, mask, regions, thicknessMm: new Float32Array(n), centerX: w / 2 };
  const bottomCenterResult = criticalBottomCenterMask(geo, profile);
  const mouthCriticalResult = mouthCriticalMask(geo, profile);
  const measureMask = erodeMask(mask, w, h, 2);
  const thicknessMm = estimateThickness(w, h, mask, regions, { x0, y0, x1, y1 }, model);

  const contour: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y += 2) {
    let l = -1;
    let r = -1;
    for (let x = x0; x <= x1; x += 1) {
      if (mask[y * w + x]) { l = x; break; }
    }
    for (let x = x1; x >= x0; x -= 1) {
      if (mask[y * w + x]) { r = x; break; }
    }
    if (l >= 0 && r >= 0) contour.push({ x: l, y }, { x: r, y });
  }

  return {
    mask,
    regions,
    bbox: { x0, y0, x1, y1 },
    contour,
    thicknessMm,
    measureMask,
    bottomCenterMask: bottomCenterResult,
    mouthCriticalMask: mouthCriticalResult,
    profile,
    threshold
  };
}

export function correctPixelToQ(
  image: Raster,
  pixelIndex: number,
  cal: CalibrationConfig,
  thicknessMm: number
): { r: number; g: number; b: number; signal: number } {
  const p = pixelIndex * 4;
  const lin = [linearByte(image.data[p]), linearByte(image.data[p + 1]), linearByte(image.data[p + 2])];
  const dark = [linearByte(cal.darkLevel[0]), linearByte(cal.darkLevel[1]), linearByte(cal.darkLevel[2])];
  const t4 = tintGains(cal.glassTint, 4);
  const t = tintGains(cal.glassTint, clamp(thicknessMm || cal.nominalThicknessMm, 1, 14));
  const t4arr = [t4.r, t4.g, t4.b];
  const tarr = [t.r, t.g, t.b];
  const q = [0, 0, 0];
  let signal = 0;
  for (let c = 0; c < 3; c += 1) {
    // channelGain was calibrated at 4 mm; rescale for actual optical thickness.
    const rawQ = Math.max(0, (lin[c] - dark[c]) * cal.channelGain[c] * (t4arr[c] / Math.max(0.02, tarr[c])));
    q[c] = Math.max(0, Math.min(1.15, rawQ - cal.zeroStressOffset[c]));
    signal += Math.max(0, lin[c] - dark[c]);
  }
  return { r: q[0], g: q[1], b: q[2], signal };
}
