import { tintGains } from './colorLut';
import type { CalibrationConfig, GlassTint } from './types';

const SYNTHETIC_EXPOSURE = 0.82;

export function defaultCalibration(tint: GlassTint = 'flint'): CalibrationConfig {
  // White balance compensates known container-glass channel attenuation at the
  // nominal 4 mm calibration strip. A measured flat field can refine this.
  const t = tintGains(tint, 4);
  return {
    id: `CAL-${tint.toUpperCase()}-001`,
    calibratedAt: new Date('2026-11-25T08:00:00').toISOString(),
    mmPerPixel: 0.31,
    stressOpticalCoefficientPa: 3.2e-12,
    analyzerWavelengthNm: 546,
    polarizerAngleDeg: 90,
    darkLevel: [4, 4, 6],
    channelGain: [
      1 / (SYNTHETIC_EXPOSURE * t.r),
      1 / (SYNTHETIC_EXPOSURE * t.g),
      1 / (SYNTHETIC_EXPOSURE * t.b)
    ].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    zeroStressOffset: [0.049, 0.049, 0.049],
    glassTint: tint,
    nominalThicknessMm: 4.5,
    standardProfile: 'gbt4545-container',
    operator: 'line-operator'
  };
}

export function senarmontAngleDegrees(retardationNm: number, wavelengthNm = 546): number {
  return (retardationNm * 180) / wavelengthNm;
}

export function retardationFromSenarmont(angleDeg: number, wavelengthNm = 546): number {
  return (angleDeg * wavelengthNm) / 180;
}
