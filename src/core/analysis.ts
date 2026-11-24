import { COLOR_CURVE, decodeRetardation } from './colorLut';
import { STANDARDS, gradeForRetardation } from './standards';
import { correctPixelToQ, segmentBottle } from './segmentation';
import type {
  BottleAnalysis,
  BottleModel,
  CalibrationConfig,
  DefectMark,
  Raster,
  ZoneStat
} from './types';

export interface AnalyzeBottleInput {
  id?: string;
  moldId?: string;
  cavity?: number;
  image: Raster;
  calibration: CalibrationConfig;
  bottleModel?: BottleModel;
  generateHeatmap?: boolean;
  truth?: BottleAnalysis['truth'];
  defectKind?: BottleAnalysis['defectKind'];
  lehrZone?: string;
  lehrSide?: BottleAnalysis['lehrSide'];
  tint?: BottleAnalysis['tint'];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function smoothRetardation(mask: Uint8Array, input: Float32Array, w: number, h: number): Float32Array {
  // Mask-aware separable [1,2,1] filter: removes single-pixel decoder/camera
  // spikes without the peak loss of a 3x3 median on narrow isochromatic bands.
  const horizontal = new Float32Array(input.length);
  const out = new Float32Array(input.length);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const i = row + x;
      if (!mask[i]) continue;
      let sum = 2 * input[i];
      let weight = 2;
      if (x > 0 && mask[i - 1]) { sum += input[i - 1]; weight += 1; }
      if (x + 1 < w && mask[i + 1]) { sum += input[i + 1]; weight += 1; }
      horizontal[i] = sum / weight;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let sum = 2 * horizontal[i];
      let weight = 2;
      if (y > 0 && mask[i - w]) { sum += horizontal[i - w]; weight += 1; }
      if (y + 1 < h && mask[i + w]) { sum += horizontal[i + w]; weight += 1; }
      out[i] = sum / weight;
    }
  }
  return out;
}

function heatColor(t: number): [number, number, number] {
  // t in 0..1: navy -> blue -> cyan -> green -> yellow -> red.
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [28, 32, 92]],
    [0.18, [34, 87, 196]],
    [0.38, [20, 184, 214]],
    [0.58, [58, 196, 94]],
    [0.76, [244, 211, 55]],
    [0.9, [239, 111, 40]],
    [1.0, [214, 39, 40]]
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f)
      ];
    }
  }
  return [214, 39, 40];
}

const HEAT_LUT_SIZE = 1024;
const HEAT_LUT = new Uint8Array(HEAT_LUT_SIZE * 3);
for (let i = 0; i < HEAT_LUT_SIZE; i += 1) {
  const [r, g, b] = heatColor(i / (HEAT_LUT_SIZE - 1));
  HEAT_LUT[i * 3] = r;
  HEAT_LUT[i * 3 + 1] = g;
  HEAT_LUT[i * 3 + 2] = b;
}

function makeHeatmap(
  w: number,
  h: number,
  mask: Uint8Array,
  retardation: Float32Array,
  maxNm: number
): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    if (!mask[i]) continue;
    const t = Math.max(0, Math.min(1, retardation[i] / maxNm));
    const li = Math.round(t * (HEAT_LUT_SIZE - 1)) * 3;
    const p = i * 4;
    data[p] = HEAT_LUT[li];
    data[p + 1] = HEAT_LUT[li + 1];
    data[p + 2] = HEAT_LUT[li + 2];
    data[p + 3] = 218;
  }
  return { width: w, height: h, data };
}

interface ZoneArgs {
  id: string;
  name: string;
  region: ZoneStat['region'];
  selector: (i: number, x: number, y: number) => boolean;
  critical: boolean;
}

function computeZone(
  args: ZoneArgs,
  w: number,
  h: number,
  mask: Uint8Array,
  retardation: Float32Array,
  stress: Float32Array,
  thickness: Float32Array,
  cal: CalibrationConfig
): ZoneStat {
  const rs: number[] = [];
  const ss: number[] = [];
  let count = 0;
  let maxR = -1;
  let maxS = -1;
  let worst = 0;
  let thicknessSum = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i] || !args.selector(i, x, y)) continue;
      count += 1;
      rs.push(retardation[i]);
      ss.push(stress[i]);
      thicknessSum += thickness[i] || cal.nominalThicknessMm;
      if (retardation[i] > maxR) {
        maxR = retardation[i];
        maxS = stress[i];
        worst = i;
      }
    }
  }
  if (count === 0) {
    return {
      id: args.id, name: args.name, region: args.region, pixelCount: 0, areaMm2: 0,
      thicknessMm: cal.nominalThicknessMm, maxRetardationNm: 0, peakRetardationNm: 0,
      p95RetardationNm: 0, meanRetardationNm: 0, maxStressMPa: 0, peakStressMPa: 0,
      p95StressMPa: 0, grade: 1,
      accepted: false, worstPoint: { x: 0, y: 0 }
    };
  }
  const profile = STANDARDS[cal.standardProfile];
  rs.sort((a, b) => a - b);
  ss.sort((a, b) => a - b);
  const p95Index = Math.min(rs.length - 1, Math.max(0, Math.round(0.95 * (rs.length - 1))));
  const p95R = rs[p95Index];
  const p95S = ss[p95Index];
  const peakIndex = Math.min(rs.length - 1, Math.max(0, Math.round(0.98 * (rs.length - 1))));
  const peakR = rs[peakIndex];
  const peakS = ss[peakIndex];
  const meanR = rs.reduce((a, b) => a + b, 0) / rs.length;
  const grade = gradeForRetardation(peakR, profile);
  const limit = args.critical ? profile.criticalAcceptMaxGrade : profile.acceptMaxGrade;
  return {
    id: args.id,
    name: args.name,
    region: args.region,
    pixelCount: count,
    areaMm2: count * cal.mmPerPixel * cal.mmPerPixel,
    thicknessMm: thicknessSum / count,
    maxRetardationNm: maxR,
    peakRetardationNm: peakR,
    p95RetardationNm: p95R,
    meanRetardationNm: meanR,
    maxStressMPa: maxS,
    peakStressMPa: peakS,
    p95StressMPa: p95S,
    grade,
    accepted: grade <= limit,
    worstPoint: { x: worst % w, y: Math.floor(worst / w) }
  };
}

export function analyzeBottle(input: AnalyzeBottleInput): BottleAnalysis {
  const started = nowMs();
  const { image, calibration: cal } = input;
  const model = input.bottleModel ?? 'beer500';
  const seg = segmentBottle(image, cal, model);
  const { width: w, height: h } = image;
  const n = w * h;
  const rawRetardation = new Float32Array(n);
  const retardation = new Float32Array(n);
  const stress = new Float32Array(n);
  const confidence = new Float32Array(n);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!seg.measureMask[i]) continue;
      const q = correctPixelToQ(image, i, cal, seg.thicknessMm[i]);
      const hint = y > 0 && seg.measureMask[i - w] ? rawRetardation[i - w] : undefined;
      const r = decodeRetardation(q, { continuityHintNm: hint, continuityWeight: 0.00000002 });
      rawRetardation[i] = r;
      const curve = COLOR_CURVE[Math.round(r)] ?? COLOR_CURVE[0];
      const matchError =
        1.05 * (curve.r - q.r) ** 2 + 1.15 * (curve.g - q.g) ** 2 + 0.8 * (curve.b - q.b) ** 2;
      confidence[i] = Math.max(0.15, Math.min(1, 0.96 - Math.sqrt(matchError) * 1.7 + Math.min(0.12, q.signal * 1.5)));
    }
  }

  const filtered = smoothRetardation(seg.measureMask, rawRetardation, w, h);
  for (let i = 0; i < n; i += 1) {
    if (!seg.measureMask[i]) continue;
    retardation[i] = filtered[i];
    const tMm = seg.thicknessMm[i] || cal.nominalThicknessMm;
    stress[i] = (retardation[i] * 1e-15) / (cal.stressOpticalCoefficientPa * (tMm / 1000));
  }

  const zones = [
    computeZone({
      id: 'mouth', name: '瓶口/螺纹', region: 'mouth', critical: true,
      selector: (i) => seg.regions[i] === 3
    }, w, h, seg.measureMask, retardation, stress, seg.thicknessMm, cal),
    computeZone({
      id: 'bottom-center', name: '瓶底中心', region: 'critical', critical: true,
      selector: (i) => seg.bottomCenterMask[i] === 1
    }, w, h, seg.measureMask, retardation, stress, seg.thicknessMm, cal),
    computeZone({
      id: 'bottom', name: '瓶底/跟部整区', region: 'bottom', critical: false,
      selector: (i) => seg.regions[i] === 2
    }, w, h, seg.measureMask, retardation, stress, seg.thicknessMm, cal),
    computeZone({
      id: 'body', name: '瓶身', region: 'body', critical: false,
      selector: (i) => seg.regions[i] === 1
    }, w, h, seg.measureMask, retardation, stress, seg.thicknessMm, cal)
  ];

  const marks: DefectMark[] = [];
  for (const z of zones) {
    if (z.pixelCount === 0) continue;
    const profile = STANDARDS[cal.standardProfile];
    const limit = z.region === 'critical' || z.id === 'mouth'
      ? profile.criticalAcceptMaxGrade
      : profile.acceptMaxGrade;
    if (!z.accepted) {
      marks.push({
        x: z.worstPoint.x,
        y: z.worstPoint.y,
        radius: z.id === 'body' ? 24 : 20,
        zone: z.name,
        severity: 'reject',
        retardationNm: z.peakRetardationNm,
        stressMPa: z.peakStressMPa,
        grade: z.grade,
        message: `${z.name} 峰值 ${z.peakRetardationNm.toFixed(0)} nm / ${z.peakStressMPa.toFixed(1)} MPa，${z.grade} 级，超过 ${limit} 级限值`
      });
    } else if (z.grade === limit && (z.id === 'bottom-center' || z.id === 'mouth')) {
      marks.push({
        x: z.worstPoint.x,
        y: z.worstPoint.y,
        radius: 17,
        zone: z.name,
        severity: 'watch',
        retardationNm: z.peakRetardationNm,
        stressMPa: z.peakStressMPa,
        grade: z.grade,
        message: `${z.name} 处于 ${z.grade} 级临界，建议复检并观察模具/炉温`
      });
    }
  }

  const overallGrade = zones.reduce((m, z) => Math.max(m, z.grade), 1);
  const accepted = zones.every((z) => z.accepted);
  const worstZone = [...zones].sort((a, b) => b.maxRetardationNm - a.maxRetardationNm)[0]?.name ?? '未检出';
  const heatMax = Math.max(180, STANDARDS[cal.standardProfile].gradeUpperNm.at(-2) ?? 260);
  const stressHeatmap = input.generateHeatmap === false
    ? null
    : makeHeatmap(w, h, seg.measureMask, retardation, heatMax);

  return {
    id: input.id ?? `B-${Math.round(nowMs())}`,
    moldId: input.moldId ?? 'M-UNKNOWN',
    cavity: input.cavity ?? 0,
    bottleModel: model,
    tint: input.tint ?? cal.glassTint,
    defectKind: input.defectKind,
    lehrZone: input.lehrZone,
    lehrSide: input.lehrSide,
    width: w,
    height: h,
    durationMs: nowMs() - started,
    mask: seg.mask,
    measureMask: seg.measureMask,
    regions: seg.regions,
    thicknessMm: seg.thicknessMm,
    retardationNm: retardation,
    stressMPa: stress,
    confidence,
    stressHeatmap,
    overlay: null,
    zones,
    marks,
    overallGrade,
    accepted,
    worstZone,
    truth: input.truth
  };
}
