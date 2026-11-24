import { generateBatchCases } from '../../core/batch';
import { toCsv } from '../../core/stats';
import type { BatchRecord } from '../../core/types';
import { downloadText, h } from '../dom';
import { drawLehrHeatmap, drawMoldBarChart } from '../canvas';
import { DEFECT_LABELS } from '../labels';
import { store } from '../store';

export function renderMoldsPage(root: HTMLElement): () => void {
  const progressWrap = h('div', { style: 'display:none' },
    h('div', { class: 'flex-between small muted mb-8' }, h('span', { id: 'progressLabel' }, 'Worker 正在分析批次…'), h('span', { id: 'progressPct' }, '0%')),
    h('div', { class: 'progress' }, h('i', { id: 'progressBar', style: 'width:0%' }))
  ) as HTMLDivElement;
  // Add margin via class rather than mb-8 (not defined).
  progressWrap.querySelector('.flex-between')?.classList.add('mt-12');

  const actionBtn = h('button', { class: 'btn primary' }, store.batch.length ? '重新生成并分析 168 只' : '生成并分析 168 只') as HTMLButtonElement;
  const exportBtn = h('button', { class: 'btn' }, '导出 CSV') as HTMLButtonElement;
  exportBtn.disabled = store.batch.length === 0;
  exportBtn.addEventListener('click', () => downloadText(`stress-batch-${Date.now()}.csv`, '﻿' + toCsv(store.batch), 'text/csv;charset=utf-8'));

  actionBtn.addEventListener('click', async () => {
    actionBtn.disabled = true;
    progressWrap.style.display = 'block';
    try {
      const cases = generateBatchCases(168);
      const records = await store.client.runBatch(cases, store.calibration, (done, total) => {
        const pct = Math.round((done / total) * 100);
        progressWrap.querySelector('#progressBar')!.setAttribute('style', `width:${pct}%`);
        progressWrap.querySelector('#progressPct')!.textContent = `${pct}% (${done}/${total})`;
      });
      store.setBatch(records);
      store.toast(`批次分析完成：${records.length} 只，拒检 ${records.filter((r) => !r.accepted).length} 只`);
      renderData();
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      actionBtn.disabled = false;
      progressWrap.style.display = 'none';
    }
  });

  const kpiSlot = h('div', { class: 'stat-grid' });
  const diagnosisSlot = h('div');
  const moldCanvas = h('canvas', { class: 'chart-canvas' }) as HTMLCanvasElement;
  const lehrCanvas = h('canvas', { class: 'chart-canvas' }) as HTMLCanvasElement;
  const moldTableSlot = h('div', { class: 'table-wrap' });
  const recordTableSlot = h('div', { class: 'table-wrap mt-18' });

  root.replaceChildren(
    h('section', { class: 'card' },
      h('h2', {}, '模具号 / 退火炉批次追溯'),
      h('p', { class: 'muted' }, '合成批次故意加入 M-03 合模缝、M-07 底模中心缺陷，以及 C-缓冷段右侧的横向炉温异常，用于验证归因逻辑。'),
      h('div', { class: 'btn-row' }, actionBtn, exportBtn),
      progressWrap
    ),
    kpiSlot,
    diagnosisSlot,
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card' }, h('h2', {}, '各模具拒检率'), moldCanvas),
      h('section', { class: 'card' }, h('h2', {}, '退火炉区 × 横向位置热力图'), lehrCanvas)
    ),
    h('section', { class: 'card' }, h('h2', {}, '模具统计与缺陷签名'), moldTableSlot),
    h('section', { class: 'card' }, h('h2', {}, '瓶子明细（最近/最差记录）'), recordTableSlot)
  );

  let filterMold: string | null = null;
  renderData();
  const unsub = store.subscribe(() => {
    exportBtn.disabled = store.batch.length === 0;
  });

  function renderData() {
    const records = store.batch;
    if (!records.length) {
      kpiSlot.replaceChildren(emptyKpi());
      diagnosisSlot.replaceChildren(h('div', { class: 'skeleton' }, '尚未生成批次。点击上方按钮，Worker 会按 4 种瓶型、3 种料色和 8 类退火缺陷合成并分析 168 只瓶子。'));
      moldTableSlot.replaceChildren();
      recordTableSlot.replaceChildren();
      const ctx = moldCanvas.getContext('2d'); ctx?.clearRect(0, 0, moldCanvas.width, moldCanvas.height);
      const ctx2 = lehrCanvas.getContext('2d'); ctx2?.clearRect(0, 0, lehrCanvas.width, lehrCanvas.height);
      return;
    }
    const rejected = records.filter((r) => !r.accepted).length;
    const avgGrade = records.reduce((a, r) => a + r.overallGrade, 0) / records.length;
    const avgStress = records.reduce((a, r) => a + r.maxStressMPa, 0) / records.length;
    kpiSlot.replaceChildren(
      kpi('批次数量', String(records.length), 'info'),
      kpi('拒检率', `${(100 * rejected / records.length).toFixed(1)}%`, rejected / records.length > 0.08 ? 'bad' : 'good'),
      kpi('平均级别', avgGrade.toFixed(2), avgGrade > 3.5 ? 'warn' : 'good'),
      kpi('平均峰值应力', `${avgStress.toFixed(1)} MPa`, 'warn'),
      kpi('追溯模具', String(store.moldStats.length), 'info')
    );

    const d = store.diagnosis!;
    diagnosisSlot.replaceChildren(h('section', { class: `verdict ${d.type === 'stable' ? 'pass' : 'fail'}` },
      h('div', {}, h('h2', {}, d.title), h('p', {}, `置信度 ${(d.confidence * 100).toFixed(0)}%`),
        h('ul', { class: 'mark-list mt-12' }, ...d.actions.map((a) => h('li', {}, h('span', { class: 'dot watch' }), h('div', {}, a))))
      )
    ));

    requestAnimationFrame(() => {
      drawMoldBarChart(moldCanvas, store.moldStats);
      drawLehrHeatmap(lehrCanvas, store.lehrStats);
    });

    moldTableSlot.replaceChildren(renderMoldTable((id) => { filterMold = filterMold === id ? null : id; renderRecords(); }, filterMold));
    renderRecords();
  }

  function renderRecords() {
    const rows = [...store.batch]
      .filter((r) => !filterMold || r.moldId === filterMold)
      .sort((a, b) => Number(!a.accepted) - Number(!b.accepted) || b.overallGrade - a.overallGrade)
      .slice(0, 80);
    recordTableSlot.replaceChildren(
      h('div', { class: 'flex-between', style: 'padding:10px' },
        h('strong', {}, filterMold ? `${filterMold} 明细` : '按风险排序的前 80 条'),
        filterMold ? h('button', { class: 'btn', onclick: () => { filterMold = null; renderData(); } }, '清除模具筛选') : h('span', { class: 'muted small' }, '点击模具行可筛选')
      ),
      renderRecordTable(rows)
    );
  }

  return () => unsub();
}

function renderMoldTable(onSelect: (id: string) => void, filterMold: string | null) {
  return h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, '模具号'), h('th', { class: 'num' }, '数量'), h('th', { class: 'num' }, '拒检'),
      h('th', { class: 'num' }, '拒检率'), h('th', { class: 'num' }, '平均级'), h('th', { class: 'num' }, '最大级'),
      h('th', {}, '主要缺陷'), h('th', { class: 'num' }, '模具签名')
    )),
    h('tbody', {}, ...store.moldStats.map((m) => h('tr', {
      style: filterMold === m.moldId ? 'background:rgba(56,189,248,.12)' : '',
      onclick: () => onSelect(m.moldId)
    },
      h('td', {}, h('strong', {}, m.moldId)),
      h('td', { class: 'num' }, String(m.count)),
      h('td', { class: 'num' }, String(m.rejected)),
      h('td', { class: 'num' }, h('span', { class: `chip ${m.rejectRate > 0.12 ? 'bad' : m.rejectRate > 0.05 ? 'warn' : 'good'}` }, `${(m.rejectRate * 100).toFixed(1)}%`)),
      h('td', { class: 'num' }, m.avgGrade.toFixed(2)),
      h('td', { class: 'num' }, String(m.maxGrade)),
      h('td', {}, DEFECT_LABELS[m.dominantDefect] ?? '—'),
      h('td', { class: 'num' }, `${(m.seamOrMoldSignature * 100).toFixed(0)}%`)
    )))
  );
}

function renderRecordTable(rows: BatchRecord[]) {
  return h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, '编号'), h('th', {}, '时间'), h('th', {}, '模具/腔'), h('th', {}, '炉区/侧'),
      h('th', {}, '缺陷'), h('th', { class: 'num' }, '瓶口级'), h('th', { class: 'num' }, '底心级'),
      h('th', { class: 'num' }, 'Δ nm'), h('th', { class: 'num' }, 'σ MPa'), h('th', {}, '判定')
    )),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', {}, r.id),
      h('td', { class: 'small muted' }, r.analyzedAt.replace('T', ' ').slice(5, 16)),
      h('td', {}, `${r.moldId}/${r.cavity}`),
      h('td', {}, `${r.lehrZone}/${r.lehrSide}`),
      h('td', { class: 'small' }, DEFECT_LABELS[r.defectKind]),
      h('td', { class: 'num' }, String(r.mouthGrade)),
      h('td', { class: 'num' }, String(r.bottomGrade)),
      h('td', { class: 'num' }, r.maxRetardationNm.toFixed(0)),
      h('td', { class: 'num' }, r.maxStressMPa.toFixed(1)),
      h('td', {}, h('span', { class: `chip ${r.accepted ? 'good' : 'bad'}` }, r.accepted ? '合格' : '超标'))
    )))
  );
}

function kpi(label: string, value: string, tone: 'good' | 'warn' | 'bad' | 'info') {
  return h('div', { class: `kpi ${tone}` }, h('span', {}, label), h('b', {}, value));
}
function emptyKpi() {
  return h('div', { class: 'skeleton', style: 'grid-column:1/-1' }, '暂无统计');
}
