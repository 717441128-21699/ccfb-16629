import { BOTTLE_PROFILES } from '../../core/bottleGeometry';
import { STANDARDS, gradeLabel } from '../../core/standards';
import type { BottleAnalysis } from '../../core/types';
import { downloadText, h } from '../dom';
import { paintAnalysisHeatmap, paintMarks, paintRegionMap, paintRaster } from '../canvas';
import { TINT_LABELS } from '../labels';
import { runQuickDemo } from '../actions';
import { store } from '../store';

export function renderReportPage(root: HTMLElement): () => void {
  const slot = h('div');
  root.replaceChildren(
    h('div', { class: 'btn-row no-print' },
      h('button', { class: 'btn primary', onclick: () => window.print() }, '打印 / 另存 PDF'),
      h('button', { class: 'btn', id: 'jsonBtn' }, '导出 JSON 结论'),
      h('button', { class: 'btn ghost', onclick: () => store.setRoute('bottle') }, '返回单瓶页'),
      h('button', { class: 'btn ghost', onclick: () => void runQuickDemo() }, '载入示例瓶')
    ),
    slot
  );

  function render() {
    const current = store.current;
    const jsonBtn = root.querySelector('#jsonBtn') as HTMLButtonElement | null;
    if (jsonBtn) jsonBtn.onclick = () => {
      if (!current) return;
      const payload = {
        reportId: `RPT-${current.analysis.id}`,
        calibration: store.calibration,
        bottle: {
          id: current.analysis.id,
          moldId: current.analysis.moldId,
          cavity: current.analysis.cavity,
          model: current.analysis.bottleModel,
          tint: current.analysis.tint,
          accepted: current.analysis.accepted,
          overallGrade: current.analysis.overallGrade,
          worstZone: current.analysis.worstZone
        },
        zones: current.analysis.zones,
        marks: current.analysis.marks,
        batchSummary: store.batch.length ? {
          count: store.batch.length,
          rejected: store.batch.filter((b) => !b.accepted).length,
          topMolds: store.moldStats.slice(0, 5),
          diagnosis: store.diagnosis
        } : undefined
      };
      downloadText(`${payload.reportId}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    };

    if (!current) {
      slot.replaceChildren(h('div', { class: 'card skeleton' }, '还没有可出报告的瓶子。点击“载入示例瓶”，或先到单瓶应力页分析。'));
      return;
    }
    slot.replaceChildren(renderSheet(current.analysis, current.synth?.image ?? current.image ?? null, current.source));
  }

  const unsub = store.subscribe(render);
  render();
  return () => unsub();
}

function renderSheet(a: BottleAnalysis, raster: Parameters<typeof paintRaster>[1] | null, source: 'synthetic' | 'upload') {
  const standard = STANDARDS[store.calibration.standardProfile];
  const sourceCanvas = h('canvas', { width: a.width, height: a.height });
  const regionCanvas = h('canvas', { width: a.width, height: a.height });
  const heatCanvas = h('canvas', { width: a.width, height: a.height });
  if (raster) {
    paintRaster(sourceCanvas, raster);
    paintMarks(sourceCanvas, a);
  }
  paintRegionMap(regionCanvas, a);
  paintMarks(regionCanvas, a);
  paintAnalysisHeatmap(heatCanvas, a);
  paintMarks(heatCanvas, a);

  const profile = BOTTLE_PROFILES[a.bottleModel];
  const reportTime = new Date().toLocaleString('zh-CN');

  return h('section', { class: 'report-sheet' },
    h('div', { class: 'report-head' },
      h('div', {},
        h('h1', { style: 'margin:0;font-size:28px' }, '玻璃瓶残余应力质检报告'),
        h('div', { class: 'small' }, `报告编号：RPT-${a.id} · 生成时间：${reportTime}`),
        h('div', { class: 'small' }, `标准分级：${standard.name} · 校准：${store.calibration.id} · 操作员：${store.calibration.operator}`)
      ),
      h('div', { class: 'stamp' }, a.accepted ? '合格 PASS' : '不合格 REJECT')
    ),
    h('div', { class: 'report-grid' },
      h('div', {},
        h('h2', {}, '1. 样品与追溯信息'),
        h('div', { class: 'table-wrap', style: 'border-color:#cbd5e1' },
          h('table', {}, h('tbody', {},
            infoRow('瓶子编号', a.id),
            infoRow('瓶型', profile.label),
            infoRow('玻璃料色', TINT_LABELS[a.tint]),
            infoRow('模具 / 模腔', `${a.moldId} / ${a.cavity || '—'}`),
            infoRow('退火炉 / 侧别', a.lehrZone ? `${a.lehrZone} / ${a.lehrSide ?? '—'}` : '未绑定'),
            infoRow('图像来源', source === 'synthetic' ? '合成真值偏光图像（自检）' : '相机/上传拍摄帧'),
            infoRow('分析耗时', `${a.durationMs.toFixed(1)} ms（Web Worker）`)
          ))
        ),
        h('h2', {}, '2. 分区应力结果'),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '区域'), h('th', { class: 'num' }, '厚度'), h('th', { class: 'num' }, '峰值 Δ(nm)'), h('th', { class: 'num' }, '应力(MPa)'), h('th', {}, '级别'), h('th', {}, '判定'))),
          h('tbody', {}, ...a.zones.filter((z) => z.pixelCount).map((z) => h('tr', {},
            h('td', {}, z.name),
            h('td', { class: 'num' }, `${z.thicknessMm.toFixed(1)} mm`),
            h('td', { class: 'num' }, z.peakRetardationNm.toFixed(1)),
            h('td', { class: 'num' }, z.peakStressMPa.toFixed(2)),
            h('td', {}, `${z.grade} 级`),
            h('td', {}, z.accepted ? '通过' : '超标')
          )))
        ),
        h('p', { class: 'small', style: 'color:#475569' }, `定级说明：${gradeLabel(a.overallGrade)}。${standard.sourceNote}`),
        h('h2', {}, '3. 超标位置与处置'),
        a.marks.length
          ? h('ul', {}, ...a.marks.map((m) => h('li', {}, `${m.zone}（${m.x}, ${m.y}）：${m.message}`)))
          : h('p', {}, '各关键区域均未超过控制限，可正常放行并继续按模具/炉区追溯。')
      ),
      h('div', {},
        h('h2', {}, '图像证据'),
        h('div', { class: 'report-images' },
          figure(sourceCanvas, '偏光原图与标记'),
          figure(regionCanvas, '轮廓/区域分割'),
          figure(heatCanvas, '应力热力图')
        ),
        h('h2', {}, '计算模型'),
        h('div', { class: 'small', style: 'line-height:1.8;color:#334155' },
          h('div', {}, '① RGB 等色线经校准 LUT 反演为光程差 Δ；'),
          h('div', {}, `② σ = Δ / (C·t)，C=${store.calibration.stressOpticalCoefficientPa.toExponential(2)} Pa⁻¹；`),
          h('div', {}, '③ 瓶底中心、瓶口采用关键区限值；'),
          h('div', {}, '④ 同模具/同炉区批次归因见“模具统计”页。')
        ),
        store.batch.length ? h('div', {},
          h('h2', {}, '批次追溯摘要'),
          h('p', { class: 'small' }, `本批 ${store.batch.length} 只，拒检 ${store.batch.filter((b) => !b.accepted).length} 只。`),
          h('ol', {}, ...store.moldStats.slice(0, 3).map((m) => h('li', { class: 'small' }, `${m.moldId}：拒检率 ${(m.rejectRate * 100).toFixed(1)}%，${m.dominantDefect}`)))
        ) : null
      )
    )
  );
}

function infoRow(k: string, v: string) {
  return h('tr', {}, h('th', { style: 'width:38%;text-align:left' }, k), h('td', {}, v));
}

function figure(canvas: HTMLCanvasElement, caption: string) {
  return h('figure', {}, canvas, h('figcaption', {}, caption));
}
