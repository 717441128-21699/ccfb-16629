export type GlassTint = 'flint' | 'amber' | 'green';

export type BottleModel =
  | 'beer500'
  | 'wine750'
  | 'sauce350'
  | 'vial100';

export type DefectKind =
  | 'healthy'
  | 'bottom-center'
  | 'heel-ring'
  | 'mouth'
  | 'body-panel'
  | 'mold-seam'
  | 'lehr-gradient'
  | 'mixed';

export type RegionId = 0 | 1 | 2 | 3;
// 0 background, 1 body, 2 bottom, 3 mouth/finish

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

export interface CalibrationConfig {
  id: string;
  calibratedAt: string;
  mmPerPixel: number;
  stressOpticalCoefficientPa: number; // Brewster coefficient C, Pa^-1
  analyzerWavelengthNm: number;
  polarizerAngleDeg: number;
  darkLevel: [number, number, number];
  channelGain: [number, number, number];
  /** Residual leakage / zero-stress glass baseline in flat-field q units. */
  zeroStressOffset: [number, number, number];
  glassTint: GlassTint;
  /** Nominal thickness in mm used only when no thickness map is supplied. */
  nominalThicknessMm: number;
  standardProfile: StandardProfileId;
  operator: string;
}

export type StandardProfileId = 'astm-c148' | 'gbt4545-container' | 'strict-plant';

export interface StandardProfile {
  id: StandardProfileId;
  name: string;
  /** Retardation thresholds in nm for grades 1..N. Grade 1 is lowest stress. */
  gradeUpperNm: number[];
  /** Maximum accepted grade for the whole bottle. */
  acceptMaxGrade: number;
  /** Critical zones use this stricter maximum grade. */
  criticalAcceptMaxGrade: number;
  criticalZones: Array<'bottom-center' | 'mouth'>;
  sourceNote: string;
}

export interface ZoneStat {
  id: string;
  name: string;
  region: 'bottom' | 'body' | 'mouth' | 'critical';
  pixelCount: number;
  areaMm2: number;
  thicknessMm: number;
  maxRetardationNm: number;
  /** Mean of the brightest 0.5% pixels; visually matched by an inspector. */
  peakRetardationNm: number;
  p95RetardationNm: number;
  meanRetardationNm: number;
  maxStressMPa: number;
  peakStressMPa: number;
  p95StressMPa: number;
  grade: number;
  accepted: boolean;
  worstPoint: { x: number; y: number };
}

export interface DefectMark {
  x: number;
  y: number;
  radius: number;
  zone: string;
  severity: 'watch' | 'reject';
  retardationNm: number;
  stressMPa: number;
  grade: number;
  message: string;
}

export interface BottleAnalysis {
  id: string;
  moldId: string;
  cavity: number;
  bottleModel: BottleModel;
  tint: GlassTint;
  defectKind?: DefectKind;
  lehrZone?: string;
  lehrSide?: 'L' | 'C' | 'R';
  width: number;
  height: number;
  durationMs: number;
  mask: Uint8Array;
  measureMask: Uint8Array;
  regions: Uint8Array;
  thicknessMm: Float32Array;
  retardationNm: Float32Array;
  stressMPa: Float32Array;
  confidence: Float32Array;
  stressHeatmap: Raster | null;
  overlay: Raster | null;
  zones: ZoneStat[];
  marks: DefectMark[];
  overallGrade: number;
  accepted: boolean;
  worstZone: string;
  manualGrade?: number;
  manualAccepted?: boolean;
  truth?: GroundTruth;
}

export interface GroundTruth {
  retardationNm: Float32Array;
  stressMPa: Float32Array;
  regions: Uint8Array;
  thicknessMm: Float32Array;
  worstRetardationNm: number;
  worstGrade: number;
  accepted: boolean;
  manualGrade: number;
  manualAccepted: boolean;
}

export interface SyntheticBottle {
  image: Raster;
  truth: GroundTruth;
  width: number;
  height: number;
  meta: {
    id: string;
    moldId: string;
    cavity: number;
    bottleModel: BottleModel;
    tint: GlassTint;
    defectKind: DefectKind;
    lehrZone: string;
    lehrSide: 'L' | 'C' | 'R';
    thicknessMm: number;
  };
}

export interface BatchRecord {
  id: string;
  moldId: string;
  cavity: number;
  bottleModel: BottleModel;
  tint: GlassTint;
  lehrZone: string;
  lehrSide: 'L' | 'C' | 'R';
  defectKind: DefectKind;
  overallGrade: number;
  accepted: boolean;
  bottomGrade: number;
  mouthGrade: number;
  maxStressMPa: number;
  maxRetardationNm: number;
  analyzedAt: string;
}

export interface MoldStat {
  moldId: string;
  count: number;
  rejected: number;
  rejectRate: number;
  avgGrade: number;
  maxGrade: number;
  avgStressMPa: number;
  dominantDefect: DefectKind;
  seamOrMoldSignature: number;
}

export interface LehrStat {
  lehrZone: string;
  side: 'L' | 'C' | 'R';
  count: number;
  rejected: number;
  rejectRate: number;
  avgStressMPa: number;
}
