import type { CalibrationConfig, GlassTint } from './types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const WL_START = 400;
const WL_END = 700;
const WL_STEP = 10;
const WAVELENGTHS: number[] = [];
for (let l = WL_START; l <= WL_END; l += WL_STEP) WAVELENGTHS.push(l);

function gaussian(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

/** Approximate CMOS QE curves. Broad overlap intentionally creates realistic pastel isochromatics. */
function cameraQE(lambdaNm: number): RGB {
  return {
    r:
      0.86 * gaussian(lambdaNm, 605, 43) +
      0.08 * gaussian(lambdaNm, 670, 24),
    g:
      0.92 * gaussian(lambdaNm, 540, 38) +
      0.1 * gaussian(lambdaNm, 495, 25),
    b:
      0.9 * gaussian(lambdaNm, 460, 27) +
      0.16 * gaussian(lambdaNm, 420, 18)
  };
}

function illuminant(lambdaNm: number): number {
  // Smooth daylight/LED panel approximation.
  return 0.82 + 0.18 * gaussian(lambdaNm, 550, 120) + 0.08 * gaussian(lambdaNm, 450, 35);
}

/** Effective channel transmission for the three container-glass families. */
export function tintGains(tint: GlassTint, thicknessMm = 4): RGB {
  const cm = thicknessMm / 10;
  if (tint === 'amber') {
    // Strong blue/UV absorption, useful red transmission.
    return {
      r: Math.exp(-0.18 * cm),
      g: Math.exp(-1.15 * cm),
      b: Math.exp(-3.4 * cm)
    };
  }
  if (tint === 'green') {
    return {
      r: Math.exp(-1.35 * cm),
      g: Math.exp(-0.34 * cm),
      b: Math.exp(-1.05 * cm)
    };
  }
  return {
    r: Math.exp(-0.05 * cm),
    g: Math.exp(-0.06 * cm),
    b: Math.exp(-0.08 * cm)
  };
}

/**
 * Spectrally integrated dark-field circular-polariscope transfer.
 * q=0 is extinct; q=1 is the channel maximum after flat-field normalization.
 */
export function retardationToLinearRGB(rNm: number, tint: GlassTint = 'flint', thicknessMm = 4): RGB {
  const tintT = tintGains(tint, thicknessMm);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let nr = 0;
  let ng = 0;
  let nb = 0;

  for (const lambda of WAVELENGTHS) {
    const qe = cameraQE(lambda);
    const source = illuminant(lambda);
    // Channel-specific effective glass transmission. Keeping this as a scalar
    // per channel is equivalent to a narrow-band/white-balanced calibration and
    // makes flat-field correction independent of bottle brightness.
    const fringe = Math.sin((Math.PI * rNm) / lambda) ** 2;
    const wR = source * qe.r;
    const wG = source * qe.g;
    const wB = source * qe.b;
    sr += wR * fringe * tintT.r;
    sg += wG * fringe * tintT.g;
    sb += wB * fringe * tintT.b;
    nr += wR * tintT.r;
    ng += wG * tintT.g;
    nb += wB * tintT.b;
  }
  return {
    r: sr / Math.max(1e-6, nr),
    g: sg / Math.max(1e-6, ng),
    b: sb / Math.max(1e-6, nb)
  };
}

export const MAX_RETARDATION_NM = 650;
const LUT_STEP = 1;
export const COLOR_CURVE: RGB[] = [];
for (let r = 0; r <= MAX_RETARDATION_NM; r += LUT_STEP) {
  COLOR_CURVE.push(retardationToLinearRGB(r));
}

const GRID_BINS = 40;
const directLut = new Uint16Array(GRID_BINS ** 3);
let lutReady = false;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 0.999 ? 0.999 : x;
}

function gridIndex(r: number, g: number, b: number): number {
  const ri = Math.min(GRID_BINS - 1, Math.max(0, Math.round(clamp01(r) * (GRID_BINS - 1))));
  const gi = Math.min(GRID_BINS - 1, Math.max(0, Math.round(clamp01(g) * (GRID_BINS - 1))));
  const bi = Math.min(GRID_BINS - 1, Math.max(0, Math.round(clamp01(b) * (GRID_BINS - 1))));
  return (ri * GRID_BINS + gi) * GRID_BINS + bi;
}

export function buildColorLut(): void {
  if (lutReady) return;
  // Build a globally nearest coarse map. It is intentionally coarse;
  // decodeRetardation performs continuous local refinement and continuity
  // selection around the returned candidate.
  for (let ri = 0; ri < GRID_BINS; ri += 1) {
    for (let gi = 0; gi < GRID_BINS; gi += 1) {
      for (let bi = 0; bi < GRID_BINS; bi += 1) {
        const gr = ri / (GRID_BINS - 1);
        const gg = gi / (GRID_BINS - 1);
        const gb = bi / (GRID_BINS - 1);
        let bestDist = Infinity;
        let bestR = 0;
        for (let r = 0; r < COLOR_CURVE.length; r += 1) {
          const c = COLOR_CURVE[r];
          const d = 1.05 * (gr - c.r) ** 2 + 1.15 * (gg - c.g) ** 2 + 0.8 * (gb - c.b) ** 2;
          if (d < bestDist) {
            bestDist = d;
            bestR = r;
          }
        }
        directLut[(ri * GRID_BINS + gi) * GRID_BINS + bi] = bestR;
      }
    }
  }
  lutReady = true;
}

export interface DecodeOptions {
  /** Previously estimated retardation of a spatial neighbour, nm. */
  continuityHintNm?: number;
  /** Weight assigned to continuity when several color matches exist. */
  continuityWeight?: number;
}

function colorDistance(a: RGB, b: RGB): number {
  // Weight blue slightly less for amber/dark acquisitions; all channels remain.
  return (
    1.05 * (a.r - b.r) ** 2 +
    1.15 * (a.g - b.g) ** 2 +
    0.8 * (a.b - b.b) ** 2
  );
}

/** Decode flat-field-corrected linear RGB q (roughly 0..1 each). */
export function decodeRetardation(q: RGB, options: DecodeOptions = {}): number {
  buildColorLut();
  const coarse = directLut[gridIndex(q.r, q.g, q.b)];
  const hint = options.continuityHintNm;
  // Color squared distances are O(1e-3..1e-1); this weight only breaks
  // near-ties between periodic color matches, it must not lock a wrong branch.
  const cw = options.continuityWeight ?? 0.00000005;
  let bestR = coarse;
  let bestCost = Infinity;
  for (let r = Math.max(0, coarse - 12); r <= Math.min(MAX_RETARDATION_NM, coarse + 12); r += 1) {
    const cost = colorDistance(q, COLOR_CURVE[r]) +
      (hint === undefined ? 0 : cw * (r - hint) ** 2);
    if (cost < bestCost) {
      bestCost = cost;
      bestR = r;
    }
  }
  // Sub-nanometre parabolic interpolation around the integer winner.
  const rm = Math.max(0, bestR - 1);
  const rp = Math.min(MAX_RETARDATION_NM, bestR + 1);
  const dm = colorDistance(q, COLOR_CURVE[rm]);
  const d0 = colorDistance(q, COLOR_CURVE[bestR]);
  const dp = colorDistance(q, COLOR_CURVE[rp]);
  const denom = dm + dp - 2 * d0;
  let shift = 0;
  if (denom > 1e-12) shift = Math.max(-0.75, Math.min(0.75, 0.5 * (dm - dp) / denom));
  return Math.max(0, Math.min(MAX_RETARDATION_NM, bestR + shift));
}

export function srgbToLinear(v: number): number {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgbByte(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function applyCalibrationToPixel(
  rgba: Uint8ClampedArray,
  index: number,
  cal: CalibrationConfig,
  flat: [number, number, number] = [1, 1, 1]
): RGB {
  const r = (srgbToLinear(rgba[index]) - cal.darkLevel[0] / 255) * cal.channelGain[0] / flat[0];
  const g = (srgbToLinear(rgba[index + 1]) - cal.darkLevel[1] / 255) * cal.channelGain[1] / flat[1];
  const b = (srgbToLinear(rgba[index + 2]) - cal.darkLevel[2] / 255) * cal.channelGain[2] / flat[2];
  // Camera frames are gamma encoded; after linearization the polariscope
  // transfer is already normalized. A small scale keeps ordinary exposures q~1.
  return {
    r: Math.max(0, Math.min(1.25, r * 1.18)),
    g: Math.max(0, Math.min(1.25, g * 1.18)),
    b: Math.max(0, Math.min(1.25, b * 1.18))
  };
}
