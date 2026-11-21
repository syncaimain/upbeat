<!-- Framing guide over the (blurred) camera mirror, kept deliberately simple:
     • one head-and-shoulders outline = where you should be
       (green when you are in place, coral when you need to adjust);
     • one dot = where your face is now (put it inside the head).
     The instruction text ("← Move left", "Move back"…) is shown under the
     mirror by the screen that hosts it (see framingInstruction()). -->
<script lang="ts">
  import { FRAME_TARGET as T } from '../engine/framing';
  import { session } from '../stores/session.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const size = $derived(session.frameSize());
  const fr = $derived(session.framing());
  const sw = $derived(compact ? 5 : 3.5);
  const colour = $derived(fr.allOk ? '#9ccb8a' : fr.face === 'unknown' ? '#f3e9d2' : '#e07a5f');

  const outline = $derived.by(() => {
    const cx = T.cx * size.w, cy = T.cy * size.h;
    const rx = (T.idealWidth * size.w) / 2 * 1.25;
    const ry = rx * 1.35;
    const ys = cy + ry * 1.75; // shoulder line
    const H = size.h + sw * 4;
    const side = (s: 1 | -1) => {
      const x = (k: number) => cx + s * k * rx;
      return `M ${x(3.4)} ${H} C ${x(3.3)} ${ys + 0.2 * ry} ${x(2.6)} ${ys - 0.25 * ry} ${x(1.35)} ${ys - 0.35 * ry} ` +
        `C ${x(0.65)} ${ys - 0.4 * ry} ${x(0.45)} ${cy + 1.3 * ry} ${x(0.45)} ${cy + 0.97 * ry}`;
    };
    return { cx, cy, rx, ry, left: side(-1), right: side(1) };
  });
</script>

<svg class="markers" viewBox="0 0 {size.w} {size.h}" preserveAspectRatio={compact ? 'xMidYMid slice' : 'xMidYMid meet'} aria-hidden="true" data-testid="mirror-markers">
  <g fill="none" stroke={colour} stroke-width={sw} stroke-linecap="round"
    stroke-dasharray={fr.allOk ? 'none' : `${sw * 4} ${sw * 3}`}>
    <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} />
    <path d={outline.left} />
    <path d={outline.right} />
  </g>
  {#if fr.faceAt}
    <circle cx={fr.faceAt.x} cy={fr.faceAt.y} r={sw * 3.2} fill="#f3e9d2" stroke="#140c10" stroke-width={sw * 0.8} />
  {/if}
</svg>

<style>
  .markers { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
</style>
