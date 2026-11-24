import type { AnalyzeBottleInput } from './analysis';
import type { BatchCaseSpec } from './batch';
import type { WedgeCheckReport } from './calibrationCheck';
import type {
  BatchRecord,
  BottleAnalysis,
  CalibrationConfig,
  GlassTint,
  Raster,
  SyntheticBottle
} from './types';

export type WorkerRequest =
  | {
      type: 'analyze-synthetic';
      requestId: string;
      spec: BatchCaseSpec;
      calibration: CalibrationConfig;
    }
  | {
      type: 'analyze-image';
      requestId: string;
      image: Raster;
      input: Omit<AnalyzeBottleInput, 'image' | 'calibration'>;
      calibration: CalibrationConfig;
    }
  | {
      type: 'batch';
      requestId: string;
      cases: BatchCaseSpec[];
      calibration: CalibrationConfig;
    }
  | {
      type: 'wedge-check';
      requestId: string;
      tints: GlassTint[];
    };

export type WorkerResponse =
  | {
      type: 'synthetic-result';
      requestId: string;
      synth: SyntheticBottle;
      analysis: BottleAnalysis;
    }
  | {
      type: 'image-result';
      requestId: string;
      analysis: BottleAnalysis;
    }
  | {
      type: 'batch-progress';
      requestId: string;
      done: number;
      total: number;
    }
  | {
      type: 'batch-done';
      requestId: string;
      records: BatchRecord[];
      analyses?: BottleAnalysis[];
    }
  | {
      type: 'wedge-result';
      requestId: string;
      reports: WedgeCheckReport[];
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
