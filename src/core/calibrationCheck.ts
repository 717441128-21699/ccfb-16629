import { defaultCalibration } from './calibration';
import { decodeRetardation } from './colorLut';
import { correctPixelToQ } from './segmentation';
import { generateRetardationWedge } from './synthetic';
import { percentile } from './mathUtils';
import type { CalibrationConfig, GlassTint } from './types';

export interface WedgeCheckReport {
  tint: GlassTint;
  samples: number;
  maeNm: number;
  rmseNm: number;
  p95Nm: number;
  maxAbsNm: number;
  biasNm: number;
  pass10Nm: boolean;
}

export function checkWedge(tint: GlassTint, cal: CalibrationConfig = defaultCalibration(tint)): WedgeCheckReport {
  const wedge = generateRetardationWedge(320, 640, 120, tint, 0.8, 9000 + tint.length);
  const errors: number[] = [];
  let signedSum = 0;
  let hint: number | undefined;
  const y0 = Math.floor(wedge.height * 0.35);
  const y1 = Math.floor(wedge.height * 0.65);
  for (let x = 4; x < wedge.width - 4; x += 1) {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let k = 0;
    for (let y = y0; y < y1; y += 1) {
      const q = correctPixelToQ(wedge, y * wedge.width + x, cal, 4);
      rSum += q.r;
      gSum += q.g;
      bSum += q.b;
      k += 1;
    }
    const estimated = decodeRetardation(
      { r: rSum / k, g: gSum / k, b: bSum / k },
      { continuityHintNm: hint, continuityWeight: 0.00000005 }
    );
    hint = estimated;
    const e = estimated - wedge.expectedNm[x];
    signedSum += e;
    errors.push(Math.abs(e));
  }
  const squared = errors.map((e) => e * e);
  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const rmse = Math.sqrt(squared.reduce((a, b) => a + b, 0) / squared.length);
  const sorted = [...errors].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const maxAbs = sorted[sorted.length - 1];
  return {
    tint,
    samples: errors.length,
    maeNm: mae,
    rmseNm: rmse,
    p95Nm: p95,
    maxAbsNm: maxAbs,
    biasNm: signedSum / errors.length,
    pass10Nm: maxAbs <= 10
  };
}
