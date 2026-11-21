// Converts the downloaded VSCO 2 Community Edition (CC0) WAV files into small
// mono Ogg Vorbis files under static/samples/<instrument>/<note>.ogg.
//
// Usage: node scripts/prepare-samples.mjs <folder-with-downloaded-wavs>
//
// The downloads are named <inst>_<fileNote>.wav (vln_G3.wav, vla_C2.wav ...).
// VSCO's section folders use an octave numbering that is not always the
// scientific one, so every file's fundamental is measured (autocorrelation on
// the decoded audio) and the note name is taken from the measurement, not the
// file name. Requires ffmpeg on PATH.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/prepare-samples.mjs <wav-folder>');
  process.exit(1);
}
const out = resolve('static/samples');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const INST = { vln: 'violin', vla: 'viola', vc: 'cello' };

function decode(file) {
  // 1.0–2.0 s into the note: past the attack, inside the sustain.
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.0', '-t', '1.0', '-i', file,
    '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Normalised autocorrelation pitch estimate in Hz (40–2000 Hz). */
function pitch(x) {
  const sr = 44100;
  const minLag = Math.floor(sr / 2000);
  const maxLag = Math.floor(sr / 40);
  const n = Math.min(x.length - maxLag, 16384);
  let best = 0;
  let bestLag = 0;
  const r = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) {
      s += x[i] * x[i + lag];
      e1 += x[i] * x[i];
      e2 += x[i + lag] * x[i + lag];
    }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  // First lag whose correlation is within 7% of the global maximum: avoids
  // picking a sub-octave (2x lag) peak.
  for (let lag = minLag; lag <= maxLag; lag++) if (r[lag] > best) best = r[lag];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] >= best * 0.93 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { bestLag = lag; break; }
  }
  // Parabolic interpolation around the peak.
  const a = r[bestLag - 1], b = r[bestLag], c = r[bestLag + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (bestLag + shift);
}

function noteName(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const cents = Math.round(100 * (69 + 12 * Math.log2(hz / 440) - midi));
  return { name: NAMES[midi % 12] + (Math.floor(midi / 12) - 1), midi, cents };
}

const report = [];
for (const f of readdirSync(src).filter((f) => f.endsWith('.wav')).sort()) {
  const [inst, fileNote] = f.replace('.wav', '').split('_');
  const hz = pitch(decode(join(src, f)));
  const n = noteName(hz);
  const dir = join(out, INST[inst]);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${n.name.replace('#', 's')}.ogg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(src, f), '-ac', '1', '-ar', '44100',
    '-af', 'atrim=0:5,afade=t=out:st=4.2:d=0.8', '-c:a', 'libvorbis', '-q:a', '4', dest]);
  report.push({ file: f, fileNote, measuredHz: +hz.toFixed(1), note: n.name, cents: n.cents });
  console.log(`${f.padEnd(14)} file says ${fileNote.padEnd(3)} measured ${hz.toFixed(1)} Hz -> ${n.name} (${n.cents} c)`);
}
writeFileSync(join(out, 'samples.json'), JSON.stringify(report, null, 2) + '\n');
try { copyFileSync(join(src, 'LICENSE.txt'), join(out, 'LICENSE-VSCO2-CE-CC0.txt')); } catch { /* optional */ }
