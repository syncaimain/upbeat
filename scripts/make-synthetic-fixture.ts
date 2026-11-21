// Builds static/fixtures/demo-session.jsonl: the bundled "Hear a recorded
// session" replay, so the app can be tried without a camera or API key.
//
// IT IS SYNTHETIC. The header says `synthetic: true` and the app's banner
// says "replay — synthetic demo numbers, not a recording". Replace it with a
// real recording from the Stage 1 probe (Settings → Record numbers) and the
// banner changes to "replay — recorded numbers".

import { mkdirSync, writeFileSync } from 'node:fs';
import { calibrate, trialTiming } from '../src/engine/calibration';
import { us } from '../src/engine/timing/units';
import { Recorder } from '../src/sense/record';
import { calibrationScript, synthesize, synthHeader, SYNTH_EPOCH_US, type Script } from '../fixtures/synth';

// 1. A synthetic calibration session gives the profile the replay uses.
const restFrom = 32, restTo = 52;
const cs = calibrationScript(restTo + 1);
const calSyn = synthesize({ durationS: cs.trialStarts.at(-1)!.at + 10, seed: 3, script: cs.script });
const T = (s: number) => us(SYNTH_EPOCH_US + s * 1e6);
const cal = calibrate({
  chest: calSyn.chest, head: calSyn.head, restFrom: T(restFrom), restTo: T(restTo),
  trials: cs.trialStarts.map((t) => trialTiming(T(t.at), t.bpm)), now: new Date(SYNTH_EPOCH_US / 1000),
});
if (!cal.profile) throw new Error(`calibration failed: ${cal.message}`);

// 2. The demo: warm-up, then a story of cues.
const script: Script[] = [
  // a slow, full breath → together at a slow tempo
  { kind: 'key', at: 34.0, key: 'ready' }, { kind: 'prep', at: 35.0, beatS: 60 / 66, depth: 2.3 },
  // a quick breath → together at a fast tempo
  { kind: 'key', at: 41.5, key: 'ready' }, { kind: 'prep', at: 42.5, beatS: 60 / 112, depth: 2.2 },
  // head lift and nod, no breath → ragged
  { kind: 'lift', at: 49.0, deg: 10, holdS: 1.3 },
  // a shallow breath → ragged
  { kind: 'key', at: 56.0, key: 'ready' }, { kind: 'prep', at: 57.0, beatS: 0.62, depth: 1.0 },
  // a chin-lift Ready, then a full breath at the target
  { kind: 'lift', at: 63.0, deg: 9, holdS: 3.0, dropAfterS: 3.0 }, { kind: 'prep', at: 63.8, beatS: 60 / 72, depth: 2.4 },
  // talking while Ready → nothing
  { kind: 'key', at: 71.0, key: 'ready' }, { kind: 'talk', at: 71.3, durS: 3.0 },
  // the lens is covered → the scene pauses
  { kind: 'cover', at: 77.0, durS: 4.0 },
  // count-in entry (Space) with no breath
  { kind: 'key', at: 84.0, key: 'metronome' },
  // and one more breath-cued entry
  { kind: 'key', at: 92.0, key: 'ready' }, { kind: 'prep', at: 93.0, beatS: 60 / 90, depth: 2.2 },
];
const syn = synthesize({ durationS: 102, seed: 12, script });
const rec = new Recorder(synthHeader(
  'Synthetic demo: modelled breathing (not a recording) — slow and fast cues, a nod, a shallow breath, talking, a covered lens, a count-in.',
  { profile: cal.profile, targetBpm: 72, ensemble: 'choir' },
));
rec.start();
for (const e of syn.events) rec.push(e);
mkdirSync('static/fixtures', { recursive: true });
writeFileSync('static/fixtures/demo-session.jsonl', rec.stop());
console.log(`wrote static/fixtures/demo-session.jsonl (${syn.events.length} events); profile k=${cal.profile.k.toFixed(3)} fit=${(cal.profile.fitError * 100).toFixed(1)}%`);
