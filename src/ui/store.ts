import { AnalysisClient } from '../workerClient';
import { defaultCalibration } from '../core/calibration';
import { computeLehrStats, computeMoldStats, diagnoseBatch, type Diagnosis } from '../core/stats';
import type { BatchRecord, BottleAnalysis, CalibrationConfig, MoldStat, LehrStat, Raster, SyntheticBottle } from '../core/types';

export type Route = 'calibration' | 'bottle' | 'molds' | 'report';

export interface CurrentBottle {
  specId: string;
  synth?: SyntheticBottle;
  image?: Raster;
  analysis: BottleAnalysis;
  source: 'synthetic' | 'upload';
}

class AppStore {
  route: Route = 'calibration';
  calibration: CalibrationConfig = defaultCalibration('flint');
  client = new AnalysisClient();
  current: CurrentBottle | null = null;
  batch: BatchRecord[] = [];
  moldStats: MoldStat[] = [];
  lehrStats: LehrStat[] = [];
  diagnosis: Diagnosis | null = null;
  batchProgress = 0;
  batchTotal = 0;
  batchBusy = false;
  toasts: Array<{ id: number; text: string; kind?: 'ok' | 'err' }> = [];
  private listeners = new Set<() => void>();
  private toastSeq = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  setRoute(route: Route): void {
    this.route = route;
    this.emit();
  }

  updateCalibration(patch: Partial<CalibrationConfig>): void {
    this.calibration = { ...this.calibration, ...patch };
    this.emit();
  }

  setCurrent(current: CurrentBottle): void {
    this.current = current;
    this.emit();
  }

  setBatch(records: BatchRecord[]): void {
    this.batch = records;
    this.moldStats = computeMoldStats(records);
    this.lehrStats = computeLehrStats(records);
    this.diagnosis = diagnoseBatch(records, this.moldStats, this.lehrStats);
    this.emit();
  }

  setBatchProgress(done: number, total: number): void {
    this.batchProgress = done;
    this.batchTotal = total;
    this.emit();
  }

  setBatchBusy(busy: boolean): void {
    this.batchBusy = busy;
    this.emit();
  }

  toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
    this.toastSeq += 1;
    const id = this.toastSeq;
    this.toasts.push({ id, text, kind });
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.emit();
    }, 4200);
  }
}

export const store = new AppStore();
