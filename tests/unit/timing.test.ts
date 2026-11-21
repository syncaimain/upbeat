import { describe, expect, test } from 'vitest';
import { ClockMap } from '../../src/engine/timing/clocks';
import { DelayStats, quantile } from '../../src/engine/timing/delay';
import { bpmToBeat, beatToBpm, ms, msToUs, sec, secToMs, us, usToMs, usToSec } from '../../src/engine/timing/units';

describe('units', () => {
  test('conversions keep magnitude', () => {
    expect(usToMs(us(1500))).toBe(1.5);
    expect(usToSec(us(2_500_000))).toBe(2.5);
    expect(msToUs(ms(3))).toBe(3000);
    expect(secToMs(sec(0.25))).toBe(250);
    expect(beatToBpm(bpmToBeat(84))).toBeCloseTo(84, 10);
  });
});

describe('ClockMap', () => {
  const src = { perf: 1000, date: 1_790_000_000_000 };
  const clock = () => new ClockMap({ perfNow: () => src.perf, dateNow: () => src.date });

  test('SDK µs ⇄ performance.now round trip', () => {
    const c = clock();
    const sdk = us(1_790_000_000_500_000); // 500 ms after "now"
    expect(c.sdkToPerf(sdk)).toBeCloseTo(1500, 6);
    expect(c.perfToSdk(c.sdkToPerf(sdk))).toBeCloseTo(sdk, 0);
    expect(c.nowUs()).toBeCloseTo(1_790_000_000_000_000, 0);
  });

  test('perf ⇄ audio via output timestamp', () => {
    const c = clock();
    c.setAudioStamp({ contextTime: 10, performanceTime: 900 });
    expect(c.perfToAudio(ms(1400))).toBeCloseTo(10.5, 9);
    expect(c.audioToPerf(sec(11))).toBeCloseTo(1900, 9);
    const sdk = us(1_790_000_000_250_000);
    expect(c.audioToSdk(c.sdkToAudio(sdk))).toBeCloseTo(sdk, 0);
  });

  test('epoch offset refresh ignores clock steps and smooths slews', () => {
    const c = clock();
    src.date += 5000; // NTP step
    c.refreshEpochOffset();
    expect(c.nowUs()).toBeCloseTo(1_790_000_000_000_000, 0);
    src.date -= 5000;
    src.date += 10; // slew
    c.refreshEpochOffset();
    expect(c.nowUs()).toBeCloseTo((1_790_000_000_000 + 1) * 1000, 0);
  });
});

describe('DelayStats', () => {
  test('median and p95', () => {
    const d = new DelayStats();
    for (let i = 1; i <= 100; i++) d.add(us(i * 1000 + 5_000_000), us(5_000_000));
    const s = d.summary();
    expect(s.count).toBe(100);
    expect(s.medianMs).toBeCloseTo(50.5, 6);
    expect(s.p95Ms).toBeCloseTo(95.05, 6);
    expect(quantile([], 0.5)).toBeNaN();
  });
});
