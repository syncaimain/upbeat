import './theme/tokens.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { session } from './stores/session.svelte';
import { offlineScheduleCheck } from './sound/scheduler';

void session.init().then(async () => {
  if (session.flags.e2e) {
    // Test hooks for Playwright (enabled only with UPBEAT_E2E=1).
    window.__upbeatTest = {
      offlineScheduleCheck,
      results: () => JSON.parse(JSON.stringify(session.results)),
      state: () => ({ screen: session.screen, mode: session.mode, cameraOn: session.cameraOn, sounding: session.sounding, ensemble: session.ensembleKind, captions: session.captions.map((c) => c.text) }),
    };
  }
});

mount(App, { target: document.getElementById('app')! });
