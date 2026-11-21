// Converts a decoded SmartSpectra Metrics message into a SenseFrame.
//
// Verified against @smartspectra/node-sdk 3.5.0 js/messages/generated.d.ts:
// decoded fields are camelCase — breathing.upperTrace (chest),
// breathing.lowerTrace (abdomen), breathing.rate (with confidence),
// face.landmarks[].value (Point2dFloat[]), face.talking[] (DetectionStatus).
// Timestamps are epoch microseconds, typed number | Long.
//
// Only three landmarks are kept (nose tip and outer eye corners): that is all
// the head-pitch estimate needs, and it keeps recordings small and free of a
// full face mesh.

import { CUE } from '../../config/cue';
import { us, type Microseconds } from '../engine/timing/units';
import type { HeadPoints, Point2, RateSample, TalkingSample, TraceSample } from '../engine/types';
import type { SenseFrame } from './types';

type LongLike = number | { toNumber(): number } | null | undefined;

/** The structural subset of presage.smartspectra.IMetrics we read. */
export interface MetricsLike {
  breathing?: {
    rate?: Array<{ value?: number | null; confidence?: number | null; stable?: boolean | null; timestamp?: LongLike }> | null;
    upperTrace?: Array<{ value?: number | null; stable?: boolean | null; timestamp?: LongLike }> | null;
    lowerTrace?: Array<{ value?: number | null; stable?: boolean | null; timestamp?: LongLike }> | null;
  } | null;
  face?: {
    talking?: Array<{ detected?: boolean | null; stable?: boolean | null; timestamp?: LongLike }> | null;
    landmarks?: Array<{ value?: Array<{ x?: number | null; y?: number | null }> | null; stable?: boolean | null; reset?: boolean | null; timestamp?: LongLike }> | null;
  } | null;
}

export function toNum(t: LongLike): number {
  if (t === null || t === undefined) return NaN;
  if (typeof t === 'number') return t;
  return t.toNumber();
}

export interface DecodeOptions {
  /** Capture frame size, used when landmarks arrive normalised to 0..1. */
  frameW: number;
  frameH: number;
  /** Stage 1 probe only: keep the full newest landmark set. */
  keepAll?: boolean;
}

type TraceArr = Array<{ value?: number | null; stable?: boolean | null; timestamp?: LongLike }> | null | undefined;

function traces(arr: TraceArr): TraceSample[] {
  const out: TraceSample[] = [];
  for (const m of arr ?? []) {
    const t = toNum(m.timestamp);
    const v = m.value;
    if (!Number.isFinite(t) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push({ t: us(t), value: v, stable: m.stable === true });
  }
  return out;
}

function point(p: { x?: number | null; y?: number | null } | undefined, sx: number, sy: number): Point2 | null {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return { x: p.x * sx, y: p.y * sy };
}

export function decodeFrame(m: MetricsLike, packetTs: number, o: DecodeOptions): SenseFrame {
  const chest = traces(m.breathing?.upperTrace);
  const abdomen = traces(m.breathing?.lowerTrace);
  const rate: RateSample[] = [];
  for (const r of m.breathing?.rate ?? []) {
    const t = toNum(r.timestamp);
    if (!Number.isFinite(t) || typeof r.value !== 'number') continue;
    rate.push({ t: us(t), value: r.value, confidence: r.confidence ?? 0, stable: r.stable === true });
  }
  const talking: TalkingSample[] = [];
  for (const s of m.face?.talking ?? []) {
    const t = toNum(s.timestamp);
    if (!Number.isFinite(t)) continue;
    talking.push({ t: us(t), detected: s.detected === true });
  }
  const head: HeadPoints[] = [];
  let landmarkCount = 0;
  let allLandmarks: { x: number; y: number }[] | undefined;
  for (const lm of m.face?.landmarks ?? []) {
    const pts = lm.value ?? [];
    landmarkCount = pts.length;
    if (o.keepAll) allLandmarks = pts.map((p) => ({ x: p.x ?? NaN, y: p.y ?? NaN }));
    const t = toNum(lm.timestamp);
    if (!Number.isFinite(t) || pts.length <= Math.max(CUE.LANDMARK_EYE_L, CUE.LANDMARK_EYE_R, CUE.LANDMARK_NOSE)) continue;
    // Normalised coordinates (all within ~0..1) are scaled to pixels so x
    // and y share units; pixel coordinates are used as-is.
    const sample = pts[CUE.LANDMARK_NOSE];
    const normalised = sample && Math.abs(sample.x ?? 0) <= 1.5 && Math.abs(sample.y ?? 0) <= 1.5;
    const sx = normalised ? o.frameW : 1;
    const sy = normalised ? o.frameH : 1;
    const nose = point(pts[CUE.LANDMARK_NOSE], sx, sy);
    const eyeR = point(pts[CUE.LANDMARK_EYE_R], sx, sy);
    const eyeL = point(pts[CUE.LANDMARK_EYE_L], sx, sy);
    if (!nose || !eyeR || !eyeL) continue;
    head.push({ t: us(t), nose, eyeR, eyeL, stable: lm.stable !== false, reset: lm.reset === true });
  }
  return { tsUs: us(packetTs) as Microseconds, chest, abdomen, rate, head, talking, landmarkCount, ...(allLandmarks ? { allLandmarks } : {}) };
}
