// String quartet (F10) from VSCO 2 Community Edition samples (CC0 1.0;
// see docs/CREDITS.md). The Community Edition has a solo violin but only
// section viola and cello, so the inner and lower parts use section samples.
// If any sample fails to load, the quartet falls back to a synth string
// sound so practice never stops.

import * as Tone from 'tone';
import { FormantVoice, type Ensemble, type EnsembleVoice } from './choirSynth';

const FILES: Record<'violin' | 'viola' | 'cello', string[]> = {
  violin: ['G3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5'],
  viola: ['C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5'],
  cello: ['C2', 'E2', 'G2', 'B2', 'D3', 'F3', 'A3', 'C4'],
};

class SamplerVoice implements EnsembleVoice {
  private note: string | null = null;
  constructor(private readonly sampler: Tone.Sampler) {}
  attack(note: string, time: number, velocity: number): void {
    this.note = note;
    this.sampler.triggerAttack(note, time, velocity);
  }
  release(time: number): void {
    if (this.note) this.sampler.triggerRelease(this.note, time);
  }
  dispose(): void {
    /* samplers are disposed by the ensemble */
  }
}

function loadSampler(inst: keyof typeof FILES, out: Tone.InputNode): Promise<Tone.Sampler> {
  return new Promise((resolve, reject) => {
    const urls: Record<string, string> = {};
    for (const n of FILES[inst]) urls[n] = `${n}.ogg`;
    const s = new Tone.Sampler({
      urls,
      baseUrl: `samples/${inst}/`,
      attack: 0.04,
      release: 0.7,
      onload: () => resolve(s),
      onerror: (e) => reject(e),
    });
    s.connect(out);
    setTimeout(() => reject(new Error('sample load timeout')), 15_000);
  });
}

export async function createQuartet(out: Tone.InputNode): Promise<Ensemble> {
  try {
    const [v1, v2, va, vc] = await Promise.all([
      loadSampler('violin', out), loadSampler('violin', out), loadSampler('viola', out), loadSampler('cello', out),
    ]);
    const samplers = [v1, v2, va, vc];
    samplers.forEach((s, i) => { s.volume.value = i === 3 ? -2 : -4; });
    return {
      kind: 'quartet',
      voices: samplers.map((s) => new SamplerVoice(s)),
      dispose: () => samplers.forEach((s) => s.dispose()),
    };
  } catch {
    return createStringSynth(out);
  }
}

/** Fallback: bowed-string-like synth (slower attack, body resonances). */
export function createStringSynth(out: Tone.InputNode): Ensemble {
  const voices = (['S', 'A', 'T', 'B'] as const).map((p) =>
    new FormantVoice(p, out, { attack: 0.12, release: 0.8 }));
  return { kind: 'strings-synth', voices, dispose: () => voices.forEach((v) => v.dispose()) };
}
