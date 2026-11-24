import { BOTTLE_PROFILES } from '../../core/bottleGeometry';
import type { BatchCaseSpec } from '../../core/batch';
import { gradeLabel } from '../../core/standards';
import type { BottleModel, DefectKind, GlassTint } from '../../core/types';
import { h, imageToRaster, readImageFile, fmt1 } from '../dom';
import { paintAnalysisHeatmap, paintContour, paintMarks, paintRegionMap, paintRaster } from '../canvas';
import { DEFECT_LABELS, TINT_LABELS } from '../labels';
import { runSyntheticSpec } from '../actions';
import { store } from '../store';

export function renderBottlePage(root: HTMLElement): () => void {
  const form = createSpecForm();
  const analyzeBtn = h('button', { class: 'btn primary' }, '合成并分析') as HTMLButtonElement;
  analyzeBtn.addEventListener('click', async () => {
    analyzeBtn.disabled = true;
    try {
      await runSyntheticSpec(form.readSpec());
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    analyzeBtn.disabled = true;
    try {
      const img = await readImageFile(file);
      const raster = imageToRaster(img);
      const res = await store.client.analyzeImage(raster, store.calibration, {
        bottleModel: form.modelSelect.value as BottleModel,
        id: `UP-${Date.now().toString(36)}`,
        moldId: form.moldInput.value || 'M-UPLOAD',
        cavity: Number(form.cavityInput.value) || 1
      });
      store.setCurrent({ specId: file.name, image: raster, analysis: res.analysis, source: 'upload' });
      store.toast('上传图像分析完成');
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      analyzeBtn.disabled = false;
      fileInput.value = '';
    }
  });
  const uploadBtn = h('button', { class: 'btn' }, '上传拍摄帧');
  uploadBtn.addEventListener('click', () => fileInput.click());

  const resultSlot = h('div', { class: 'grid' }, h('div', { class: 'skeleton' }, '选择瓶型/缺陷后点击“合成并分析”；也可上传真实偏光仪照片。系统将在 Web Worker 中完成分割、颜色反演和应力计算。'));

  root.replaceChildren(
    h('section', { class: 'card' },
      h('h2', {}, '单瓶采集与分析参数'),
      h('div', { class: 'form-grid' },
        form.modelField, form.tintField, form.defectField, form.seedField,
        form.moldField, form.cavityField, form.lehrZoneField, form.sideField,
        form.severityField
      ),
      h('div', { class: 'btn-row mt-12' }, analyzeBtn, uploadBtn, fileInput,
        h('button', { class: 'btn ghost', onclick: () => store.setRoute('report') }, '查看质检报告'))
    ),
    resultSlot
  );

  let regionMode = false;
  const unsubscribe = store.subscribe(() => renderResult());
  renderResult();

  function renderResult() {
    const current = store.current;
    if (!current) return;
    const a = current.analysis;
    const raster = current.synth?.image ?? current.image;
    resultSlot.replaceChildren();

    const verdict = h('section', { class: `verdict ${a.accepted ? 'pass' : 'fail'}` },
      h('div', {},
        h('h2', {}, a.accepted ? '✅ 判定合格 / 可放行' : '⛔ 应力超标 / 隔离复检'),
        h('p', {}, `编号 ${a.id} · 模具 ${a.moldId}${a.cavity ? ` / 模腔 ${a.cavity}` : ''} · 最差区域：${a.worstZone} · Worker 用时 ${a.durationMs.toFixed(1)} ms`)
      ),
      h('div', { style: 'text-align:right' },
        h('div', { class: `grade-pill g${Math.min(11, a.overallGrade)}`, style: 'font-size:24px;padding:10px 16px' }, `${a.overallGrade} 级`),
        h('div', { class: 'muted small mt-12' }, gradeLabel(a.overallGrade))
      )
    );

    const sourceCanvas = h('canvas', { class: 'base' }) as HTMLCanvasElement;
    const sourceOverlay = h('canvas', { class: 'overlay' }) as HTMLCanvasElement;
    const heatCanvas = h('canvas', { class: 'base' }) as HTMLCanvasElement;
    const heatOverlay = h('canvas', { class: 'overlay' }) as HTMLCanvasElement;
    if (raster) paintRaster(sourceCanvas, raster);
    sourceOverlay.width = a.width; sourceOverlay.height = a.height;
    paintContour(sourceOverlay, a);
    paintMarks(sourceOverlay, a);
    paintAnalysisHeatmap(heatCanvas, a);
    heatOverlay.width = a.width; heatOverlay.height = a.height;
    paintMarks(heatOverlay, a);

    const regionBtn = h('button', { class: 'btn small' }, regionMode ? '显示原图' : '显示区域分割') as HTMLButtonElement;
    regionBtn.addEventListener('click', () => {
      regionMode = !regionMode;
      if (regionMode) paintRegionMap(sourceCanvas, a);
      else if (raster) paintRaster(sourceCanvas, raster);
      sourceOverlay.width = a.width; sourceOverlay.height = a.height;
      paintContour(sourceOverlay, a); paintMarks(sourceOverlay, a);
      regionBtn.textContent = regionMode ? '显示原图' : '显示区域分割';
    });

    const canvasCard = h('section', { class: 'card' },
      h('h2', {}, '轮廓 / 区域 / 超标位置', regionBtn),
      h('div', { class: 'canvas-stack' }, sourceCanvas, sourceOverlay),
      h('div', { class: 'legend mt-12' },
        h('span', {}, h('i', { style: 'background:#38bdf8' }), '瓶身'),
        h('span', {}, h('i', { style: 'background:#fbbf24' }), '瓶底'),
        h('span', {}, h('i', { style: 'background:#f472b6' }), '瓶口'),
        h('span', {}, h('i', { style: 'background:#ef4444' }), '超标标记')
      )
    );

    const heatCard = h('section', { class: 'card' },
      h('h2', {}, '应力 / 光程差分布 Canvas'),
      h('div', { class: 'canvas-stack' }, heatCanvas, heatOverlay),
      h('div', { class: 'heat-legend mt-12' }),
      h('div', { class: 'legend mt-12' }, h('span', {}, '低应力 0'), h('span', { style: 'margin-left:auto' }, `量程 ${Math.max(180, STANDARD_MAX)} nm / 红区`))
    );

    const tableCard = h('section', { class: 'card' },
      h('h2', {}, '分区定量结果'),
      renderZoneTable(a)
    );
    const markCard = h('section', { class: 'card' },
      h('h2', {}, '超标位置与处置建议'),
      a.marks.length ? h('ul', { class: 'mark-list' }, ...a.marks.map(renderMark)) : h('div', { class: 'skeleton' }, '未发现超过控制限的位置。')
    );

    const truthCard = current.synth ? renderTruthCard(current.synth.truth, a) : null;

    resultSlot.append(
      verdict,
      h('div', { class: 'grid cols-2' }, canvasCard, heatCard),
      h('div', { class: 'grid cols-2' }, tableCard, h('div', { class: 'grid' }, markCard, truthCard))
    );
  }

  return () => unsubscribe();
}

const STANDARD_MAX = 260;

function renderZoneTable(a: ReturnType<typeof Object> extends never ? never : import('../../core/types').BottleAnalysis) {
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '区域'), h('th', { class: 'num' }, '厚度 mm'),
        h('th', { class: 'num' }, '峰值 Δ nm'), h('th', { class: 'num' }, 'P95 Δ'),
        h('th', { class: 'num' }, '峰值 σ MPa'), h('th', {}, '级别'), h('th', {}, '判定')
      )),
      h('tbody', {}, ...a.zones.filter((z) => z.pixelCount > 0).map((z) => h('tr', {},
        h('td', {}, z.name),
        h('td', { class: 'num' }, fmt1(z.thicknessMm)),
        h('td', { class: 'num' }, fmt1(z.peakRetardationNm)),
        h('td', { class: 'num' }, fmt1(z.p95RetardationNm)),
        h('td', { class: 'num' }, fmt1(z.peakStressMPa)),
        h('td', {}, h('span', { class: `grade-pill g${Math.min(11, z.grade)}` }, String(z.grade))),
        h('td', {}, h('span', { class: `chip ${z.accepted ? 'good' : 'bad'}` }, z.accepted ? '通过' : '超标'))
      )))
    )
  );
}

function renderMark(mark: import('../../core/types').DefectMark) {
  return h('li', {},
    h('span', { class: `dot ${mark.severity}` }),
    h('div', {}, h('strong', {}, mark.zone), h('div', { class: 'muted small' }, mark.message))
  );
}

function renderTruthCard(truth: NonNullable<import('../../core/types').BottleAnalysis['truth']>, a: import('../../core/types').BottleAnalysis) {
  const gradeMatch = truth.manualGrade === a.overallGrade;
  const verdictMatch = truth.manualAccepted === a.accepted;
  return h('section', { class: 'card' },
    h('h2', {}, '合成真值 / 人工标准偏光仪对照'),
    h('div', { class: 'grid cols-3' },
      h('div', { class: 'kpi info' }, h('span', {}, '真值视觉峰值'), h('b', {}, `${truth.worstRetardationNm.toFixed(0)} nm`)),
      h('div', { class: `kpi ${gradeMatch ? 'good' : 'warn'}` }, h('span', {}, '人工/算法级别'), h('b', {}, `${truth.manualGrade} / ${a.overallGrade}`)),
      h('div', { class: `kpi ${verdictMatch ? 'good' : 'bad'}` }, h('span', {}, '结论一致'), h('b', {}, verdictMatch ? '是' : '否'))
    ),
    h('p', { class: 'muted small mt-12' }, '合成器按瓶型厚度图、应力场、光谱干涉、有色玻璃吸收和相机噪声生成；真值不进入分析算法。')
  );
}

function createSpecForm() {
  const modelSelect = h('select', { class: 'input' },
    ...Object.values(BOTTLE_PROFILES).map((p) => h('option', { value: p.model }, p.label))
  ) as HTMLSelectElement;
  modelSelect.value = 'beer500';
  const modelField = label('瓶型', modelSelect);

  const tintSelect = h('select', { class: 'input' },
    ...Object.entries(TINT_LABELS).map(([v, label]) => h('option', { value: v }, label))
  ) as HTMLSelectElement;
  const tintField = label('玻璃颜色', tintSelect);

  const defectSelect = h('select', { class: 'input' },
    ...Object.entries(DEFECT_LABELS).map(([v, label]) => h('option', { value: v }, label))
  ) as HTMLSelectElement;
  defectSelect.value = 'bottom-center';
  const defectField = label('退火缺陷', defectSelect);

  const seedInput = h('input', { class: 'input', type: 'number', value: '8848' }) as HTMLInputElement;
  const seedField = label('随机种子', seedInput);
  const moldInput = h('input', { class: 'input', value: 'M-03' }) as HTMLInputElement;
  const moldField = label('模具号', moldInput);
  const cavityInput = h('input', { class: 'input', type: 'number', min: '1', max: '8', value: '2' }) as HTMLInputElement;
  const cavityField = label('模腔号', cavityInput);
  const lehrZoneInput = h('select', { class: 'input' },
    ...['A-均热', 'B-退火', 'C-缓冷', 'D-快冷'].map((z) => h('option', { value: z }, z))
  ) as HTMLSelectElement;
  lehrZoneInput.value = 'C-缓冷';
  const lehrZoneField = label('退火炉区段', lehrZoneInput);
  const sideInput = h('select', { class: 'input' }, h('option', { value: 'L' }, '左侧'), h('option', { value: 'C' }, '中间'), h('option', { value: 'R', selected: true }, '右侧')) as HTMLSelectElement;
  const sideField = label('炉内横向位置', sideInput);
  const severityInput = h('input', { class: 'input', type: 'range', min: '0.35', max: '1.55', step: '0.01', value: '1.28' }) as HTMLInputElement;
  const severityValue = h('b', {}, '1.28');
  severityInput.addEventListener('input', () => { severityValue.textContent = Number(severityInput.value).toFixed(2); });
  const severityField = h('label', { class: 'field' }, '缺陷强度系数', severityInput, severityValue);

  return {
    modelSelect, tintSelect, defectSelect, seedInput, moldInput, cavityInput,
    modelField, tintField, defectField, seedField, moldField, cavityField,
    lehrZoneField, sideField, severityField,
    readSpec(): BatchCaseSpec {
      const seed = Number(seedInput.value) || 1;
      return {
        seed,
        id: `B-${seed}`,
        moldId: moldInput.value || 'M-00',
        cavity: Number(cavityInput.value) || 1,
        model: modelSelect.value as BottleModel,
        tint: tintSelect.value as GlassTint,
        defectKind: defectSelect.value as DefectKind,
        severity: Number(severityInput.value),
        lehrZone: lehrZoneInput.value,
        lehrSide: sideInput.value as 'L' | 'C' | 'R',
        analyzedAt: new Date().toISOString()
      };
    }
  };
}

function label(text: string, input: HTMLElement) {
  return h('label', { class: 'field' }, text, input);
}
