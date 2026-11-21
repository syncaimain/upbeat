// The choir: eight formant-synthesised voices singing "ah" (F6).
// Each voice: two slightly detuned sawtooth oscillators with a delayed
// vibrato → three parallel band-pass formant filters → amplitude envelope.
// Oscillators run continuously; the envelope gates each entry, so attack
// times are exactly the scheduled audio times.

import * as Tone from 'tone';
import { AH_FORMANTS, CHOIR_PARTS, noteToHz, type Part } from './voicing';

export interface EnsembleVoice {
  attack(note: string, time: number, velocity: number): void;
  release(time: number): void;
  dispose(): void;
}

export interface Ensemble {
  readonly kind: 'choir' | 'quartet' | 'strings-synth';
  readonly voices: EnsembleVoice[];
  dispose(): void;
}

export class FormantVoice implements EnsembleVoice {
  private readonly osc1: Tone.Oscillator;
  private readonly osc2: Tone.Oscillator;
  private readonly vib: Tone.LFO;
  private readonly vibDepth: Tone.Gain;
  private readonly env: Tone.AmplitudeEnvelope;
  private readonly nodes: { dispose(): void }[] = [];
  private readonly detune: number;

  constructor(part: Part, out: Tone.InputNode, opts: { detuneCents?: number; attack?: number; release?: number } = {}) {
    // Slight per-voice detune (±6 cents) so two singers on a part are two people.
    this.detune = 2 ** ((opts.detuneCents ?? (Math.random() * 12 - 6)) / 1200);
    this.osc1 = new Tone.Oscillator({ type: 'sawtooth', frequency: 220 });
    this.osc2 = new Tone.Oscillator({ type: 'sawtooth', frequency: 220, detune: 7 });
    const mix = new Tone.Gain(0.35);
    this.osc1.connect(mix);
    this.osc2.connect(mix);
    // Vibrato: 5.3 Hz, ±14 cents, faded in by the envelope's sustain.
    this.vib = new Tone.LFO({ frequency: 5.1 + Math.random() * 0.5, min: -14, max: 14 });
    this.vibDepth = new Tone.Gain(1);
    this.vib.connect(this.vibDepth);
    this.vibDepth.connect(this.osc1.detune);
    this.env = new Tone.AmplitudeEnvelope({
      attack: opts.attack ?? 0.07, decay: 0.25, sustain: 0.82, release: opts.release ?? 0.55,
      attackCurve: 'linear',
    });
    const soften = new Tone.Filter({ type: 'lowpass', frequency: 5200, Q: 0.5 });
    for (const [f, bw, db] of AH_FORMANTS[part]) {
      const bp = new Tone.Filter({ type: 'bandpass', frequency: f, Q: f / bw });
      const g = new Tone.Gain(Tone.dbToGain(db) * 1.6);
      mix.connect(bp);
      bp.connect(g);
      g.connect(this.env);
      this.nodes.push(bp, g);
    }
    this.env.connect(soften);
    soften.connect(out);
    this.nodes.push(mix, soften, this.env, this.vib, this.vibDepth, this.osc1, this.osc2);
    this.osc1.start();
    this.osc2.start();
    this.vib.start();
  }

  attack(note: string, time: number, velocity: number): void {
    const hz = noteToHz(note) * this.detune;
    this.osc1.frequency.setValueAtTime(hz, time);
    this.osc2.frequency.setValueAtTime(hz, time);
    this.env.triggerAttack(time, velocity);
  }

  release(time: number): void {
    this.env.triggerRelease(time);
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
  }
}

export function createChoir(out: Tone.InputNode): Ensemble {
  const voices = CHOIR_PARTS.map((p) => new FormantVoice(p, out));
  return { kind: 'choir', voices, dispose: () => voices.forEach((v) => v.dispose()) };
}

/** The warm-up "tuning": two voices humming the tonic, quietly, through a
 *  low-pass (closed-mouth "mm"). */
export class TuningHum {
  private readonly oscs: Tone.Oscillator[] = [];
  private readonly env: Tone.AmplitudeEnvelope;
  private readonly lp: Tone.Filter;

  constructor(out: Tone.InputNode) {
    this.lp = new Tone.Filter({ type: 'lowpass', frequency: 480, Q: 0.7 });
    this.env = new Tone.AmplitudeEnvelope({ attack: 2.0, decay: 0.5, sustain: 1, release: 2.5 });
    const g = new Tone.Gain(0.22);
    for (const n of ['F3', 'F2', 'C3']) {
      const o = new Tone.Oscillator({ type: 'triangle', frequency: noteToHz(n) * (1 + (Math.random() - 0.5) * 0.002) });
      o.connect(g);
      o.start();
      this.oscs.push(o);
    }
    g.connect(this.lp);
    this.lp.connect(this.env);
    this.env.connect(out);
  }

  start(time?: number): void {
    this.env.triggerAttack(time);
  }

  stop(time?: number): void {
    this.env.triggerRelease(time);
  }

  dispose(): void {
    this.oscs.forEach((o) => o.dispose());
    this.env.dispose();
    this.lp.dispose();
  }
}

/** Metronome click: a short, soft wooden tick; the downbeat is higher. */
export class Click {
  private readonly synth: Tone.Synth;
  constructor(out: Tone.InputNode) {
    this.synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
      volume: -10,
    });
    this.synth.connect(out);
  }
  tick(time: number, accent: boolean): void {
    this.synth.triggerAttackRelease(accent ? 1760 : 1320, 0.05, time, accent ? 0.9 : 0.6);
  }
  dispose(): void {
    this.synth.dispose();
  }
}
