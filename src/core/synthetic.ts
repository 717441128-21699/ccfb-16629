import { BOTTLE_PROFILES, buildGeometry, criticalBottomCenterMask, halfWidthAt } from './bottleGeometry';
import { COLOR_CURVE, linearToSrgbByte, srgbToLinear, tintGains } from './colorLut';
import { STANDARDS, gradeForRetardation } from './standards';
import { clamp, gauss2, mulberry32 } from './mathUtils';
import type {
  BottleModel,
  DefectKind,
  GlassTint,
  GroundTruth,
  Raster,
  SyntheticBottle
} from './types';

export interface SynthesizeOptions {
  id?: string;
  seed?: number;
  model?: BottleModel;
  tint?: GlassTint;
  defectKind?: DefectKind;
  severity?: number; // 0.4..1.5 multiplier
  moldId?: string;
  cavity?: number;
  lehrZone?: string;
  lehrSide?: 'L' | 'C' | 'R';
  standardProfile?: keyof typeof STANDARDS;
  noise?: number;
}

function sampleCurve(rNm: number): { r: number; g: number; b: number } {
  const x = clamp(rNm, 0, COLOR_CURVE.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = COLOR_CURVE[i];
  const b = COLOR_CURVE[Math.min(COLOR_CURVE.length - 1, i + 1)];
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
}

interface DefectFieldParams {
  jitter: number;
  bottomCx: number;
  bottomCy: number;
  bodySide: number;
  seamX: number;
  lehrSign: number;
}

function stressField(
  kind: DefectKind,
  x: number,
  y: number,
  w: number,
  h: number,
  localXn: number,
  bottomY: number,
  severity: number,
  params: DefectFieldParams
): number {
  const nx = (x - w / 2) / (w / 2);
  const ny = y / h;
  const edge = Math.pow(Math.abs(localXn), 3.2);
  let s = 1.15 + 1.35 * edge + 0.35 * Math.sin(ny * 19 + nx * 2.1);

  const sev = severity;
  const jitter = params.jitter;

  if (kind === 'healthy') {
    s += 1.1 * gauss2(nx, ny, 0, 0.89, 0.55, 0.12);
    return Math.max(0.4, s * (0.75 + 0.25 * sev));
  }

  if (kind === 'bottom-center') {
    const cx = params.bottomCx;
    const cy = params.bottomCy;
    const dx = (nx - cx) / 0.18;
    const dy = (ny - cy) / 0.055;
    const rad = Math.sqrt(dx * dx + dy * dy);
    const theta = Math.atan2(dy, dx);
    const clover = 0.72 + 0.28 * Math.cos(4 * theta + 0.4);
    s += 10.5 * sev * jitter * Math.exp(-0.5 * rad * rad) * clover;
    s += 3.2 * sev * gauss2(nx, ny, 0, 0.845, 0.72, 0.035);
  } else if (kind === 'heel-ring') {
    const ringL = gauss2(nx, ny, -0.68, 0.855, 0.10, 0.035);
    const ringR = gauss2(nx, ny, 0.68, 0.855, 0.10, 0.035);
    const ring = Math.exp(-((Math.abs(nx) - 0.72) ** 2) / 0.018 - ((ny - 0.855) ** 2) / 0.0028);
    s += 8.8 * sev * jitter * Math.max(ring, 0.82 * Math.max(ringL, ringR));
  } else if (kind === 'mouth') {
    const ring = Math.exp(-((Math.abs(nx) - 0.17) ** 2) / 0.006 - ((ny - 0.06) ** 2) / 0.0016);
    const lip = gauss2(nx, ny, 0, 0.045, 0.20, 0.025);
    s += 9.6 * sev * jitter * Math.max(ring, 0.55 * lip);
  } else if (kind === 'body-panel') {
    const side = params.bodySide;
    s += 7.2 * sev * jitter * gauss2(nx, ny, side, 0.56, 0.20, 0.18);
  } else if (kind === 'mold-seam') {
    const seamX = params.seamX;
    const seam = Math.exp(-((nx - seamX) ** 2) / 0.0018) *
      Math.exp(-((ny - 0.56) ** 2) / 0.16);
    const opposite = Math.exp(-((nx + seamX) ** 2) / 0.003) *
      Math.exp(-((ny - 0.60) ** 2) / 0.13);
    s += 8.2 * sev * jitter * Math.max(seam, 0.55 * opposite);
  } else if (kind === 'lehr-gradient') {
    const sideBias = nx * params.lehrSign;
    s += 5.8 * sev * (0.35 + 0.65 * (sideBias + 1) / 2);
    s += 2.8 * sev * gauss2(nx, ny, 0.15 * Math.sign(nx || 1), 0.88, 0.5, 0.08);
  } else if (kind === 'mixed') {
    s += 6.8 * sev * gauss2(nx, ny, 0, 0.90, 0.20, 0.06);
    const ring = Math.exp(-((Math.abs(nx) - 0.17) ** 2) / 0.006 - ((ny - 0.06) ** 2) / 0.0016);
    s += 5.4 * sev * ring;
    s += 2.8 * sev * ((nx + 1) / 2);
  }

  // Bottom coordinate retained for future anisotropic patterns.
  void bottomY;
  return Math.max(0.35, s);
}

export function synthesizeBottle(options: SynthesizeOptions = {}): SyntheticBottle {
  const model = options.model ?? 'beer500';
  const tint = options.tint ?? 'flint';
  const defectKind = options.defectKind ?? 'healthy';
  const seed = options.seed ?? 1;
  const rng = mulberry32(seed);
  const profile = BOTTLE_PROFILES[model];
  const geo = buildGeometry(model);
  const { width: w, height: h, mask, regions, thicknessMm } = geo;
  const severity = options.severity ?? 0.85 + rng() * 0.55;
  const noise = options.noise ?? 1.0;
  const defectParams: DefectFieldParams = {
    jitter: 0.92 + rng() * 0.16,
    bottomCx: (rng() - 0.5) * 0.06,
    bottomCy: 0.90 + (rng() - 0.5) * 0.025,
    bodySide: rng() > 0.5 ? 0.48 : -0.48,
    seamX: 0.80 + (rng() - 0.5) * 0.035,
    lehrSign: rng() > 0.2 ? 1 : -1
  };
  const standard = STANDARDS[options.standardProfile ?? 'gbt4545-container'];
  const C = 3.2e-12;

  const retardation = new Float32Array(w * h);
  const stress = new Float32Array(w * h);
  const imageData = new Uint8ClampedArray(w * h * 4);

  let worstR = 0;
  let worstGrade = 1;

  for (let y = 0; y < h; y += 1) {
    const yf = y / (h - 1);
    const hw = Math.max(1, halfWidthAt(profile, yf) * w);
    const bottomY = regions[y * w + Math.floor(w / 2)] === 2
      ? (yf - profile.bottomStartY) / (1 - profile.bottomStartY)
      : 0;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const p = i * 4;
      const nx01 = (x - w / 2) / hw;

      // Dark crossed-polarizer field with a faint vertical illumination gradient.
      const vig = 1 - 0.18 * (((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) * 0.25;
      let lr = 0.018 * vig + 0.002 * Math.sin(y * 0.05);
      let lg = 0.020 * vig + 0.002 * Math.sin(y * 0.043 + 1);
      let lb = 0.034 * vig + 0.003;

      if (mask[i]) {
        const sigmaMPa = stressField(defectKind, x, y, w, h, nx01, bottomY, severity, defectParams);
        const tMm = thicknessMm[i];
        const rNm = C * sigmaMPa * 1e6 * (tMm / 1000) * 1e9;
        retardation[i] = rNm;
        stress[i] = sigmaMPa;
        if (rNm > worstR) {
          worstR = rNm;
          worstGrade = gradeForRetardation(rNm, standard);
        }

        const q = sampleCurve(rNm);
        const T = tintGains(tint, clamp(tMm, 1, 12));
        const rim = Math.pow(clamp((Math.abs(nx01) - 0.82) / 0.18, 0, 1), 2) * 0.12;
        const baseLeak = 0.04;
        const exposure = 0.82;
        lr = T.r * (baseLeak + exposure * q.r + rim);
        lg = T.g * (baseLeak + exposure * q.g + rim * 0.9);
        lb = T.b * (baseLeak * 0.8 + exposure * q.b + rim * 1.05);
      }

      // Photon/read noise is added in the encoded domain below; first gamma encode.
      let rr = linearToSrgbByte(clamp(lr, 0, 1));
      let gg = linearToSrgbByte(clamp(lg, 0, 1));
      let bb = linearToSrgbByte(clamp(lb, 0, 1));
      const n = (rng() + rng() + rng() - 1.5) * noise;
      const chromaNoise = (rng() - 0.5) * noise * 0.55;
      rr = clamp(rr + n + chromaNoise, 0, 255);
      gg = clamp(gg + n, 0, 255);
      bb = clamp(bb + n - chromaNoise, 0, 255);
      imageData[p] = rr;
      imageData[p + 1] = gg;
      imageData[p + 2] = bb;
      imageData[p + 3] = 255;
    }
  }

  // A few dead/hot pixels make calibration and confidence meaningful.
  for (let k = 0; k < 18; k += 1) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const p = (y * w + x) * 4;
    imageData[p] = clamp(imageData[p] + (rng() > 0.5 ? 45 : -35), 0, 255);
  }

  // The standard inspection finds the worst sustained patch in the controlled
  // zones. Use the zonal 99th percentile (not one noisy pixel and not the 99th
  // percentile of the whole bottle, which can dilute a small critical zone).
  const bcMask = criticalBottomCenterMask(geo, profile);
  const zonalPeak = (predicate: (i: number) => boolean): number => {
    const values: number[] = [];
    for (let i = 0; i < retardation.length; i += 1) {
      if (mask[i] && predicate(i)) values.push(retardation[i]);
    }
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.round(0.98 * (values.length - 1)))];
  };
  const visualWorstR = Math.max(
    zonalPeak((i) => regions[i] === 3),
    zonalPeak((i) => bcMask[i] === 1),
    zonalPeak((i) => regions[i] === 2),
    zonalPeak((i) => regions[i] === 1)
  );
  worstR = visualWorstR;
  worstGrade = gradeForRetardation(worstR, standard);

  // The reference operator reads a calibrated Senarmont/color chart. On the
  // synthetic benchmark the consensus reading is the zonal physical value;
  // camera/inspector variability is represented by image noise itself.
  const manualGrade = gradeForRetardation(worstR, standard);
  const truth: GroundTruth = {
    retardationNm: retardation,
    stressMPa: stress,
    regions,
    thicknessMm,
    worstRetardationNm: worstR,
    worstGrade,
    accepted: worstGrade <= standard.acceptMaxGrade,
    manualGrade,
    manualAccepted: manualGrade <= standard.acceptMaxGrade
  };

  const raster: Raster = { width: w, height: h, data: imageData };
  return {
    image: raster,
    truth,
    width: w,
    height: h,
    meta: {
      id: options.id ?? `SYN-${seed}`,
      moldId: options.moldId ?? `M-${String(1 + (seed % 8)).padStart(2, '0')}`,
      cavity: options.cavity ?? 1 + (seed % 4),
      bottleModel: model,
      tint,
      defectKind,
      lehrZone: options.lehrZone ?? `Lehr-${String(1 + (seed % 4)).padStart(2, '0')}`,
      lehrSide: options.lehrSide ?? (['L', 'C', 'R'] as const)[seed % 3],
      thicknessMm: profile.bottomThicknessMm
    }
  };
}

export function generateRetardationWedge(
  maxNm = 320,
  width = 640,
  height = 120,
  tint: GlassTint = 'flint',
  noise = 0.8,
  seed = 4242
): Raster & { expectedNm: Float32Array } {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const expected = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const rNm = (x / (width - 1)) * maxNm;
    expected[x] = rNm;
    const q = sampleCurve(rNm);
    const T = tintGains(tint, 4);
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const stripe = 0.96 + 0.04 * Math.sin((y / height) * Math.PI);
      const lr = T.r * (0.04 + q.r * 0.82 * stripe);
      const lg = T.g * (0.04 + q.g * 0.82 * stripe);
      const lb = T.b * (0.04 + q.b * 0.82 * stripe);
      const n = (rng() + rng() + rng() - 1.5) * noise;
      data[i] = clamp(linearToSrgbByte(lr) + n, 0, 255);
      data[i + 1] = clamp(linearToSrgbByte(lg) + n, 0, 255);
      data[i + 2] = clamp(linearToSrgbByte(lb) + n, 0, 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data, expectedNm: expected };
}

export function rawPixelToLinear(rgba: Uint8ClampedArray, i: number): { r: number; g: number; b: number } {
  return {
    r: srgbToLinear(rgba[i]),
    g: srgbToLinear(rgba[i + 1]),
    b: srgbToLinear(rgba[i + 2])
  };
}
