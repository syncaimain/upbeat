<!-- The brass breath arc above the podium.
     Outer arc: fills with the live chest trace (resting amplitudes).
     Tick: the level at the detected onset (dashed green tick: the "clean"
     depth, 1.6x rest above the onset). Inner arc: time from the onset to the
     predicted downbeat, with a brass marker at the downbeat. -->
<script lang="ts">
  interface Props {
    level: number;
    onsetLevel: number | null;
    progress: number | null;
    state: 'idle' | 'ready' | 'sounding' | 'tuning' | 'paused';
    reduced: boolean;
  }
  let { level, onsetLevel, progress, state, reduced }: Props = $props();
  const CX = 800, CY = 792, R = 250, RI = 214;
  const frac = (v: number) => Math.min(1, Math.max(0, (v + 0.6) / 3.2));
  const pt = (f: number, r: number): [number, number] => {
    const a = Math.PI + f * Math.PI;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  };
  const arc = (f: number, r: number) => {
    const [x0, y0] = pt(0, r);
    const [x1, y1] = pt(Math.max(0.0001, f), r);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const tick = (f: number, r0: number, r1: number) => {
    const [a, b] = pt(f, r0);
    const [c, d] = pt(f, r1);
    return { x1: a, y1: b, x2: c, y2: d };
  };
  // Reduced motion: the fill moves in ten static steps instead of flowing.
  const f = $derived(reduced ? Math.round(frac(level) * 10) / 10 : frac(level));
  const onsetTick = $derived(onsetLevel === null ? null : tick(frac(onsetLevel), R - 22, R + 22));
  const cleanTick = $derived(onsetLevel === null ? null : tick(frac(onsetLevel + 1.6), R - 16, R + 16));
  const marker = pt(1, RI);
  const dot = $derived(progress === null ? null : pt(progress, RI));
  const stroke = $derived(state === 'sounding' ? '#f3e9d2' : state === 'paused' ? '#6b5a44' : '#d4a93c');
</script>

<g aria-hidden="true">
  <path d={arc(1, R)} fill="none" stroke="#d4a93c" stroke-opacity="0.16" stroke-width="16" />
  <path d={arc(1, R + 12)} fill="none" stroke="#d4a93c" stroke-opacity="0.3" stroke-width="0.8" />
  <path d={arc(1, R - 12)} fill="none" stroke="#d4a93c" stroke-opacity="0.3" stroke-width="0.8" />
  <path d={arc(f, R)} fill="none" stroke={stroke} stroke-width="16" stroke-opacity={state === 'tuning' ? 0.55 : 0.92}
    filter={!reduced && state === 'sounding' ? 'url(#glow)' : undefined} data-testid="breath-arc" />
  {#if onsetTick}
    <line {...onsetTick} stroke="#f3e9d2" stroke-width="2" />
  {/if}
  {#if cleanTick}
    <line {...cleanTick} stroke="#9ccb8a" stroke-width="1.25" stroke-dasharray="3 3" />
  {/if}
  {#if progress !== null && dot}
    <path d={arc(1, RI)} fill="none" stroke="#d4a93c" stroke-opacity="0.22" stroke-width="2" />
    <path d={arc(progress, RI)} fill="none" stroke="#d4a93c" stroke-width="3" />
    <circle cx={marker[0]} cy={marker[1]} r="8" fill="#d4a93c" />
    <circle cx={dot[0]} cy={dot[1]} r="4" fill="#f3e9d2" />
  {/if}
</g>
