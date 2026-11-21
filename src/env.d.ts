/// <reference types="svelte" />
/// <reference types="vite/client" />

export interface KeyStatus { present: boolean; source: 'safeStorage' | 'session' | 'env' | 'none'; encryptionAvailable: boolean }
export interface Readiness { verdict: 'ready' | 'limited' | 'blocked' | 'inconclusive'; reason: string }

export interface UpbeatBridge {
  sdkInfo(): Promise<{ available: boolean; error: string; platform: string }>;
  key: {
    status(): Promise<KeyStatus>;
    save(key: string): Promise<{ persisted: boolean }>;
    clear(): Promise<boolean>;
    forSdk(): Promise<string | null>;
  };
  readiness(cameraLabel?: string): Promise<Readiness>;
  store: {
    read<T = unknown>(name: 'settings' | 'profile' | 'history'): Promise<T | null>;
    write(name: 'settings' | 'profile' | 'history', data: unknown): Promise<boolean>;
    deleteData(opts: { recordings?: boolean }): Promise<boolean>;
  };
  rec: {
    save(text: string): Promise<string>;
    list(): Promise<string[]>;
    read(name: string): Promise<string | null>;
    remove(name: string): Promise<boolean>;
  };
  probe: { append(name: string, lines: string[]): Promise<string> };
  paths(): Promise<{ dataDir: string; files: string[] }>;
  flags(): Promise<{ probe: boolean; e2e: boolean }>;
  onShutdown(fn: () => void | Promise<void>): void;
}

declare global {
  interface Window {
    upbeat?: UpbeatBridge;
    __upbeatTest?: Record<string, unknown>;
  }
}
