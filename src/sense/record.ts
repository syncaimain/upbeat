// Numbers-only recorder. A recording is JSON lines: one header, then sense
// events in arrival order. No frames, no images, no audio — only the decoded
// numbers (traces, three landmarks, talking flags, validation codes) and the
// user's key presses, so a replay reproduces the same cues.

import type { ReplayHeader, SenseEvent } from './types';

export class Recorder {
  private readonly lines: string[] = [];
  private active = false;

  constructor(private header: ReplayHeader) {}

  start(header?: Partial<ReplayHeader>): void {
    if (header) this.header = { ...this.header, ...header };
    this.lines.length = 0;
    this.active = true;
  }

  get recording(): boolean {
    return this.active;
  }

  get eventCount(): number {
    return this.lines.length;
  }

  push(e: SenseEvent): void {
    if (!this.active) return;
    this.lines.push(JSON.stringify(compact(e)));
  }

  stop(): string {
    this.active = false;
    const body = [JSON.stringify(this.header), ...this.lines].join('\n') + '\n';
    this.lines.length = 0;
    return body;
  }
}

/** Round floats to keep files small (trace values to 6 significant digits,
 *  landmark pixels to 0.01). */
function compact(e: SenseEvent): unknown {
  if (e.kind !== 'metrics') return e;
  const f = e.frame;
  const r6 = (v: number) => Number(v.toPrecision(6));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    kind: 'metrics',
    recvUs: e.recvUs,
    frame: {
      tsUs: f.tsUs,
      landmarkCount: f.landmarkCount,
      chest: f.chest.map((s) => [s.t, r6(s.value), s.stable ? 1 : 0]),
      abdomen: f.abdomen.map((s) => [s.t, r6(s.value), s.stable ? 1 : 0]),
      rate: f.rate.map((s) => [s.t, r6(s.value), r6(s.confidence), s.stable ? 1 : 0]),
      talking: f.talking.map((s) => [s.t, s.detected ? 1 : 0]),
      head: f.head.map((h) => [h.t, r2(h.nose.x), r2(h.nose.y), r2(h.eyeR.x), r2(h.eyeR.y),
        r2(h.eyeL.x), r2(h.eyeL.y), h.stable ? 1 : 0, h.reset ? 1 : 0]),
    },
  };
}
