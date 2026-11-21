<script lang="ts">
  import Calibration from './flows/Calibration.svelte';
  import Consent from './flows/Consent.svelte';
  import Drills from './flows/Drills.svelte';
  import Overlays from './flows/Overlays.svelte';
  import Plates from './flows/Plates.svelte';
  import Practice from './flows/Practice.svelte';
  import PrivacyCurtain from './flows/PrivacyCurtain.svelte';
  import Probe from './flows/Probe.svelte';
  import Results from './flows/Results.svelte';
  import SettingsCurtain from './flows/SettingsCurtain.svelte';
  import Setup from './flows/Setup.svelte';
  import Timing from './flows/Timing.svelte';
  import WarmUp from './flows/WarmUp.svelte';
  import Welcome from './flows/Welcome.svelte';
  import { session } from './stores/session.svelte';

  // Keys: R ready, Space count-in entry, D drills, H how it works, Esc stop.
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'radio';
    if (e.key === 'Escape') {
      e.preventDefault();
      void session.stopAll();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const stageScreens = ['practice', 'drills', 'warmup', 'calibration'];
    switch (e.key.toLowerCase()) {
      case 'r':
        if (stageScreens.includes(session.screen) || session.screen === 'probe') session.keyReady();
        break;
      case ' ':
        if (t?.tagName === 'BUTTON') return; // let Space press the focused button
        if (stageScreens.includes(session.screen) && session.screen !== 'calibration') {
          e.preventDefault();
          void session.keyMetronome();
        }
        break;
      case 'd':
        if (session.screen === 'practice' && !session.drill) session.go('drills');
        break;
      case 'h':
        session.plates = !session.plates;
        break;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<main data-screen={session.screen} data-mode={session.mode}>
  {#if session.screen === 'welcome'}<Welcome />
  {:else if session.screen === 'consent'}<Consent />
  {:else if session.screen === 'setup'}<Setup />
  {:else if session.screen === 'warmup'}<WarmUp />
  {:else if session.screen === 'calibration'}<Calibration />
  {:else if session.screen === 'practice'}<Practice />
  {:else if session.screen === 'drills'}<Drills />
  {:else if session.screen === 'results'}<Results />
  {:else if session.screen === 'timing'}<Timing />
  {:else if session.screen === 'probe'}<Probe />
  {/if}
  <Overlays />
  <Plates />
  <SettingsCurtain />
  <PrivacyCurtain />
</main>
