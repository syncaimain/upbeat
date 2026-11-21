// Walkthrough, step 2: narration + subtitles over the capture.
//
//   node scripts/walkthrough/compose.mjs <capture-dir> <model-dir> <out.mp4> [python]
//
// Narration lines are anchored to the caption events logged by capture.mjs,
// voiced by Kokoro-82M (narrate.py, offline), mixed over the app's own audio
// (ducked), and burned in as subtitles. The capture itself is not cut.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cap = resolve(process.argv[2]);
const modelDir = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? 'walkthrough.mp4');
const python = process.argv[5] ?? 'python';
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const dur = (f) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).trim());

const events = JSON.parse(readFileSync(join(cap, 'events.json'), 'utf8'));
const at = (re, n = 1, lead = 0) => {
  const hits = events.filter((e) => re.test(e.text));
  const e = hits[n - 1];
  if (!e) throw new Error(`no event ${re} #${n}`);
  return Math.max(0, e.t - lead);
};

// Narration: honest about what is on screen (a replay of synthetic numbers).
const LINES = [
  { id: 'n01', t: at(/^#welcome$/) - 0.4, text: 'Upbeat is a practice room for conductors and ensemble leaders: a virtual choir that comes in on your breath, at the tempo your breath sets.' },
  { id: 'n02', t: at(/^#replay-start$/) + 0.8, text: 'This walkthrough replays the session that ships with the app: scripted, synthetic breathing numbers, run through the same engine the live camera feeds. The live demo is a separate video.' },
  { id: 'n03', t: at(/^#replay-start$/) + 14, text: 'With a camera, Presage SmartSpectra reads the breathing motion of your chest, your head position, and whether you are talking. Breathing takes about thirty seconds to settle. The brass arc follows the chest.' },
  { id: 'n04', t: at(/enters — together/, 1, 3.6), text: 'Lift your chin, or press R, and the singers straighten. One slow, full breath, and they enter on the downbeat, together, at that tempo.' },
  { id: 'n05', t: at(/enters — together/, 2, 1.8), text: 'A quicker breath sets a quicker tempo. The note shows the tempo the breath set, and the tempo measured at its peak.' },
  { id: 'n06', t: at(/enters ragged/, 1, 1.0), text: 'A nod with no breath: the singers have to guess, and two come in late. That ragged entry is the lesson.' },
  { id: 'n07', t: at(/enters ragged/, 2, 0.8), text: 'A shallow breath is still ragged.' },
  { id: 'n08', t: at(/releases on your cue/, 1, 1.8), text: 'Breathe out and drop your head, and they finish together.' },
  { id: 'n09', t: at(/Ready cancelled — talking/, 1, 1.2), text: 'Talking cancels the cue. Upbeat never uses the microphone; the camera sees you talk.' },
  { id: 'n10', t: at(/ensemble pauses/, 1, 0.6), text: 'If the camera loses you, the choir waits. Nothing is guessed from missing data.' },
  { id: 'n11', t: at(/^Count 1$/, 1, 0.8), text: 'Metronome mode gives a count-in entry, with no breath and no camera.' },
  { id: 'n12', t: at(/^#privacy$/) + 0.3, text: 'Only numbers are kept: a tempo profile and drill scores, and you can delete them. No microphone, and telemetry is off. Upbeat is built on Presage SmartSpectra.' },
];

const voiceDir = join(cap, 'voice');
writeFileSync(join(cap, 'lines.json'), JSON.stringify(LINES.map(({ id, text }) => ({ id, text }))));
console.log(sh(python, [join(here, 'narrate.py'), join(cap, 'lines.json'), voiceDir, modelDir]).trim());

// Place clips: never overlap — a line starts at its anchor or right after
// the previous line, whichever is later.
let cursor = 0;
const placed = LINES.map((l) => {
  const d = dur(join(voiceDir, `${l.id}.wav`));
  const start = Math.max(l.t, cursor + 0.25);
  cursor = start + d;
  return { ...l, start, end: start + d };
});
const capture = ['mp4', 'webm'].map((e) => join(cap, `capture.${e}`)).find((f) => { try { readFileSync(f, { flag: 'r' }); return true; } catch { return false; } });
const total = dur(capture);
if (cursor > total) console.warn(`narration runs ${(cursor - total).toFixed(1)} s past the capture; the last frame is held.`);

// Subtitles (SRT), burned in.
const ts = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const wrap = (t) => {
  const words = t.split(' '); const rows = ['']; for (const w of words) { if ((rows[rows.length - 1] + ' ' + w).trim().length > 90) rows.push(w); else rows[rows.length - 1] = (rows[rows.length - 1] + ' ' + w).trim(); } return rows.join('\n');
};
writeFileSync(join(cap, 'narration.srt'), placed.map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end + 0.3)}\n${wrap(l.text)}\n`).join('\n'));

// Mix: app audio ducked to 55 %, each narration clip delayed to its start.
const inputs = ['-i', capture, ...placed.flatMap((l) => ['-i', join(voiceDir, `${l.id}.wav`)])];
const delays = placed.map((l, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(l.start * 1000)}:all=1[v${i}]`).join(';');
const mix = `[0:a]aresample=48000,volume=0.55[app];${delays};[app]${placed.map((_, i) => `[v${i}]`).join('')}amix=inputs=${placed.length + 1}:duration=longest:normalize=0,alimiter=limit=0.89[a]`;
const srt = join(cap, 'narration.srt').replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const pad = Math.max(0, cursor + 1.5 - total);
const video = `[0:v]scale=1920:1080:flags=lanczos,fps=30${pad ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}` : ''},subtitles='${srt}':force_style='FontName=Arial,FontSize=11,PrimaryColour=&H00F3E9D2,OutlineColour=&H00140C10,BorderStyle=3,Outline=1,Shadow=0,MarginV=14'[v]`;
sh('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${video};${mix}`, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
console.log(`wrote ${out} (${dur(out).toFixed(1)} s)`);
