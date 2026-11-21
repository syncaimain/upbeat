// The test hook the app exposes when started with UPBEAT_E2E=1 (src/main.ts).
export {};
declare global {
  interface Window {
    __upbeatTest?: Record<string, unknown>;
  }
}
