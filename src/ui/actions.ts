import type { BatchCaseSpec } from '../core/batch';
import { store } from './store';

export async function runSyntheticSpec(spec: BatchCaseSpec): Promise<void> {
  store.toast(`Worker 正在分析 ${spec.id}…`, 'ok');
  const res = await store.client.analyzeSynthetic(spec, store.calibration);
  store.setCurrent({
    specId: spec.id,
    synth: res.synth,
    analysis: res.analysis,
    source: 'synthetic'
  });
  store.toast(`${spec.id} 完成：${res.analysis.accepted ? '合格' : '超标'}，用时 ${res.analysis.durationMs.toFixed(1)} ms`, res.analysis.accepted ? 'ok' : 'err');
}

export async function runQuickDemo(): Promise<void> {
  const spec: BatchCaseSpec = {
    seed: 8848,
    id: 'DEMO-BOTTOM-01',
    moldId: 'M-03',
    cavity: 2,
    model: 'beer500',
    tint: 'amber',
    defectKind: 'bottom-center',
    severity: 1.28,
    lehrZone: 'C-缓冷',
    lehrSide: 'R',
    analyzedAt: new Date().toISOString()
  };
  store.setRoute('bottle');
  try {
    await runSyntheticSpec(spec);
  } catch (err) {
    store.toast(err instanceof Error ? err.message : String(err), 'err');
  }
}
