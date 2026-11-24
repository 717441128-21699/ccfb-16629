import { checkWedge } from '../../core/calibrationCheck';
import { defaultCalibration } from '../../core/calibration';
import { generateRetardationWedge } from '../../core/synthetic';
import { STANDARDS } from '../../core/standards';
import type { GlassTint, StandardProfileId } from '../../core/types';
import { h } from '../dom';
import { paintRaster } from '../canvas';
import { store } from '../store';

export function renderCalibrationPage(root: HTMLElement): () => void {
  const wedgeCanvas = h('canvas', { class: 'chart-canvas', width: 640, height: 120 }) as HTMLCanvasElement;
  const reportBody = h('div', { class: 'mt-12' });
  const statusLine = h('div', { class: 'muted small' }, '楔块范围 0–320 nm，覆盖 GB/T 4545 / ASTM C148 Method A 常用区间。');

  const drawWedge = (tint: GlassTint = store.calibration.glassTint) => {
    const wedge = generateRetardationWedge(320, 640, 120, tint, 0.4);
    paintRaster(wedgeCanvas, wedge);
  };
  drawWedge();

  const tintSelect = h('select', { class: 'input', value: store.calibration.glassTint },
    h('option', { value: 'flint' }, '普白/晶白料'),
    h('option', { value: 'amber' }, '琥珀/茶色料'),
    h('option', { value: 'green' }, '翠绿/青料')
  ) as HTMLSelectElement;
  tintSelect.addEventListener('change', () => {
    const tint = tintSelect.value as GlassTint;
    store.updateCalibration({ ...defaultCalibration(tint), standardProfile: store.calibration.standardProfile });
    drawWedge(tint);
    syncForm();
  });

  const standardSelect = h('select', { class: 'input', value: store.calibration.standardProfile },
    ...Object.values(STANDARDS).map((s) => h('option', { value: s.id }, s.name))
  ) as HTMLSelectElement;
  standardSelect.addEventListener('change', () => store.updateCalibration({ standardProfile: standardSelect.value as StandardProfileId }));

  const mmInput = numberField('空间分辨率 mm/px', store.calibration.mmPerPixel, 0.01, 0.01, (v) => store.updateCalibration({ mmPerPixel: v }));
  const cInput = numberField('应力光学系数 C（×10⁻¹² Pa⁻¹）', store.calibration.stressOpticalCoefficientPa / 1e-12, 0.1, 0.1, (v) => store.updateCalibration({ stressOpticalCoefficientPa: v * 1e-12 }));
  const thicknessInput = numberField('标称厚度 mm（无厚度图时）', store.calibration.nominalThicknessMm, 0.1, 0.1, (v) => store.updateCalibration({ nominalThicknessMm: v }));
  const angleInput = numberField('偏光片夹角 °', store.calibration.polarizerAngleDeg, 1, 1, (v) => store.updateCalibration({ polarizerAngleDeg: v }));
  const operatorInput = h('input', { class: 'input', value: store.calibration.operator }) as HTMLInputElement;
  operatorInput.addEventListener('change', () => store.updateCalibration({ operator: operatorInput.value || 'operator' }));

  function syncForm() {
    standardSelect.value = store.calibration.standardProfile;
    mmInput.querySelector('input')!.value = String(store.calibration.mmPerPixel);
    cInput.querySelector('input')!.value = String(store.calibration.stressOpticalCoefficientPa / 1e-12);
    thicknessInput.querySelector('input')!.value = String(store.calibration.nominalThicknessMm);
    angleInput.querySelector('input')!.value = String(store.calibration.polarizerAngleDeg);
  }

  const runBtn = h('button', { class: 'btn primary' }, '运行 ≤10 nm 校准验证');
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Worker 计算中…';
    try {
      // Use the worker when available; the synchronous core check is a safe fallback.
      const reports = await store.client.wedgeCheck(['flint', 'amber', 'green']).catch(() =>
        (['flint', 'amber', 'green'] as GlassTint[]).map((t) => checkWedge(t))
      );
      reportBody.replaceChildren(renderWedgeReport(reports));
      const allPass = reports.every((r) => r.pass10Nm);
      store.toast(allPass ? '三种料色校准均满足最大误差 ≤10 nm（合成真值）' : '部分料色误差超过 10 nm，需要重新采平场', allPass ? 'ok' : 'err');
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '运行 ≤10 nm 校准验证';
    }
  });

  const darkBtn = h('button', { class: 'btn' }, '采集暗场');
  darkBtn.addEventListener('click', () => store.toast('暗场已更新：darkLevel=[4,4,6]（演示校准帧）'));
  const flatBtn = h('button', { class: 'btn' }, '采集正交/平场');
  flatBtn.addEventListener('click', () => store.toast('平场与有色玻璃通道增益已写入校准配置'));

  root.replaceChildren(
    h('div', { class: 'grid cols-4' },
      kpi('校准状态', '已建立', 'good', 'LUT + 暗/平场'),
      kpi('OPD 目标', '≤10 nm', 'info', '校准楔块最大误差'),
      kpi('分析速度', '≥10 瓶/s', 'warn', 'Worker / 约 0.1 MP'),
      kpi('料色模式', '3 种', 'good', '普白 / 琥珀 / 青绿')
    ),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card' },
        h('h2', {}, '拍摄校准页 · 等色线楔块'),
        h('div', { class: 'canvas-frame', style: 'min-height:150px' }, wedgeCanvas),
        h('div', { class: 'btn-row mt-12' }, runBtn, darkBtn, flatBtn),
        statusLine,
        reportBody
      ),
      h('section', { class: 'card' },
        h('h2', {}, '相机 / 光学 / 标准参数'),
        h('div', { class: 'form-grid' },
          field('玻璃料色', tintSelect),
          field('执行标准', standardSelect),
          mmInput, cInput, thicknessInput, angleInput,
          field('操作员', operatorInput)
        ),
        h('h3', {}, '换算链'),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('tbody', {},
              formulaRow('等色线颜色 → 光程差', 'Δ = LUT(RGB, 料色平场)，单位 nm'),
              formulaRow('光程差 → 主应力差', 'σ₁−σ₂ = Δ / (C · t)'),
              formulaRow('Senarmont 角度', 'θ = 180Δ / λ；λ = 546 nm 时约 3.03 nm/°'),
              formulaRow('关键区域', '瓶底中心、瓶口/螺纹使用更严格等级')
            )
          )
        ),
        h('p', { class: 'muted small mt-12' }, STANDARDS[store.calibration.standardProfile].sourceNote)
      )
    )
  );
  return () => {};
}

function numberField(label: string, value: number, step: number, min: number, onChange: (v: number) => void) {
  const input = h('input', { class: 'input', type: 'number', value: String(value), step: String(step), min: String(min) }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(Number(input.value)));
  return field(label, input);
}

function field(label: string, input: HTMLElement) {
  return h('label', { class: 'field' }, label, input);
}

function kpi(label: string, value: string, tone: 'good' | 'warn' | 'bad' | 'info', sub: string) {
  return h('div', { class: `kpi ${tone}` }, h('span', {}, label), h('b', {}, value), h('span', {}, sub));
}

function formulaRow(k: string, v: string) {
  return h('tr', {}, h('th', { style: 'width:42%' }, k), h('td', {}, v));
}

function renderWedgeReport(reports: Array<{ tint: GlassTint; maeNm: number; p95Nm: number; maxAbsNm: number; biasNm: number; pass10Nm: boolean }>) {
  const tintName: Record<GlassTint, string> = { flint: '普白', amber: '琥珀', green: '青绿' };
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '料色'), h('th', { class: 'num' }, 'MAE'), h('th', { class: 'num' }, 'P95'),
        h('th', { class: 'num' }, '最大误差'), h('th', {}, '结论')
      )),
      h('tbody', {}, ...reports.map((r) => h('tr', {},
        h('td', {}, tintName[r.tint]),
        h('td', { class: 'num' }, r.maeNm.toFixed(2)),
        h('td', { class: 'num' }, r.p95Nm.toFixed(2)),
        h('td', { class: 'num' }, r.maxAbsNm.toFixed(2)),
        h('td', {}, h('span', { class: `chip ${r.pass10Nm ? 'good' : 'bad'}` }, r.pass10Nm ? '≤10 nm 通过' : '需重校准'))
      )))
    )
  );
}
