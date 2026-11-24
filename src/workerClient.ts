import type { BatchCaseSpec } from './core/batch';
import type { WedgeCheckReport } from './core/calibrationCheck';
import type { WorkerResponse } from './core/messages';
import type {
  BatchRecord,
  BottleAnalysis,
  CalibrationConfig,
  GlassTint,
  Raster
} from './core/types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (done: number, total: number) => void;
};

export class AnalysisClient {
  private worker: Worker;
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor() {
    this.worker = new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      if (msg.type === 'batch-progress') {
        p.onProgress?.(msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.requestId);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (event) => {
      for (const [id, p] of this.pending) {
        p.reject(new Error(event.message));
        this.pending.delete(id);
      }
    };
  }

  private nextId(): string {
    this.seq += 1;
    return `req-${Date.now().toString(36)}-${this.seq}`;
  }

  // The request union is deliberately accepted as a structural payload here;
  // callers use the strongly typed convenience methods below.
  private send<T>(message: Record<string, unknown>, onProgress?: Pending['onProgress']): Promise<T> {
    const requestId = this.nextId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.worker.postMessage({ ...message, requestId });
    });
  }

  analyzeSynthetic(spec: BatchCaseSpec, calibration: CalibrationConfig) {
    return this.send<Extract<WorkerResponse, { type: 'synthetic-result' }>>({
      type: 'analyze-synthetic',
      spec,
      calibration
    });
  }

  analyzeImage(image: Raster, calibration: CalibrationConfig, input: {
    bottleModel?: BottleAnalysis['bottleModel'];
    id?: string;
    moldId?: string;
    cavity?: number;
  }) {
    return this.send<Extract<WorkerResponse, { type: 'image-result' }>>({
      type: 'analyze-image',
      image,
      input,
      calibration
    });
  }

  runBatch(cases: BatchCaseSpec[], calibration: CalibrationConfig, onProgress?: (done: number, total: number) => void) {
    return this.send<Extract<WorkerResponse, { type: 'batch-done' }>>({
      type: 'batch',
      cases,
      calibration
    }, onProgress).then((m) => m.records as BatchRecord[]);
  }

  wedgeCheck(tints: GlassTint[]) {
    return this.send<Extract<WorkerResponse, { type: 'wedge-result' }>>({ type: 'wedge-check', tints })
      .then((m) => m.reports as WedgeCheckReport[]);
  }

  terminate() {
    this.worker.terminate();
  }
}
