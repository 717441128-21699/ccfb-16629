import type { StandardProfile, StandardProfileId } from './types';

/**
 * Retardation-to-grade tables.
 *
 * ASTM C148 polariscopic examination reports an Apparent Temper Number. The
 * Senarmont conversion used here is R = theta * lambda / 180 (lambda ~= 546 nm,
 * about 3.03 nm/degree); the published 7.26 degree band therefore corresponds
 * to roughly 22 nm per temper-number band.
 *
 * Standards such as ASTM C148 and GB/T 4545 are test methods. Universal
 * pass/fail numbers depend on bottle geometry, filling pressure and customer
 * specification, so the acceptance grades below are transparent plant defaults
 * and can be replaced by the controlled document used by the factory.
 */
export const STANDARDS: Record<StandardProfileId, StandardProfile> = {
  'astm-c148': {
    id: 'astm-c148',
    name: 'ASTM C148 / Apparent Temper No.',
    gradeUpperNm: [22, 44, 66, 88, 110, 132, 154, 176, 198, 220],
    acceptMaxGrade: 4,
    criticalAcceptMaxGrade: 3,
    criticalZones: ['bottom-center', 'mouth'],
    sourceNote:
      'Grade bands use 7.26° Senarmont intervals at 546 nm. ASTM C148 defines examination methods, not a universal purchase acceptance limit.'
  },
  'gbt4545-container': {
    id: 'gbt4545-container',
    name: 'GB/T 4545 容器玻璃应力分级（工厂默认表）',
    gradeUpperNm: [24, 48, 80, 120, 180, 260],
    acceptMaxGrade: 3,
    criticalAcceptMaxGrade: 2,
    criticalZones: ['bottom-center', 'mouth'],
    sourceNote:
      '按偏光比色/补偿法常用的六级应力谱建立；正式仲裁以 GB/T 4545 原文和客户标准规定的瓶型限值为准。'
  },
  'strict-plant': {
    id: 'strict-plant',
    name: '高速灌装线加严内控',
    gradeUpperNm: [18, 36, 60, 90, 135, 200],
    acceptMaxGrade: 2,
    criticalAcceptMaxGrade: 2,
    criticalZones: ['bottom-center', 'mouth'],
    sourceNote: '适用于轻量瓶、碳酸/啤酒瓶和高风险灌装线的内控阈值。'
  }
};

export function gradeForRetardation(rNm: number, profile: StandardProfile): number {
  const r = Math.max(0, rNm);
  for (let i = 0; i < profile.gradeUpperNm.length; i += 1) {
    if (r <= profile.gradeUpperNm[i]) return i + 1;
  }
  return profile.gradeUpperNm.length + 1;
}

export function gradeLabel(grade: number): string {
  if (grade <= 1) return '1 级 · 极轻微';
  if (grade === 2) return '2 级 · 正常退火';
  if (grade === 3) return '3 级 · 可接受上限';
  if (grade === 4) return '4 级 · 应力偏高';
  if (grade === 5) return '5 级 · 缺陷风险';
  if (grade === 6) return '6 级 · 严重';
  return `${grade} 级 · 超量程`;
}
