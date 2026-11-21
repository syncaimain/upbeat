// Privacy and SDK-usage guarantees that can be checked without a camera.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { redact } from '../../electron/redact';
import { REQUESTED_METRICS, sdkOptions } from '../../src/sense/sdk';
import { decodeFrame } from '../../src/sense/decode';
import { Recorder } from '../../src/sense/record';
import { computeVoiceTimes, MIN_SCHEDULE_AHEAD_S } from '../../src/sound/scheduler';
import { chordFor, noteToHz } from '../../src/sound/voicing';
import { synthHeader } from '../../fixtures/synth';
import { us } from '../../src/engine/timing/units';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|svelte)$/.test(f) ? [p] : [];
  });
}
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const all = [...sources('src'), ...sources('electron')].map((p) => ({ p, c: code(p) }));

describe('SDK usage', () => {
  test('telemetry is off and only breathing, landmarks and talking are requested', () => {
    const o = sdkOptions('test-key');
    expect(o.enableTelemetry).toBe(false);
    expect([...REQUESTED_METRICS].sort((a, b) => a - b)).toEqual([0, 1, 2, 11, 13]);
    // Never the metrics that make start() fail, nor cardio/blinking/expressions.
    for (const bad of [3, 4, 5, 6, 7, 12, 14, 15, 16, 17]) expect(REQUESTED_METRICS).not.toContain(bad);
  });

  test('every SmartSpectraSDK constructed in the app turns telemetry off', () => {
    for (const { p, c } of all) {
      for (const m of c.matchAll(/new\s+(?:sdkMod\.)?SmartSpectraSDK\(([\s\S]*?)\)\s*;/g)) {
        const arg = m[1]!;
        expect(arg.includes('enableTelemetry: false') || arg.includes('sdkOptions('), `${p}: ${arg.slice(0, 80)}`).toBe(true);
      }
    }
  });

  test('requestInsight is never called', () => {
    for (const { p, c } of all) expect(/\.requestInsight\s*\(/.test(c), p).toBe(false);
  });

  test('the microphone is never requested', () => {
    for (const { p, c } of all) {
      expect(/audio\s*:\s*true/.test(c), p).toBe(false);
      if (c.includes('getUserMedia(')) expect(c, p).toMatch(/audio:\s*false/);
    }
  });
});

describe('the API key stays out of logs and renderer storage', () => {
  test('redact removes the key and apiKey-shaped values', () => {
    const key = 'sk_live_ABCDEF123456';
    expect(redact(`failed with ${key} at start`, key)).not.toContain(key);
    expect(redact('{"apiKey":"zzz-secret-zzz"}', null)).not.toContain('zzz-secret-zzz');
    expect(redact('api_key=hunter22', null)).toContain('[redacted]');
  });

  test('renderer code never writes the key to storage', () => {
    for (const { p, c } of all.filter((x) => x.p.startsWith('src'))) {
      expect(/localStorage|sessionStorage|indexedDB/.test(c), p).toBe(false);
    }
  });

  test('recordings contain numbers only: three landmarks, no full mesh, no frames', () => {
    const rec = new Recorder(synthHeader('t'));
    rec.start();
    const pts = Array.from({ length: 478 }, (_, i) => ({ x: i, y: i }));
    const frame = decodeFrame({ face: { landmarks: [{ value: pts, timestamp: 5, stable: true }] } }, 5, { frameW: 1280, frameH: 720, keepAll: true });
    expect(frame.allLandmarks).toHaveLength(478);
    rec.push({ kind: 'metrics', recvUs: us(6), frame });
    const line = rec.stop().split('\n')[1]!;
    expect(line).not.toContain('allLandmarks');
    expect(JSON.parse(line).frame.head[0]).toHaveLength(9);
  });
});

describe('decode', () => {
  test('camelCase fields, Long-like timestamps, normalised landmarks scaled to pixels', () => {
    const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const f = decodeFrame({
      breathing: {
        upperTrace: [{ value: 1.5, stable: true, timestamp: { toNumber: () => 1000 } }, { value: NaN, timestamp: 2000 }],
        lowerTrace: [{ value: 2, stable: false, timestamp: 1000 }],
        rate: [{ value: 14, confidence: 50, stable: true, timestamp: 1000 }],
      },
      face: { talking: [{ detected: true, timestamp: 1000 }], landmarks: [{ value: pts, timestamp: 1000 }] },
    }, 1000, { frameW: 1280, frameH: 720 });
    expect(f.chest).toEqual([{ t: 1000, value: 1.5, stable: true }]);
    expect(f.abdomen[0]!.stable).toBe(false);
    expect(f.rate[0]!.confidence).toBe(50);
    expect(f.talking[0]!.detected).toBe(true);
    expect(f.head[0]!.nose).toEqual({ x: 640, y: 360 });
    expect(f.landmarkCount).toBe(478);
  });
  test('a short landmark set yields no head points (keyboard Ready still works)', () => {
    const f = decodeFrame({ face: { landmarks: [{ value: [{ x: 1, y: 1 }], timestamp: 1 }] } }, 1, { frameW: 1, frameH: 1 });
    expect(f.head).toHaveLength(0);
  });
});

describe('scheduler maths', () => {
  test('voice times = downbeat + offsets; late voices are pulled to now', () => {
    const r = computeVoiceTimes(10, [0, 12, -8], 9);
    expect(r.times).toEqual([10, 10.012, 9.992]);
    expect(r.late).toBe(0);
    const late = computeVoiceTimes(10, [0, -50], 9.98);
    expect(late.times[1]).toBeCloseTo(9.98 + MIN_SCHEDULE_AHEAD_S, 9);
    expect(late.late).toBeGreaterThan(0);
  });
  test('voicings and tuning', () => {
    expect(noteToHz('A4')).toBe(440);
    expect(noteToHz('C4')).toBeCloseTo(261.626, 2);
    expect(chordFor('choir', 'open')).toHaveLength(8);
    expect(chordFor('quartet', 'close')).toHaveLength(4);
  });
});
