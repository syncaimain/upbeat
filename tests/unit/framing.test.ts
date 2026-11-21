import { describe, expect, test } from 'vitest';
import { assessFraming, FRAME_TARGET } from '../../src/engine/framing';
import { us } from '../../src/engine/timing/units';

const W = 1280, H = 720;
/** Face whose displayed centre is at (fx, fy) (fractions) with face width fw (fraction). */
function face(fx: number, fy: number, fw: number) {
  const eye = (fw * W) / 2.2;
  const fh = fw * W * 1.35;
  const midY = fy * H - fh * 0.12;
  const midX = W - fx * W; // camera coordinates are un-mirrored
  return { t: us(0), stable: true, reset: false, eyeR: { x: midX - eye / 2, y: midY }, eyeL: { x: midX + eye / 2, y: midY }, nose: { x: midX, y: midY + eye * 0.6 } };
}

describe('framing', () => {
  test('centred, good distance, chest in view → all ok', () => {
    const f = assessFraming(face(FRAME_TARGET.cx, FRAME_TARGET.cy, 0.11), W, H);
    expect(f.allOk).toBe(true);
    expect(f.hints[0]).toMatch(/good/);
  });
  test('directions are as seen in the mirror', () => {
    expect(assessFraming(face(0.3, 0.34, 0.11), W, H).hints.join()).toMatch(/to your right/);
    expect(assessFraming(face(0.7, 0.34, 0.11), W, H).hints.join()).toMatch(/to your left/);
  });
  test('too close and too far', () => {
    expect(assessFraming(face(0.5, 0.34, 0.3), W, H).distance).toBe('off');
    expect(assessFraming(face(0.5, 0.34, 0.05), W, H).hints.join()).toMatch(/closer/);
  });
  test('face low in the picture pushes the chest out of frame', () => {
    const f = assessFraming(face(0.5, 0.6, 0.11), W, H);
    expect(f.face).toBe('off');
    expect(f.chest).toBe('off');
  });
  test("SmartSpectra's chest-not-visible verdict overrides the estimate", () => {
    const f = assessFraming(face(0.5, 0.34, 0.11), W, H, 7);
    expect(f.chest).toBe('off');
    expect(f.allOk).toBe(false);
  });
  test('no face', () => {
    expect(assessFraming(null, W, H, 1).hints[0]).toMatch(/No face/);
  });
});

import { framingInstruction } from '../../src/engine/framing';
describe('framing instruction', () => {
  test('one short instruction', () => {
    expect(framingInstruction(assessFraming(face(0.5, 0.34, 0.11), W, H))).toMatch(/Good/);
    expect(framingInstruction(assessFraming(face(0.3, 0.34, 0.11), W, H))).toBe('Move right →');
    expect(framingInstruction(assessFraming(face(0.5, 0.34, 0.3), W, H))).toBe('Move back a little');
    expect(framingInstruction(assessFraming(null, W, H))).toMatch(/Sit in front/);
  });
});
