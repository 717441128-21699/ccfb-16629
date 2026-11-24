import { clamp, lerp } from './mathUtils';
import type { BottleModel, RegionId } from './types';

export interface BottleProfile {
  model: BottleModel;
  label: string;
  width: number;
  height: number;
  /** y fraction from top, half width as fraction of image width. */
  halfWidth: Array<[number, number]>;
  mouthEndY: number;
  bottomStartY: number;
  wallThicknessMm: number;
  mouthThicknessMm: number;
  bottomThicknessMm: number;
  mmPerPixel: number;
}

export const BOTTLE_PROFILES: Record<BottleModel, BottleProfile> = {
  beer500: {
    model: 'beer500',
    label: '500 mL 啤酒瓶',
    width: 210,
    height: 304,
    halfWidth: [
      [0.0, 0.095], [0.035, 0.112], [0.075, 0.108], [0.105, 0.078],
      [0.20, 0.075], [0.27, 0.13], [0.34, 0.31], [0.39, 0.365],
      [0.76, 0.37], [0.84, 0.35], [0.90, 0.325], [0.95, 0.285], [1.0, 0.22]
    ],
    mouthEndY: 0.115,
    bottomStartY: 0.80,
    wallThicknessMm: 2.6,
    mouthThicknessMm: 5.4,
    bottomThicknessMm: 7.5,
    mmPerPixel: 0.31
  },
  wine750: {
    model: 'wine750',
    label: '750 mL 葡萄酒瓶',
    width: 196,
    height: 324,
    halfWidth: [
      [0.0, 0.085], [0.04, 0.105], [0.085, 0.10], [0.12, 0.068],
      [0.38, 0.07], [0.45, 0.12], [0.52, 0.285], [0.57, 0.35],
      [0.82, 0.355], [0.89, 0.335], [0.94, 0.29], [0.985, 0.22], [1.0, 0.18]
    ],
    mouthEndY: 0.12,
    bottomStartY: 0.84,
    wallThicknessMm: 2.8,
    mouthThicknessMm: 5.8,
    bottomThicknessMm: 8.5,
    mmPerPixel: 0.33
  },
  sauce350: {
    model: 'sauce350',
    label: '350 mL 宽口酱料瓶',
    width: 218,
    height: 264,
    halfWidth: [
      [0.0, 0.25], [0.05, 0.285], [0.12, 0.28], [0.17, 0.22],
      [0.23, 0.34], [0.30, 0.405], [0.76, 0.41], [0.86, 0.385],
      [0.93, 0.33], [0.985, 0.25], [1.0, 0.20]
    ],
    mouthEndY: 0.17,
    bottomStartY: 0.78,
    wallThicknessMm: 3.1,
    mouthThicknessMm: 6.2,
    bottomThicknessMm: 9.0,
    mmPerPixel: 0.29
  },
  vial100: {
    model: 'vial100',
    label: '100 mL 口服液瓶',
    width: 172,
    height: 247,
    halfWidth: [
      [0.0, 0.13], [0.05, 0.15], [0.10, 0.14], [0.15, 0.105],
      [0.25, 0.16], [0.32, 0.285], [0.38, 0.31], [0.80, 0.31],
      [0.90, 0.29], [0.96, 0.245], [1.0, 0.18]
    ],
    mouthEndY: 0.15,
    bottomStartY: 0.80,
    wallThicknessMm: 1.8,
    mouthThicknessMm: 3.8,
    bottomThicknessMm: 5.2,
    mmPerPixel: 0.21
  }
};

export function halfWidthAt(profile: BottleProfile, yFrac: number): number {
  const pts = profile.halfWidth;
  const y = clamp(yFrac, 0, 1);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [y0, w0] = pts[i];
    const [y1, w1] = pts[i + 1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / Math.max(1e-6, y1 - y0);
      // Smoothstep gives rounded moulded shoulders.
      const s = t * t * (3 - 2 * t);
      return lerp(w0, w1, s);
    }
  }
  return pts[pts.length - 1][1];
}

export interface BottleGeometryData {
  width: number;
  height: number;
  mask: Uint8Array;
  regions: Uint8Array;
  thicknessMm: Float32Array;
  centerX: number;
}

export function buildGeometry(model: BottleModel): BottleGeometryData {
  const p = BOTTLE_PROFILES[model];
  const { width: w, height: h } = p;
  const mask = new Uint8Array(w * h);
  const regions = new Uint8Array(w * h);
  const thickness = new Float32Array(w * h);
  const cx = w / 2;

  for (let y = 0; y < h; y += 1) {
    const yf = y / (h - 1);
    const hw = halfWidthAt(p, yf) * w;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const dx = x - cx;
      const inside = Math.abs(dx) <= hw;
      if (!inside) continue;
      mask[i] = 1;
      const xn = dx / Math.max(1, hw); // -1..1 along local row
      let region: RegionId = 1;
      if (yf <= p.mouthEndY) region = 3;
      else if (yf >= p.bottomStartY) region = 2;
      regions[i] = region;

      let t: number;
      if (region === 3) {
        // Finish/thread ring and lip are thickest at the outer thread.
        const thread = 0.85 + 0.35 * Math.exp(-((Math.abs(xn) - 0.72) ** 2) / 0.05);
        t = p.mouthThicknessMm * thread;
      } else if (region === 2) {
        const bottomY = (yf - p.bottomStartY) / (1 - p.bottomStartY);
        const heel = Math.exp(-((Math.abs(xn) - 0.78) ** 2) / 0.025 - ((bottomY - 0.32) ** 2) / 0.12);
        const centerPad = Math.exp(-(xn * xn) / 0.28 - ((bottomY - 0.72) ** 2) / 0.22);
        t = p.wallThicknessMm * 1.7 + p.bottomThicknessMm * (0.45 * centerPad + 0.85 * heel);
      } else {
        // Two walls in transmission; tangent viewing near the contour lengthens path.
        const tangent = 1 + 1.65 * Math.pow(Math.abs(xn), 5);
        t = 2 * p.wallThicknessMm * tangent;
      }
      thickness[i] = t;
    }
  }
  return { width: w, height: h, mask, regions, thicknessMm: thickness, centerX: cx };
}

export function criticalBottomCenterMask(geo: BottleGeometryData, profile: BottleProfile): Uint8Array {
  const { width: w, height: h } = geo;
  const out = new Uint8Array(w * h);
  const cy = h * (p_bottomCenterY(profile));
  const rx = w * 0.17;
  const ry = h * 0.055;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!geo.mask[i] || geo.regions[i] !== 2) continue;
      const d = ((x - w / 2) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d <= 1) out[i] = 1;
    }
  }
  return out;
}

function p_bottomCenterY(p: BottleProfile): number {
  return p.bottomStartY + (1 - p.bottomStartY) * 0.62;
}

export function mouthCriticalMask(geo: BottleGeometryData, profile: BottleProfile): Uint8Array {
  const { width: w, height: h } = geo;
  const out = new Uint8Array(w * h);
  const cy = h * profile.mouthEndY * 0.48;
  const rx = w * 0.13;
  const ry = h * 0.04;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!geo.mask[i] || geo.regions[i] !== 3) continue;
      const d = ((x - w / 2) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d <= 1.2) out[i] = 1;
    }
  }
  return out;
}
