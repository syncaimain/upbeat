// Walkthrough, step 1: screenshots + a screen-and-audio capture of the app
// replaying its bundled session (no camera, no API key).
//
//   npm run build && node scripts/walkthrough/capture.mjs <out-dir>
//
// Writes <out-dir>/shots/*.png, <out-dir>/capture.mp4|webm and
// <out-dir>/events.json (caption text with times, for narration timing).
// Capture permissions are granted here, in the harness only — the app itself
// never captures the screen.

import { _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'walkthrough-capture');
const shots = join(out, 'shots');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A neutral data folder, so the Privacy panel (which shows the path) does not
// reveal the local user name in screenshots or the video.
const dataRoot = process.env.PUBLIC ?? tmpdir();

async function launch() {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, UPBEAT_E2E: '1', UPBEAT_NO_DOTENV: '1', SMARTSPECTRA_API_KEY: '', UPBEAT_USER_DATA: mkdtempSync(join(dataRoot, 'upbeat-wt-')) },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="enter-hall"]');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1600, 900);
    w.center();
  });
  await sleep(800);
  return { app, page };
}

// ── 1. Screenshots ────────────────────────────────────────────────────────
{
  const { app, page } = await launch();
  const shot = (n) => page.screenshot({ path: join(shots, `${n}.png`) });
  await shot('01-welcome');
  await page.getByTestId('enter-hall').click();
  await page.getByTestId('consent').waitFor();
  await sleep(500);
  await shot('02-consent');
  await page.getByTestId('consent-agree').click();
  await page.getByTestId('setup').waitFor();
  await sleep(500);
  await shot('03-setup');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForSelector('[data-testid="hear-replay"]');
  await page.getByTestId('hear-replay').click();
  const waitCaption = (re, ms) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid="captions"]')?.textContent ?? ''), re.source, { timeout: ms });
  await waitCaption(/enters — together/, 60_000);
  await sleep(700);
  await shot('04-entry-together');
  await page.waitForFunction(() => /set ♩/.test(document.querySelector('[data-testid="feedback"]')?.textContent ?? ''), null, { timeout: 15_000 });
  await sleep(300);
  await shot('05-feedback');
  await waitCaption(/ragged/, 40_000);
  await sleep(700);
  await shot('06-entry-ragged');
  await page.getByTestId('pause-note').waitFor({ timeout: 45_000 });
  await sleep(600);
  await shot('07-paused-camera-covered');
  await page.getByTestId('pause-note').waitFor({ state: 'hidden', timeout: 20_000 });
  await page.keyboard.press('h');
  await page.getByTestId('plates').waitFor();
  await sleep(400);
  await shot('08-how-it-works');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(700);
  await shot('09-settings');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click().catch(async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  });
  await sleep(700);
  await shot('10-privacy');
  await app.close();
  console.log('screenshots done');
}

// ── 2. Walkthrough capture (page + its own audio) ─────────────────────────
{
  const { app, page } = await launch();
  await app.evaluate(({ session }) => {
    const s = session.defaultSession;
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    s.setPermissionCheckHandler(() => true);
    s.setDisplayMediaRequestHandler((req, cb) => cb({ video: req.frame, audio: req.frame, enableLocalEcho: true }));
  });
  await page.evaluate(() => {
    const w = window;
    w.__wt = { chunks: [], events: [], t0: 0, rec: null, mime: '' };
    document.addEventListener('click', async () => {
      if (w.__wt.rec) return;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: 1600, height: 900 }, audio: true });
      const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
      rec.ondataavailable = (e) => { if (e.data.size) w.__wt.chunks.push(e.data); };
      rec.start(1000);
      w.__wt.rec = rec;
      w.__wt.mime = mime;
      w.__wt.t0 = performance.now();
      let last = '';
      setInterval(() => {
        const caps = [...document.querySelectorAll('[data-testid="captions"] p')].map((p) => p.textContent ?? '');
        const top = caps[caps.length - 1] ?? '';
        if (top && top !== last) { w.__wt.events.push({ t: (performance.now() - w.__wt.t0) / 1000, text: top }); last = top; }
      }, 100);
    }, { once: true });
  });
  await page.mouse.click(30, 880); // a trusted click on empty stage: starts the capture
  await sleep(1500);
  await page.evaluate(() => window.__wt.events.push({ t: (performance.now() - window.__wt.t0) / 1000, text: '#welcome' }));
  await sleep(6000);
  await page.evaluate(() => window.__wt.events.push({ t: (performance.now() - window.__wt.t0) / 1000, text: '#replay-start' }));
  await page.getByTestId('hear-replay').click();
  await page.waitForFunction(() => document.body.innerText.includes('end of the recorded session'), null, { timeout: 180_000 });
  await sleep(3000);
  await page.evaluate(() => window.__wt.events.push({ t: (performance.now() - window.__wt.t0) / 1000, text: '#privacy' }));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(600);
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await sleep(9000);
  await page.keyboard.press('Escape');
  await sleep(2000);
  const meta = await page.evaluate(async () => {
    const w = window.__wt;
    await new Promise((r) => { w.rec.onstop = r; w.rec.stop(); });
    w.blob = new Blob(w.chunks, { type: w.mime });
    return { size: w.blob.size, mime: w.mime, events: w.events };
  });
  const parts = [];
  for (let off = 0; off < meta.size; off += 4 << 20) {
    parts.push(await page.evaluate(async ([o, n]) => {
      const buf = new Uint8Array(await window.__wt.blob.slice(o, o + n).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, [off, 4 << 20]));
  }
  const ext = meta.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  writeFileSync(join(out, `capture.${ext}`), Buffer.concat(parts.map((p) => Buffer.from(p, 'base64'))));
  writeFileSync(join(out, 'events.json'), JSON.stringify(meta.events, null, 1));
  await app.close();
  console.log(`capture done: capture.${ext} (${(meta.size / 1e6).toFixed(1)} MB), ${meta.events.length} events`);
}
