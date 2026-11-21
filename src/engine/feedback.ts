// Plain-language feedback and captions. Only musical timing is ever
// described — never breathing health, relaxation or lung function.

import type { CommittedEntry, CueResult } from './types';

export const tempoLabel = (bpm: number): string => `♩ = ${Math.round(bpm)}`;

export function qualityWord(q: CommittedEntry['quality']): string {
  return q === 'tight' ? 'together' : q === 'loose' ? 'a little loose' : 'ragged';
}

/** Caption for the moment the ensemble enters. */
export function entryCaption(e: CommittedEntry, ensemble: 'choir' | 'quartet'): string {
  const who = ensemble === 'choir' ? 'Choir' : 'Quartet';
  if (e.cause === 'metronome') return `${who} enters on the count — together`;
  if (e.quality === 'ragged') return `${who} enters ragged — two voices late`;
  if (e.quality === 'loose') return `${who} enters — a little loose`;
  return `${who} enters — together`;
}

/** The programme-note feedback after a cue. */
export function feedbackLines(r: CueResult, e: CommittedEntry | undefined): string[] {
  const lines: string[] = [];
  const target = r.targetBpm !== undefined ? ` (target ${Math.round(r.targetBpm)})` : '';
  if (r.cause === 'metronome') {
    lines.push(`Count-in entry at ${tempoLabel(r.plannedBpm)}. No breath needed — try it with one.`);
    return lines;
  }
  if (r.cause === 'nod') {
    lines.push('A nod without a breath: the choir had to guess.');
    lines.push('Entry: ragged. Breathe in on the preparatory beat.');
    return lines;
  }
  if (r.beatSource === 'predicted') {
    lines.push(`Your breath set ${tempoLabel(r.plannedBpm)}${target} — ${qualityWord(r.quality)}.`);
  } else {
    lines.push(`Your breath timed the entry at ${tempoLabel(r.plannedBpm)}${target} — ${qualityWord(r.quality)}.`);
  }
  if (r.measuredBpm !== undefined) {
    lines.push(`It peaked at ${tempoLabel(r.measuredBpm)}.`);
  } else {
    lines.push('Peak tempo not measured.');
  }
  if (r.tooFast) lines.push('That was too fast to follow — the choir came in at once.');
  else if (e && e.quality !== 'tight') lines.push(capitalise(e.reason) + '.');
  return lines;
}

function capitalise(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
