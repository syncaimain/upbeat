// Framing check for the camera mirror: is the face centred and at a good
// distance, and is the chest (estimated from the face) inside the picture?
// SmartSpectra's own validation codes override the estimate when present.
//
// All positions are in the DISPLAYED (mirrored) picture, so "move right"
// means: move toward the right of what you see, as in a mirror.

import type { HeadPoints } from './types';

/** Validation codes (node-sdk 3.5.0) relevant to framing. */
const VC = { ok: 0, noFace: 1, notCentered: 3, chestNotVisible: 7, tooClose: 13, tooFar: 14, tooHigh: 15, tooLow: 16 } as const;

/** Target zone, as fractions of the frame. */
export const FRAME_TARGET = {
  /** Face centre. */
  cx: 0.5,
  cy: 0.34,
  /** Allowed offset of the face centre before it counts as off-centre. */
  tolX: 0.07,
  tolY: 0.08,
  /** Face width as a fraction of frame width: good range. At ~1 m from a
   *  ~70° webcam a face is ≈ 11 % of the frame width. */
  minWidth: 0.07,
  maxWidth: 0.17,
  idealWidth: 0.11,
  /** Chest band (fractions of frame height). */
  chestY: 0.8,
  chestH: 0.16,
} as const;

/** Face width ≈ outer-eye distance × this (anthropometric). */
const FACE_PER_EYE = 2.2;
/** Face height ≈ face width × this. */
const FACE_ASPECT = 1.35;
/** Chest centre ≈ face centre + this many face heights (≈ 30 cm below). */
const CHEST_BELOW = 1.5;

export type Check = 'ok' | 'off' | 'unknown';

export interface Framing {
  readonly face: Check;
  readonly distance: Check;
  readonly chest: Check;
  /** Tracked face in displayed coordinates (pixels), if any. */
  readonly faceAt?: { x: number; y: number; w: number; h: number };
  /** Estimated chest centre y (pixels). */
  readonly chestAt?: number;
  readonly hints: readonly string[];
  readonly allOk: boolean;
}

/** One short instruction for the person (the most important fix first). */
export function framingInstruction(f: Framing): string {
  if (f.allOk) return '✓ Good — hold still';
  if (f.face === 'unknown') return 'Sit in front of the camera';
  const h = f.hints.join(' ');
  if (/closer/.test(h)) return 'Come a little closer';
  if (/Move back|chest needs/.test(h)) return 'Move back a little';
  if (/to your right/.test(h)) return 'Move right →';
  if (/to your left/.test(h)) return '← Move left';
  if (/high in the picture/.test(h)) return 'Tilt the camera up';
  if (/low in the picture|chest is below|cannot see your chest/.test(h)) return 'Tilt the camera down';
  return f.hints[0] ?? 'Adjust your position';
}

export function assessFraming(head: HeadPoints | null, w: number, h: number, validationCode = 0): Framing {
  const hints: string[] = [];
  if (!head) {
    return { face: 'unknown', distance: 'unknown', chest: 'unknown', hints: validationCode === VC.noFace ? ['No face found — sit in front of the camera.'] : ['Looking for your face…'], allOk: false };
  }
  const eye = Math.hypot(head.eyeL.x - head.eyeR.x, head.eyeL.y - head.eyeR.y);
  const fw = eye * FACE_PER_EYE;
  const fh = fw * FACE_ASPECT;
  const midX = (head.eyeL.x + head.eyeR.x) / 2;
  const midY = (head.eyeL.y + head.eyeR.y) / 2;
  // Face centre sits a little below the eye line; mirror x for display.
  const x = w - midX;
  const y = midY + fh * 0.12;
  const T = FRAME_TARGET;

  const dx = x / w - T.cx;
  const dy = y / h - T.cy;
  let face: Check = Math.abs(dx) <= T.tolX && Math.abs(dy) <= T.tolY ? 'ok' : 'off';
  if (dx < -T.tolX) hints.push('Move a little to your right.');
  else if (dx > T.tolX) hints.push('Move a little to your left.');
  if (dy < -T.tolY) hints.push('Your face is high in the picture — tilt the camera up slightly.');
  else if (dy > T.tolY) hints.push('Your face is low in the picture — tilt the camera down slightly (or raise it).');

  const rel = fw / w;
  let distance: Check = rel < T.minWidth ? 'off' : rel > T.maxWidth ? 'off' : 'ok';
  if (rel < T.minWidth) hints.push('Come a little closer.');
  else if (rel > T.maxWidth) hints.push('Move back a little — your chest needs to be in view too.');

  const chestAt = y + fh * CHEST_BELOW;
  let chest: Check = chestAt + fh * 0.4 <= h ? 'ok' : 'off';
  if (chest === 'off' && rel <= T.maxWidth) hints.push('Your chest is below the picture — tilt the camera down or move back.');

  // SmartSpectra's verdicts win.
  switch (validationCode) {
    case VC.notCentered: face = 'off'; break;
    case VC.tooHigh: face = 'off'; break;
    case VC.tooLow: face = 'off'; break;
    case VC.tooClose: distance = 'off'; break;
    case VC.tooFar: distance = 'off'; break;
    case VC.chestNotVisible: chest = 'off'; if (!hints.some((t) => t.includes('chest'))) hints.push('SmartSpectra cannot see your chest — move back or tilt the camera down.'); break;
  }
  const allOk = face === 'ok' && distance === 'ok' && chest === 'ok';
  return { face, distance, chest, faceAt: { x, y, w: fw, h: fh }, chestAt, hints: allOk ? ['Framing is good — hold this position.'] : hints, allOk };
}
