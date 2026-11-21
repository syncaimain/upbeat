// Preload (sandboxed, bundled into one CommonJS file by electron-vite).
// 1. The SmartSpectra preload bridge (exposes window.__smartspectraBridge for
//    @smartspectra/node-sdk/renderer).
// 2. A small, explicit app bridge: no generic ipcRenderer access.

import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  sdkInfo: () => invoke('sdk:info'),
  key: {
    status: () => invoke('key:status'),
    save: (key: string) => invoke('key:save', key),
    clear: () => invoke('key:clear'),
    forSdk: () => invoke('key:forSdk'),
  },
  readiness: (cameraLabel?: string) => invoke('readiness:check', cameraLabel),
  store: {
    read: (name: string) => invoke('store:read', name),
    write: (name: string, data: unknown) => invoke('store:write', name, data),
    deleteData: (opts: { recordings?: boolean }) => invoke('store:deleteData', opts),
  },
  rec: {
    save: (text: string) => invoke('rec:save', text),
    list: () => invoke('rec:list'),
    read: (name: string) => invoke('rec:read', name),
    remove: (name: string) => invoke('rec:delete', name),
  },
  probe: { append: (name: string, lines: string[]) => invoke('probe:append', name, lines) },
  paths: () => invoke('app:paths'),
  flags: () => invoke('app:flags'),
  onShutdown: (fn: () => void | Promise<void>) => {
    ipcRenderer.on('app:shutdown', async () => {
      try { await fn(); } finally { ipcRenderer.send('app:shutdown-done'); }
    });
  },
};

contextBridge.exposeInMainWorld('upbeat', api);
export type UpbeatBridge = typeof api;
