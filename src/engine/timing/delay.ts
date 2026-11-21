// Delivery delay = receipt time − SDK timestamp, both in the SDK (epoch µs)
// domain. Measured for the newest chest-trace sample in each metrics packet
// (how stale the freshest data is when it arrives) and, separately, for every
// new sample (includes samples that were already old when their packet
// was built).

import { ms, type Microseconds, type Milliseconds } from './units';

export interface DelaySummary {
  readonly count: number;
  readonly medianMs: Milliseconds;
  readonly p95Ms: Milliseconds;
  readonly minMs: Milliseconds;
  readonly maxMs: Milliseconds;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export class DelayStats {
  private readonly values: number[] = [];

  constructor(private readonly capacity = 5000) {}

  add(receivedAt: Microseconds, sampleAt: Microseconds): void {
    const d = (receivedAt - sampleAt) / 1000;
    if (!Number.isFinite(d)) return;
    this.values.push(d);
    if (this.values.length > this.capacity) this.values.shift();
  }

  clear(): void {
    this.values.length = 0;
  }

  get count(): number {
    return this.values.length;
  }

  summary(): DelaySummary {
    const s = [...this.values].sort((a, b) => a - b);
    return {
      count: s.length,
      medianMs: ms(quantile(s, 0.5)),
      p95Ms: ms(quantile(s, 0.95)),
      minMs: ms(s[0] ?? NaN),
      maxMs: ms(s[s.length - 1] ?? NaN),
    };
  }
}
