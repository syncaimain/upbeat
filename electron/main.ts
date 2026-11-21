// Upbeat — main process.
//
// Owns: the window, the SmartSpectra IPC binding, the API key (encrypted with
// safeStorage, never logged, never written to renderer storage), the device
// readiness check, and the small JSON files (settings, calibration profile,
// drill history, optional numbers-only recordings).

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redact } from './redact';

const DEBUG = process.env.UPBEAT_DEBUG === '1';
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const APP_ORIGIN = 'app://upbeat';

if (process.env.UPBEAT_USER_DATA) app.setPath('userData', process.env.UPBEAT_USER_DATA);

// ── Logging: event names and timings only. Anything that looks like the key
// is redacted before it can reach a log line. ──────────────────────────────
let sessionKey: string | null = null;
function log(level: 'info' | 'warn' | 'error', msg: string): void {
  if (level === 'info' && !DEBUG) return;
  const line = `[upbeat/main] ${redact(msg, currentKeySafe())}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ── Paths ───────────────────────────────────────────────────────────────
const dataDir = () => app.getPath('userData');
const file = (name: string) => join(dataDir(), name);
const recDir = () => join(dataDir(), 'recordings');
const probeDir = () => join(dataDir(), 'probe');
const STORES = new Set(['settings', 'profile', 'history']);

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(file(`${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}
function writeJson(name: string, data: unknown): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file(`${name}.json`), JSON.stringify(data, null, 2));
}

// ── API key ─────────────────────────────────────────────────────────────
// Order: encrypted file (safeStorage) → session-only memory → .env
// (development only, git-ignored).
function envKey(): string | null {
  if (process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY;
  if (app.isPackaged || process.env.UPBEAT_NO_DOTENV === '1') return null;
  try {
    const env = readFileSync(resolve(app.getAppPath(), '.env'), 'utf8');
    const m = /^SMARTSPECTRA_API_KEY=(.*)$/m.exec(env);
    const v = m?.[1]?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}
function storedKey(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = readFileSync(file('key.bin'));
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}
function currentKeySafe(): string | null {
  try { return currentKey().key; } catch { return sessionKey; }
}
function currentKey(): { key: string | null; source: 'safeStorage' | 'session' | 'env' | 'none' } {
  const s = storedKey();
  if (s) return { key: s, source: 'safeStorage' };
  if (sessionKey) return { key: sessionKey, source: 'session' };
  const e = envKey();
  if (e) return { key: e, source: 'env' };
  return { key: null, source: 'none' };
}

// ── Custom protocol: serves the built renderer as app://upbeat/… so fetch()
// works for samples and fixtures and the CSP 'self' is well defined. ─────
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
function registerAppProtocol(): void {
  const root = resolve(__dirname, '../renderer');
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    if (url.host !== 'upbeat') return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = normalize(join(root, rel));
    if (target !== root && !target.startsWith(root + sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

// ── Permissions: camera only, only for our own page. Never the microphone.
function allowedOrigin(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
}
function installPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && 'requestingUrl' in details && details.requestingUrl) || wc?.getURL() || '';
    const media = details as { mediaTypes?: string[] };
    const videoOnly = permission === 'media' && (media.mediaTypes ?? []).every((t) => t === 'video') &&
      (media.mediaTypes ?? []).length > 0;
    callback(videoOnly && allowedOrigin(url));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (permission !== 'media') return false;
    const d = details as { mediaType?: string };
    return allowedOrigin(origin) && d.mediaType !== 'audio';
  });
}

// ── Window ──────────────────────────────────────────────────────────────
let win: BrowserWindow | null = null;
let shutdownDone = false;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#140C10',
    title: 'Upbeat',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!allowedOrigin(url)) e.preventDefault();
  });

  // The SDK's main-process bridge. Loaded lazily so an unsupported platform
  // still opens the app (metronome mode and replay keep working).
  try {
    const { bindSmartSpectraIpc } = await import('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(win, { logger: (level, msg) => log(level, `sdk: ${msg}`) });
    sdkAvailable = true;
  } catch (err) {
    sdkAvailable = false;
    sdkLoadError = (err as Error).message;
    log('warn', `SmartSpectra runtime unavailable: ${sdkLoadError}`);
  }

  if (DEV_URL) await win.loadURL(DEV_URL);
  else await win.loadURL(`${APP_ORIGIN}/index.html`);
  win.on('closed', () => { win = null; });
}


let sdkAvailable = false;
let sdkLoadError = '';
let readinessBusy: Promise<unknown> | null = null;

// ── IPC ─────────────────────────────────────────────────────────────────
function fromOurWindow(e: Electron.IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && allowedOrigin(e.senderFrame?.url ?? '');
}
function handle(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromOurWindow(e)) throw new Error('refused');
    return fn(e, ...args);
  });
}

function installIpc(): void {
  handle('sdk:info', () => ({ available: sdkAvailable, error: sdkLoadError, platform: `${process.platform}-${process.arch}` }));

  handle('key:status', () => {
    const { source } = currentKey();
    return { present: source !== 'none', source, encryptionAvailable: safeStorage.isEncryptionAvailable() };
  });
  handle('key:save', (_e, key) => {
    if (typeof key !== 'string' || key.trim().length < 8 || key.length > 1024) throw new Error('invalid key');
    const k = key.trim();
    if (safeStorage.isEncryptionAvailable()) {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(file('key.bin'), safeStorage.encryptString(k));
      sessionKey = null;
      return { persisted: true };
    }
    // No OS keychain: keep it for this session only, never in plain text.
    sessionKey = k;
    return { persisted: false };
  });
  handle('key:clear', () => {
    sessionKey = null;
    rmSync(file('key.bin'), { force: true });
    return true;
  });
  // The renderer helper's constructor needs the key (it forwards it to this
  // process over the SDK's MessagePort). Handed over in memory only.
  handle('key:forSdk', () => currentKey().key);

  handle('readiness:check', async (_e, cameraLabel) => {
    if (!sdkAvailable) return { verdict: 'blocked', reason: `SmartSpectra runtime unavailable on this platform (${sdkLoadError}).` };
    const { key } = currentKey();
    if (!key) return { verdict: 'inconclusive', reason: 'No API key yet.' };
    if (readinessBusy) return { verdict: 'inconclusive', reason: 'A readiness check is already running.' };
    const run = (async () => {
      const sdkMod = await import('@smartspectra/node-sdk');
      const sdk = new sdkMod.SmartSpectraSDK({
        apiKey: key,
        enableTelemetry: false,
        requestedMetrics: [...sdkMod.breathingMetrics, sdkMod.MetricType.FACE_LANDMARKS, sdkMod.MetricType.TALKING],
      });
      try {
        // Check the camera the person chose (matched by name: browser device
        // IDs are not native IDs). Unknown or default → the default camera.
        let selection: ReturnType<typeof sdkMod.CameraSelection.byId> | typeof sdkMod.CameraSelection.default = sdkMod.CameraSelection.default;
        let note = '';
        if (typeof cameraLabel === 'string' && cameraLabel.trim()) {
          try {
            const want = cameraLabel.toLowerCase().replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/, '').trim();
            const cams = sdkMod.SmartSpectraSDK.availableCameras();
            const hit = cams.find((c) => (c.name ?? '').toLowerCase() === want) ?? cams.find((c) => (c.name ?? '').toLowerCase().includes(want) || want.includes((c.name ?? '').toLowerCase()));
            if (hit) selection = sdkMod.CameraSelection.byId(hit.id);
            else note = ` (The readiness check could not open "${cameraLabel}" natively, so it tested the default camera.)`;
          } catch {
            note = ' (Camera discovery is unavailable; tested the default camera.)';
          }
        }
        sdk.useCamera(selection, { width: 1280, height: 720, fps: 30 });
        const r = await sdk.checkDeviceReadiness();
        if (note) return { verdict: r.verdict, reason: redact(r.reason, key) + note };
        log('info', `readiness verdict=${r.verdict}`);
        return { verdict: r.verdict, reason: redact(r.reason, key) };
      } finally {
        await sdk.destroy();
      }
    })();
    readinessBusy = run;
    try {
      return await run;
    } catch (err) {
      return { verdict: 'inconclusive', reason: redact((err as Error).message, key) };
    } finally {
      readinessBusy = null;
    }
  });

  handle('store:read', (_e, name) => (typeof name === 'string' && STORES.has(name) ? readJson(name) : null));
  handle('store:write', (_e, name, data) => {
    if (typeof name !== 'string' || !STORES.has(name)) throw new Error('unknown store');
    writeJson(name, data);
    return true;
  });
  handle('store:deleteData', (_e, opts) => {
    const o = (opts ?? {}) as { recordings?: boolean };
    rmSync(file('profile.json'), { force: true });
    rmSync(file('history.json'), { force: true });
    if (o.recordings) rmSync(recDir(), { recursive: true, force: true });
    rmSync(probeDir(), { recursive: true, force: true });
    return true;
  });

  const safeName = (n: unknown) => typeof n === 'string' && /^[\w.-]+\.jsonl$/.test(n);
  handle('rec:save', (_e, text) => {
    if (typeof text !== 'string' || text.length > 200 * 1024 * 1024) throw new Error('bad recording');
    mkdirSync(recDir(), { recursive: true });
    const name = `upbeat-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    writeFileSync(join(recDir(), name), text);
    return name;
  });
  handle('rec:list', () => (existsSync(recDir()) ? readdirSync(recDir()).filter((n) => n.endsWith('.jsonl')).sort().reverse() : []));
  handle('rec:read', (_e, name) => (safeName(name) ? readFileSync(join(recDir(), name as string), 'utf8') : null));
  handle('rec:delete', (_e, name) => {
    if (safeName(name)) rmSync(join(recDir(), name as string), { force: true });
    return true;
  });

  handle('probe:append', (_e, name, lines) => {
    if (typeof name !== 'string' || !/^[\w.-]+$/.test(name) || !Array.isArray(lines)) throw new Error('bad probe');
    mkdirSync(probeDir(), { recursive: true });
    writeFileSync(join(probeDir(), `${name}.jsonl`), lines.map(String).join('\n') + '\n', { flag: 'a' });
    return join(probeDir(), `${name}.jsonl`);
  });

  handle('app:paths', () => ({
    dataDir: dataDir(),
    files: ['settings.json', 'profile.json', 'history.json', 'key.bin', 'recordings/', 'probe/'].map((f) => join(dataDir(), f)),
  }));
  handle('app:flags', () => ({ probe: process.argv.includes('--probe'), e2e: process.env.UPBEAT_E2E === '1' }));
  ipcMain.on('app:shutdown-done', (e) => {
    if (win && e.sender === win.webContents) finishShutdown();
  });
}

// ── Lifecycle: on close or quit, ask the renderer to stop camera tracks, the
// SDK (stop → stopAsync in this process → destroy) and audio; close as soon
// as it confirms, or after 1.2 s regardless. ─────────────────────────────
let shutdownTimer: NodeJS.Timeout | null = null;
function requestShutdown(): void {
  if (!win || win.isDestroyed()) return;
  if (shutdownTimer) return;
  win.webContents.send('app:shutdown');
  shutdownTimer = setTimeout(finishShutdown, 1200);
}
function finishShutdown(): void {
  shutdownDone = true;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (win && !win.isDestroyed()) win.close();
  else app.quit();
}
app.on('browser-window-created', (_e, w) => {
  w.on('close', (e) => {
    if (shutdownDone) return;
    e.preventDefault();
    requestShutdown();
  });
});
app.on('before-quit', (e) => {
  if (shutdownDone || !win || win.isDestroyed()) return;
  e.preventDefault();
  requestShutdown();
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  registerAppProtocol();
  installPermissions();
  installIpc();
  await createWindow();
});
