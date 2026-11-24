import { mulberry32 } from './mathUtils';
import type { BatchRecord, BottleModel, DefectKind, GlassTint, ZoneStat } from './types';

export interface BatchCaseSpec {
  seed: number;
  id: string;
  moldId: string;
  cavity: number;
  model: BottleModel;
  tint: GlassTint;
  defectKind: DefectKind;
  severity: number;
  lehrZone: string;
  lehrSide: 'L' | 'C' | 'R';
  analyzedAt: string;
}

const MODELS: BottleModel[] = ['beer500', 'wine750', 'sauce350', 'vial100'];
const TINTS: GlassTint[] = ['flint', 'flint', 'amber', 'green'];
const ZONES = ['A-均热', 'B-退火', 'C-缓冷', 'D-快冷'];

/**
 * Deterministic production-like batch. M-03/M-07 carry mould signatures, while
 * C-缓冷/R has a lehr transverse-temperature signature across all moulds.
 */
export function generateBatchCases(count = 168, seedBase = 20261125): BatchCaseSpec[] {
  const rng = mulberry32(seedBase);
  const cases: BatchCaseSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const moldNumber = 1 + Math.floor(rng() * 8);
    const moldId = `M-${String(moldNumber).padStart(2, '0')}`;
    const cavity = 1 + Math.floor(rng() * 4);
    const lehrZone = ZONES[Math.floor(rng() * ZONES.length)];
    const side = (['L', 'C', 'R'] as const)[Math.floor(rng() * 3)];
    let defectKind: DefectKind = 'healthy';
    let severity = 0.45 + rng() * 0.38;

    const lehrHotSide = lehrZone === 'C-缓冷' && side === 'R';
    const moldBad = moldNumber === 3 || moldNumber === 7;

    if (lehrHotSide && rng() < 0.58) {
      defectKind = 'lehr-gradient';
      severity = 0.85 + rng() * 0.62;
    } else if (moldBad && rng() < 0.42) {
      defectKind = moldNumber === 3 ? 'mold-seam' : 'bottom-center';
      severity = 0.88 + rng() * 0.68;
    } else if (rng() < 0.16) {
      defectKind = (['bottom-center', 'heel-ring', 'mouth', 'body-panel', 'mixed'] as DefectKind[])[Math.floor(rng() * 5)];
      severity = 0.72 + rng() * 0.7;
    }

    const minutes = 8 * 60 + Math.floor((i / count) * 480);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    cases.push({
      seed: seedBase + i * 131,
      id: `B-${String(i + 1).padStart(5, '0')}`,
      moldId,
      cavity,
      model: MODELS[Math.floor(rng() * MODELS.length)],
      tint: TINTS[Math.floor(rng() * TINTS.length)],
      defectKind,
      severity,
      lehrZone,
      lehrSide: side,
      analyzedAt: `2026-11-25T${hh}:${mm}:00`
    });
  }
  return cases;
}

export function recordFromAnalysis(
  spec: BatchCaseSpec,
  result: {
    overallGrade: number;
    accepted: boolean;
    zones: ZoneStat[];
  }
): BatchRecord {
  const mouth = result.zones.find((z) => z.id === 'mouth');
  const bottom = result.zones.find((z) => z.id === 'bottom-center');
  const worst = result.zones.reduce((a, z) => z.maxRetardationNm > a.maxRetardationNm ? z : a, result.zones[0]);
  return {
    id: spec.id,
    moldId: spec.moldId,
    cavity: spec.cavity,
    bottleModel: spec.model,
    tint: spec.tint,
    lehrZone: spec.lehrZone,
    lehrSide: spec.lehrSide,
    defectKind: spec.defectKind,
    overallGrade: result.overallGrade,
    accepted: result.accepted,
    bottomGrade: bottom?.grade ?? 1,
    mouthGrade: mouth?.grade ?? 1,
    maxStressMPa: worst?.maxStressMPa ?? 0,
    maxRetardationNm: worst?.maxRetardationNm ?? 0,
    analyzedAt: spec.analyzedAt
  };
}
