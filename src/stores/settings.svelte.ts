// Settings (F14), persisted as a small JSON file by the main process.

import type { Voicing } from '../sound/voicing';

export interface Settings {
  ensemble: 'choir' | 'quartet';
  voicing: Voicing;
  volumeDb: number;
  targetBpm: number;
  /** Ready by chin lift (and R), or by the R key only. */
  readyGesture: boolean;
  cameraId: string;
  /** Label of the chosen camera (used to pick the same camera natively for
   *  the readiness check; device IDs differ between browser and native). */
  cameraLabel: string;
  /** Camera capture size sent to SmartSpectra. 960×540 halves the per-frame
   *  work when the frame rate falls below 25 fps. */
  captureSize: '1280x720' | '960x540';
  motion: 'system' | 'reduce' | 'full';
  showMirror: boolean;
  /** Blur the camera mirror (on by default; the demo video relies on it). */
  blurMirror: boolean;
  fuseAbdomen: boolean;
  consented: boolean;
  platesSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ensemble: 'choir',
  voicing: 'open',
  volumeDb: -6,
  targetBpm: 72,
  readyGesture: true,
  cameraId: '',
  cameraLabel: '',
  captureSize: '1280x720',
  motion: 'system',
  showMirror: false,
  blurMirror: true,
  fuseAbdomen: true,
  consented: false,
  platesSeen: false,
};

class SettingsStore {
  value = $state<Settings>({ ...DEFAULT_SETTINGS });
  loaded = $state(false);

  async load(): Promise<void> {
    const s = await window.upbeat?.store.read<Partial<Settings>>('settings');
    this.value = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    this.loaded = true;
  }

  async update(patch: Partial<Settings>): Promise<void> {
    this.value = { ...this.value, ...patch };
    await window.upbeat?.store.write('settings', $state.snapshot(this.value));
  }

  reducedMotion(): boolean {
    if (this.value.motion === 'reduce') return true;
    if (this.value.motion === 'full') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}

export const settings = new SettingsStore();
