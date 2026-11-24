import type { BatchRecord, DefectKind, LehrStat, MoldStat } from './types';

export function computeMoldStats(records: BatchRecord[]): MoldStat[] {
  const byMold = new Map<string, BatchRecord[]>();
  for (const r of records) {
    const arr = byMold.get(r.moldId) ?? [];
    arr.push(r);
    byMold.set(r.moldId, arr);
  }
  return [...byMold.entries()].map(([moldId, rows]) => {
    const rejected = rows.filter((r) => !r.accepted).length;
    const gradeSum = rows.reduce((a, r) => a + r.overallGrade, 0);
    const stressSum = rows.reduce((a, r) => a + r.maxStressMPa, 0);
    const maxGrade = rows.reduce((m, r) => Math.max(m, r.overallGrade), 0);
    const defectCounts = new Map<DefectKind, number>();
    let seamSignatures = 0;
    for (const r of rows) {
      defectCounts.set(r.defectKind, (defectCounts.get(r.defectKind) ?? 0) + 1);
      if (r.defectKind === 'mold-seam' || r.defectKind === 'heel-ring' || r.defectKind === 'bottom-center') {
        seamSignatures += 1;
      }
    }
    let dominantDefect: DefectKind = 'healthy';
    let dominantCount = -1;
    for (const [kind, count] of defectCounts) {
      if (kind !== 'healthy' && count > dominantCount) {
        dominantCount = count;
        dominantDefect = kind;
      }
    }
    return {
      moldId,
      count: rows.length,
      rejected,
      rejectRate: rejected / rows.length,
      avgGrade: gradeSum / rows.length,
      maxGrade,
      avgStressMPa: stressSum / rows.length,
      dominantDefect,
      seamOrMoldSignature: seamSignatures / rows.length
    };
  }).sort((a, b) => b.rejectRate - a.rejectRate || b.avgStressMPa - a.avgStressMPa);
}

export function computeLehrStats(records: BatchRecord[]): LehrStat[] {
  const key = (z: string, side: string) => `${z}__${side}`;
  const map = new Map<string, BatchRecord[]>();
  for (const r of records) {
    const k = key(r.lehrZone, r.lehrSide);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.entries()].map(([k, rows]) => {
    const [lehrZone, side] = k.split('__') as [string, LehrStat['side']];
    const rejected = rows.filter((r) => !r.accepted).length;
    return {
      lehrZone,
      side,
      count: rows.length,
      rejected,
      rejectRate: rejected / rows.length,
      avgStressMPa: rows.reduce((a, r) => a + r.maxStressMPa, 0) / rows.length
    };
  }).sort((a, b) => b.rejectRate - a.rejectRate);
}

export interface Diagnosis {
  type: 'mold' | 'lehr' | 'mixed' | 'stable';
  confidence: number;
  title: string;
  actions: string[];
}

export function diagnoseBatch(records: BatchRecord[], molds: MoldStat[], lehr: LehrStat[]): Diagnosis {
  if (records.length === 0) {
    return { type: 'stable', confidence: 0, title: '暂无批次数据', actions: ['先分析或合成一个批次。'] };
  }
  const totalReject = records.filter((r) => !r.accepted).length / records.length;
  const worstMold = molds[0];
  const moldConcentration = worstMold && worstMold.count >= 5
    ? worstMold.rejectRate - totalReject
    : 0;
  const worstLehr = lehr[0];
  const lehrConcentration = worstLehr && worstLehr.count >= 5
    ? worstLehr.rejectRate - totalReject
    : 0;

  const moldScore = Math.max(0, moldConcentration) + (worstMold?.seamOrMoldSignature ?? 0) * 0.25;
  const lehrScore = Math.max(0, lehrConcentration) * 1.2;

  if (totalReject < 0.03) {
    return {
      type: 'stable',
      confidence: 0.9,
      title: '退火状态稳定',
      actions: ['保持当前退火曲线、喷涂和模具冷却周期；继续按模具号追溯。']
    };
  }
  if (moldScore > lehrScore + 0.08 && worstMold) {
    const actions: string[] = [];
    if (worstMold.dominantDefect === 'mold-seam') actions.push('检查合模面磨损、飞边和模具对位，必要时抛光或更换模腔。');
    if (worstMold.dominantDefect === 'heel-ring') actions.push('检查底模/跟部冷却风嘴、模具积碳和开合模时间。');
    if (worstMold.dominantDefect === 'bottom-center') actions.push('检查底模冲头、底厚分布和底部冷却是否偏心。');
    actions.push(`对模具 ${worstMold.moldId} 的相邻模腔加严抽检，并核对模具寿命/喷涂记录。`);
    return { type: 'mold', confidence: Math.min(0.96, 0.62 + moldScore), title: `主要指向模具 ${worstMold.moldId}`, actions };
  }
  if (lehrScore > moldScore + 0.05 && worstLehr) {
    return {
      type: 'lehr',
      confidence: Math.min(0.95, 0.6 + lehrScore),
      title: `主要指向退火炉 ${worstLehr.lehrZone} / ${worstLehr.side} 侧`,
      actions: [
        '核对该温区热电偶、加热丝和风门，比较左中右横向温差。',
        '检查网带速度、瓶子排列密度和冷却风嘴是否堵塞。',
        '若所有模具在同一炉区/侧别同时升高，优先调整退火曲线而不是拆模具。'
      ]
    };
  }
  return {
    type: 'mixed',
    confidence: 0.68,
    title: '模具与退火炉因素叠加',
    actions: [
      '先按炉区/侧别分层，再在同一炉位内比较模具号，避免两个因素混杂。',
      '对高风险模具安排隔离抽检，同时校准退火窑 C 区和缓冷区横向温差。'
    ]
  };
}

export function toCsv(records: BatchRecord[]): string {
  const header = [
    'id', 'analyzedAt', 'moldId', 'cavity', 'model', 'tint', 'lehrZone', 'lehrSide',
    'defectKind', 'overallGrade', 'accepted', 'bottomGrade', 'mouthGrade',
    'maxRetardationNm', 'maxStressMPa'
  ];
  const rows = records.map((r) => header.map((h) => {
    const v = r[h as keyof BatchRecord];
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '');
  }).join(','));
  return [header.join(','), ...rows].join('\n');
}
