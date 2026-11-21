// Calibration profile and drill history: numbers only, deletable.

import type { CalibrationProfile } from '../engine/types';
import type { DrillScore } from '../engine/drills';

export interface HistoryEntry {
  readonly at: string;
  readonly kind: DrillScore['kind'];
  readonly cues: number;
  readonly meanErrorBpm: number;
  readonly spreadBpm: number;
  readonly meanAbsErrorBpm: number;
  readonly tightFraction: number;
  readonly predictionErrorBpm?: number;
  readonly targets: readonly number[];
  readonly set: readonly (number | null)[];
  readonly measured: readonly (number | null)[];
  readonly qualities: readonly string[];
  readonly replay: boolean;
}

class ProfileStore {
  profile = $state<CalibrationProfile | null>(null);
  history = $state<HistoryEntry[]>([]);

  async load(): Promise<void> {
    this.profile = (await window.upbeat?.store.read<CalibrationProfile>('profile')) ?? null;
    this.history = (await window.upbeat?.store.read<HistoryEntry[]>('history')) ?? [];
  }

  async saveProfile(p: CalibrationProfile): Promise<void> {
    this.profile = p;
    await window.upbeat?.store.write('profile', p);
  }

  async addHistory(h: HistoryEntry): Promise<void> {
    this.history = [h, ...this.history].slice(0, 200);
    await window.upbeat?.store.write('history', $state.snapshot(this.history));
  }

  async deleteAll(recordings: boolean): Promise<void> {
    await window.upbeat?.store.deleteData({ recordings });
    this.profile = null;
    this.history = [];
  }
}

export const profileStore = new ProfileStore();
