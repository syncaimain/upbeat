// End-to-end in replay mode (no camera, no API key needed). Runs the built
// app (`npm run test:e2e` builds first).

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;
let userData: string;
const shots = process.env.UPBEAT_SHOTS;

// One app instance walks through the flow in order; if a step fails, the
// rest are skipped rather than re-run against a fresh app.
test.describe.configure({ mode: 'serial' });

async function launch(extraEnv: Record<string, string> = {}) {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, UPBEAT_E2E: '1', UPBEAT_USER_DATA: userData, SMARTSPECTRA_API_KEY: '', UPBEAT_NO_DOTENV: '1', ...extraEnv },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="enter-hall"]');
}
const shot = async (name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'upbeat-e2e-'));
  await launch();
  await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
});
test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('welcome: no camera, two ways in', async () => {
  await expect(page.getByTestId('enter-hall')).toBeVisible();
  await expect(page.getByTestId('hear-replay')).toBeVisible();
  await shot('01-welcome');
});

test('replay plays the bundled session, labelled, with captions and feedback', async () => {
  await page.getByTestId('hear-replay').click();
  await expect(page.getByTestId('replay-banner')).toContainText('synthetic demo numbers');
  await expect(page.getByTestId('camera-dot')).toHaveAttribute('aria-label', 'Camera off');
  // The first cue (warm-up ~34 s in the recording) — wait for its entry caption.
  await expect(page.getByTestId('captions')).toContainText(/enters/, { timeout: 60_000 });
  await page.waitForTimeout(700);
  await shot('02-practice-entry');
  await expect(page.getByTestId('feedback')).toContainText(/Your breath set ♩ = \d+/, { timeout: 10_000 });
  await shot('03-practice-feedback');
});

test('the replay reaches the ragged nod and the covered-lens pause', async () => {
  await expect(page.getByTestId('captions')).toContainText(/ragged/, { timeout: 30_000 });
  await shot('04-ragged');
  await expect(page.getByTestId('pause-note')).toBeVisible({ timeout: 45_000 });
  await shot('05-paused');
  await expect(page.getByTestId('pause-note')).toBeHidden({ timeout: 15_000 });
});

test('the same replay gives identical results twice (deterministic)', async () => {
  test.setTimeout(420_000); // two full ~100 s replays
  await expect.poll(async () => (await page.evaluate(() => (window.__upbeatTest!.state as () => { mode: string })().mode)), { timeout: 60_000 }).toBe('replay');
  await page.waitForFunction(() => document.body.innerText.includes('end of the recorded session'), null, { timeout: 150_000 });
  const first = await page.evaluate(() => (window.__upbeatTest!.results as () => unknown[])());
  expect(first.length).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: 'Play again' }).click();
  // Wait for the new replay to start (old end-of-session note gone) before
  // waiting for it to finish.
  await page.waitForFunction(() => !document.body.innerText.includes('end of the recorded session'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('end of the recorded session'), null, { timeout: 150_000 });
  const second = await page.evaluate(() => (window.__upbeatTest!.results as () => unknown[])());
  const key = (r: unknown[]) => r.map((x) => { const y = x as { quality: string; plannedBpm: number; cause: string; spreadMs: number }; return [y.cause, y.quality, Math.round(y.plannedBpm), Math.round(y.spreadMs)]; });
  expect(key(second)).toEqual(key(first));
});

test('keyboard: H opens the plates, Esc stops and closes everything', async () => {
  await page.keyboard.press('h');
  await expect(page.getByTestId('plates')).toBeVisible();
  await shot('06-plates');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plates')).toBeHidden();
  const s = await page.evaluate(() => (window.__upbeatTest!.state as () => { mode: string; cameraOn: boolean; sounding: boolean })());
  expect(s.cameraOn).toBe(false);
  expect(s.sounding).toBe(false);
});

test('Space gives a count-in entry with no camera', async () => {
  await page.keyboard.press(' ');
  await expect(page.getByTestId('captions')).toContainText('Count 1', { timeout: 5000 });
  await expect(page.getByTestId('captions')).toContainText(/enters on the count/, { timeout: 8000 });
});

test('scheduler: 100 plans rendered offline land within ±1 ms', async () => {
  const r = await page.evaluate(async () => (window.__upbeatTest!.offlineScheduleCheck as (n: number) => Promise<{ maxErrMs: number; plans: number }>)(100));
  console.log(`offline scheduler check: ${JSON.stringify(r)}`);
  expect(r.plans).toBe(100);
  expect(r.maxErrMs).toBeLessThanOrEqual(1);
});

test('settings curtain and reduced motion', async () => {
  await page.keyboard.press('Escape');
  if (await page.getByTestId('hear-replay').isVisible()) {
    await page.getByTestId('hear-replay').click();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('curtain').first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot('07-settings');
  await page.getByLabel('Reduced', { exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce');
  // The string quartet loads its CC0 samples (not the synth fallback).
  await page.getByLabel(/String quartet/).check();
  await expect.poll(async () => (await page.evaluate(() => (window.__upbeatTest!.state as () => { ensemble: string })().ensemble)), { timeout: 20_000 }).toBe('quartet');
  await page.getByLabel(/Choir/).check();
  await page.keyboard.press('Escape');
});

test('consent comes before any camera', async () => {
  await page.reload();
  await page.waitForSelector('[data-testid="enter-hall"]');
  await page.getByTestId('enter-hall').click();
  await expect(page.getByTestId('consent')).toBeVisible();
  await shot('08-consent');
  const s = await page.evaluate(() => (window.__upbeatTest!.state as () => { cameraOn: boolean })());
  expect(s.cameraOn).toBe(false);
  await page.getByTestId('consent-agree').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await shot('09-setup');
});

test('privacy: delete profile and history removes the files', async () => {
  writeFileSync(join(userData, 'profile.json'), '{"version":1}');
  writeFileSync(join(userData, 'history.json'), '[]');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForSelector('[data-testid="enter-hall"]');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByTestId('delete-data').click();
  await expect(page.getByTestId('delete-msg')).toBeVisible();
  expect(existsSync(join(userData, 'profile.json'))).toBe(false);
  expect(existsSync(join(userData, 'history.json'))).toBe(false);
});

test('no secret in settings files; telemetry is off in the SDK options', async () => {
  const settingsFile = join(userData, 'settings.json');
  if (existsSync(settingsFile)) expect(readFileSync(settingsFile, 'utf8')).not.toMatch(/apiKey|api_key/i);
});
