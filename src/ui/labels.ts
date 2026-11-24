import type { DefectKind } from '../core/types';

export const DEFECT_LABELS: Record<DefectKind, string> = {
  healthy: '正常退火',
  'bottom-center': '瓶底中心张应力/四叶草',
  'heel-ring': '瓶跟环形应力',
  mouth: '瓶口/螺纹应力',
  'body-panel': '瓶身板面局部应力',
  'mold-seam': '合模缝应力',
  'lehr-gradient': '退火炉横向温差梯度',
  mixed: '瓶底+瓶口复合缺陷'
};

export const TINT_LABELS = {
  flint: '普白料',
  amber: '琥珀/茶色',
  green: '青绿料'
} as const;
