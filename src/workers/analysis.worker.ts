import { analyzeBottle } from '../core/analysis';
import { generateBatchCases, recordFromAnalysis, type BatchCaseSpec } from '../core/batch';
import { checkWedge } from '../core/calibrationCheck';
import { defaultCalibration } from '../core/calibration';
import { synthesizeBottle } from '../core/synthetic';
import type { WorkerRequest, WorkerResponse } from '../core/messages';

interface MinimalWorker {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void | Promise<void>) | null;
  postMessage(message: WorkerResponse): void;
}

const ctx = self as unknown as MinimalWorker;

function calForCase(base: ReturnType<typeof defaultCalibration>, tint: BatchCaseSpec['tint']) {
  const tintCal = defaultCalibration(tint);
  return {
    ...tintCal,
    standardProfile: base.standardProfile,
    mmPerPixel: base.mmPerPixel,
    stressOpticalCoefficientPa: base.stressOpticalCoefficientPa,
    operator: base.operator,
    id: base.id
  };
}

ctx.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'wedge-check') {
      const reports = msg.tints.map((tint) => checkWedge(tint));
      ctx.postMessage({ type: 'wedge-result', requestId: msg.requestId, reports });
      return;
    }

    if (msg.type === 'analyze-synthetic') {
      const synth = synthesizeBottle(msg.spec);
      const calibration = calForCase(msg.calibration, msg.spec.tint);
      const analysis = analyzeBottle({
        image: synth.image,
        calibration,
        bottleModel: msg.spec.model,
        id: msg.spec.id,
        moldId: msg.spec.moldId,
        cavity: msg.spec.cavity,
        defectKind: msg.spec.defectKind,
        lehrZone: msg.spec.lehrZone,
        lehrSide: msg.spec.lehrSide,
        tint: msg.spec.tint,
        truth: synth.truth,
        generateHeatmap: true
      });
      ctx.postMessage({ type: 'synthetic-result', requestId: msg.requestId, synth, analysis });
      return;
    }

    if (msg.type === 'analyze-image') {
      const analysis = analyzeBottle({
        ...msg.input,
        image: msg.image,
        calibration: msg.calibration,
        generateHeatmap: true
      });
      ctx.postMessage({ type: 'image-result', requestId: msg.requestId, analysis });
      return;
    }

    if (msg.type === 'batch') {
      const cases = msg.cases.length ? msg.cases : generateBatchCases();
      const records = [];
      for (let i = 0; i < cases.length; i += 1) {
        const spec = cases[i];
        const synth = synthesizeBottle(spec);
        const calibration = calForCase(msg.calibration, spec.tint);
        const result = analyzeBottle({
          image: synth.image,
          calibration,
          bottleModel: spec.model,
          id: spec.id,
          moldId: spec.moldId,
          cavity: spec.cavity,
          defectKind: spec.defectKind,
          lehrZone: spec.lehrZone,
          lehrSide: spec.lehrSide,
          tint: spec.tint,
          generateHeatmap: false
        });
        records.push(recordFromAnalysis(spec, result));
        if (i % 6 === 0 || i === cases.length - 1) {
          ctx.postMessage({ type: 'batch-progress', requestId: msg.requestId, done: i + 1, total: cases.length });
          // Yield to the event loop so progress messages paint.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      ctx.postMessage({ type: 'batch-done', requestId: msg.requestId, records });
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.stack || err.message : String(err)
    });
  }
};
