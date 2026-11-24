import './styles.css';
import { STANDARDS } from './core/standards';
import type { StandardProfileId } from './core/types';
import { h, clear } from './ui/dom';
import { renderBottlePage } from './ui/pages/bottle';
import { renderCalibrationPage } from './ui/pages/calibration';
import { renderMoldsPage } from './ui/pages/molds';
import { renderReportPage } from './ui/pages/report';
import { runQuickDemo } from './ui/actions';
import { store, type Route } from './ui/store';

const page = document.querySelector<HTMLElement>('#page')!;
const title = document.querySelector<HTMLHeadingElement>('#pageTitle')!;
const subtitle = document.querySelector<HTMLParagraphElement>('#pageSubtitle')!;
const standardSelect = document.querySelector<HTMLSelectElement>('#standardSelect')!;
const workerStatus = document.querySelector<HTMLDivElement>('#workerStatus')!;
const clock = document.querySelector<HTMLSpanElement>('#clock')!;
const quickDemo = document.querySelector<HTMLButtonElement>('#quickDemo')!;

standardSelect.replaceChildren(
  ...Object.values(STANDARDS).map((s) => h('option', { value: s.id }, s.name))
);
standardSelect.value = store.calibration.standardProfile;
standardSelect.addEventListener('change', () => {
  store.updateCalibration({ standardProfile: standardSelect.value as StandardProfileId });
  store.toast(`已切换分级表：${STANDARDS[store.calibration.standardProfile].name}`);
});

const routeMeta: Record<Route, { title: string; subtitle: string }> = {
  calibration: { title: '拍摄校准', subtitle: '暗场/平场、有色玻璃补偿、应力光学系数与光程差校验' },
  bottle: { title: '单瓶应力页', subtitle: '轮廓与瓶底 / 瓶身 / 瓶口分区，等色线 → 光程差 → 残余应力' },
  molds: { title: '模具统计页', subtitle: '按模具号、模腔、退火炉区和横向位置归因模具或退火炉问题' },
  report: { title: '质检报告页', subtitle: '关键区应力级别、超标坐标、图像证据与批次追溯' }
};

let cleanup: (() => void) | void;
function renderRoute() {
  const route = store.route;
  title.textContent = routeMeta[route].title;
  subtitle.textContent = routeMeta[route].subtitle;
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
  clear(page);
  cleanup?.();
  if (route === 'calibration') cleanup = renderCalibrationPage(page);
  if (route === 'bottle') cleanup = renderBottlePage(page);
  if (route === 'molds') cleanup = renderMoldsPage(page);
  if (route === 'report') cleanup = renderReportPage(page);
}

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => store.setRoute(btn.dataset.route as Route));
});

quickDemo.addEventListener('click', () => void runQuickDemo());

function updateClock() {
  clock.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

const toastWrap = h('div', { class: 'toast-wrap' });
document.body.append(toastWrap);
function renderToasts() {
  toastWrap.replaceChildren(...store.toasts.map((t) => h('div', {
    class: 'toast',
    style: t.kind === 'err' ? 'border-color:rgba(239,68,68,.45)' : 'border-color:rgba(56,189,248,.35)'
  }, t.text)));
}

store.subscribe(() => {
  renderToasts();
  if (standardSelect.value !== store.calibration.standardProfile) {
    standardSelect.value = store.calibration.standardProfile;
  }
});

workerStatus.textContent = '分析 Web Worker 已挂载';
renderRoute();
