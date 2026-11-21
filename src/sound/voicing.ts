// Chords and voicings (pure data, no Tone import, unit-testable).

export type Voicing = 'open' | 'close' | 'unison';
export type Part = 'S' | 'A' | 'T' | 'B';

/** Eight choir singers, two per part: S1 S2 A1 A2 T1 T2 B1 B2. */
export const CHOIR_PARTS: readonly Part[] = ['S', 'S', 'A', 'A', 'T', 'T', 'B', 'B'];
export const CHOIR_LABELS = ['Soprano 1', 'Soprano 2', 'Alto 1', 'Alto 2', 'Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2'];
export const QUARTET_LABELS = ['Violin 1', 'Violin 2', 'Viola', 'Cello'];

/** F major, which sits comfortably in every part. */
const CHOIR: Record<Voicing, string[]> = {
  open: ['A4', 'F4', 'C4', 'A3', 'F3', 'C3', 'A2', 'F2'],
  close: ['C5', 'A4', 'F4', 'C4', 'A3', 'F3', 'C3', 'F2'],
  unison: ['F4', 'F4', 'F4', 'F4', 'F3', 'F3', 'F2', 'F2'],
};
const QUARTET: Record<Voicing, string[]> = {
  open: ['A4', 'F4', 'C4', 'F2'],
  close: ['C5', 'A4', 'F4', 'F3'],
  unison: ['F4', 'F4', 'F3', 'F2'],
};

export function chordFor(ensemble: 'choir' | 'quartet', v: Voicing): string[] {
  return (ensemble === 'choir' ? CHOIR : QUARTET)[v];
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToHz(n: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  const semis = NOTE[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = 12 * (Number(m[3]) + 1) + semis;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Vowel "ah" formants per part: [Hz, bandwidth Hz, gain dB] (classic
 *  singing-voice formant table values). */
export const AH_FORMANTS: Record<Part, ReadonlyArray<readonly [number, number, number]>> = {
  S: [[800, 80, 0], [1150, 90, -6], [2900, 120, -32]],
  A: [[800, 80, 0], [1150, 90, -4], [2800, 120, -20]],
  T: [[650, 80, 0], [1080, 90, -6], [2650, 120, -7]],
  B: [[600, 60, 0], [1040, 70, -7], [2250, 110, -9]],
};
