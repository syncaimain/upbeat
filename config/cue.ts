// Every threshold the cue engine uses, with the reason for its value.
//
// Status: these are the specification's starting values plus engineering
// defaults. They have NOT yet been tuned on recorded SmartSpectra sessions
// (Stage 1 needs a camera and an API key). After recording fixtures, run
// `npm run analyze -- <fixture.jsonl>` and adjust here; docs/RESULTS.md
// records which values were tuned and on what data.

export const CUE = {
  // ── Preprocessing ───────────────────────────────────────────────────────
  /** Time constant of the one-pole high-pass that removes slow drift from
   *  the chest trace ("2 s high-pass"). τ = 2 s keeps breath-scale motion
   *  (0.1–1 Hz) and removes posture drift and slow baseline wander. The
   *  high-pass output drives the breath arc and the resting amplitude; the
   *  cue's rise, depth and peak are measured on the smoothed trace without
   *  it (relative to t0), because a high-pass moves the peak earlier. */
  HIGHPASS_TAU_S: 2.0,
  /** Causal median filter length (samples). 5 removes single-sample spikes;
   *  costs two samples of latency, which is accounted for by stamping the
   *  output with the centre sample's SDK timestamp. */
  MEDIAN_SAMPLES: 5,
  /** Window for the least-squares slope estimate. Short enough to see the
   *  first 120 ms of an inhale, long enough to average a few samples. */
  SLOPE_WINDOW_MS: 100,
  /** Resting-breath recording length used in calibration. */
  REST_WINDOW_S: 20,
  /** Resting amplitude = (P90 − P10) of the processed trace over the rest
   *  window: a robust peak-to-trough estimate that ignores outliers. */
  REST_PERCENTILE_LOW: 0.1,
  REST_PERCENTILE_HIGH: 0.9,
  /** Fallback resting amplitude floor (trace units) so a near-flat rest
   *  recording cannot make every twitch look like a huge breath. Raised
   *  automatically if the profile was calibrated. */
  REST_AMPLITUDE_FLOOR: 1e-6,
  /** Abdomen and chest samples are fused only when their timestamps agree
   *  within this tolerance. */
  FUSION_MATCH_US: 20_000,

  // ── Ready gate ──────────────────────────────────────────────────────────
  /** Chin lift above the calibrated head pitch that arms the ensemble. */
  READY_PITCH_DEG: 6,
  /** The lift must be held this long (rejects nods and twitches). */
  READY_HOLD_MS: 300,
  /** After a disarm, the head must come back below this before a new lift
   *  can arm again (hysteresis, so a held lift doesn't re-arm in a loop). */
  READY_REARM_BELOW_DEG: 3,
  /** Armed with no cue for this long → disarm. */
  READY_TIMEOUT_MS: 6000,
  /** Talking detected within this window → disarm and block cues; talking
   *  also degrades the breathing trace. */
  TALKING_BLOCK_MS: 300,
  /** A head-only cue: after a gesture arm, if the head drops back by this
   *  much without any detected inhale, the ensemble guesses (ragged). */
  NOD_DROP_DEG: 4,
  /** Head-pitch geometry: nose-tip depth in front of the outer-eye-corner
   *  plane as a fraction of the outer-eye-corner distance (anthropometric
   *  average ≈ 0.35–0.40). Converts the nose/eye-line ratio change to
   *  degrees. VERIFY on recorded landmarks. */
  NOSE_DEPTH_RATIO: 0.38,
  /** MediaPipe Face Mesh indices: nose tip, right-eye outer, left-eye outer.
   *  VERIFY against the SDK's landmark layout (Stage 1 landmark drawing). */
  LANDMARK_NOSE: 1,
  LANDMARK_EYE_R: 33,
  LANDMARK_EYE_L: 263,

  // ── Onset ───────────────────────────────────────────────────────────────
  /** Inhale onset: smoothed slope above this many resting amplitudes per
   *  second... */
  ONSET_SLOPE_REST_PER_S: 0.5,
  /** ...sustained for this long. */
  ONSET_SUSTAIN_MS: 120,
  /** t0 (inhale start) is traced back from the threshold crossing while the
   *  slope stays above ONSET_BACKTRACK_SLOPE_REST_PER_S, at most this far.
   *  Entry, peak beat and calibration are timed from t0; the rise rate is
   *  measured from the crossing (robust to pre-inhale noise). */
  ONSET_BACKTRACK_MAX_MS: 300,
  /** "Clearly rising" for the backtrack (rest/s), above slope noise. */
  ONSET_BACKTRACK_SLOPE_REST_PER_S: 0.15,

  /** ADDITION to the spec (tune in Stage 1): an onset only becomes a cue if
   *  its early rise rate (first 150 ms) reaches this. A resting inhale
   *  normalised to its own peak-to-trough amplitude rises at most ~0.7
   *  rest/s at 14 breaths/min, which already clears the 0.5 rest/s onset
   *  threshold; a preparatory breath of 1.6x depth over even a 1.5 s beat
   *  rises at ≥ 1.6 rest/s. Without this gate, every resting inhale while
   *  Ready would cue a (ragged) entry. On synthetic resting breath (14/min)
   *  the early rise reaches ~1.15 rest/s, so 1.6 leaves a margin; a
   *  deliberate shallow breath (1.0x over 0.6 s) still clears it and enters
   *  ragged, as the lesson requires. */
  MIN_CUE_RISE_REST_PER_S: 1.6,

  // ── Tempo prediction ────────────────────────────────────────────────────
  /** The early rise rate r is measured over [tCross, tCross + this]. */
  PREDICT_AFTER_MS: 150,
  /** Predicted beat is clamped to this range (170–40 bpm). */
  BEAT_MIN_S: 0.35,
  BEAT_MAX_S: 1.5,
  /** Default k (rest·s⁻¹·s) before calibration: r = 2 rest/s implies a
   *  beat of ~0.75 s. Replaced by the per-user fit. */
  DEFAULT_K: 1.5,
  /** If the calibrated fit's RMS beat error exceeds this, prediction is not
   *  trusted: exercises use a fixed target tempo and the breath only times
   *  the entry (the plan's decision rule, applied per user). */
  MAX_TRUSTED_FIT_ERROR: 0.15,
  /** Minimum valid prep breaths for a fit. */
  MIN_CALIBRATION_BREATHS: 6,

  // ── Scheduling ──────────────────────────────────────────────────────────
  /** If the entry would be less than this far in the future when the
   *  prediction is ready, play immediately and say "too fast to follow". */
  MIN_LEAD_MS: 120,
  /** The entry's quality (tight or ragged) is decided this long before it
   *  sounds, using all breath data received by then. Must exceed the largest
   *  negative voice offset plus the audio scheduling margin. */
  COMMIT_LEAD_MS: 90,
  /** Extra latency added to every scheduled audio time to absorb timer
   *  jitter between the commit and Web Audio. */
  AUDIO_SAFETY_MS: 25,

  // ── Entry quality ───────────────────────────────────────────────────────
  /** Clean cue: projected depth ≥ this × resting amplitude. */
  CLEAN_DEPTH_X: 1.6,
  /** Ragged when projected depth < this × resting amplitude. */
  RAGGED_DEPTH_X: 1.2,
  /** Tight-entry per-voice offsets ~ N(0, σ). */
  TIGHT_SIGMA_MS: 12,
  /** Loose (between ragged and clean): wider spread, no late voices. */
  LOOSE_SIGMA_MS: 30,
  /** Ragged: total spread drawn from this range, two voices late. */
  RAGGED_SPREAD_MIN_MS: 60,
  RAGGED_SPREAD_MAX_MS: 250,
  RAGGED_LATE_VOICES: 2,
  /** Monotonic rise: the smoothed slope may dip below zero for at most this
   *  long between t0 and commit. */
  MONOTONIC_DIP_MS: 80,
  /** Depth projection: depth-so-far / shape(elapsed/beat), with the
   *  fraction floored here so very early commits don't explode. */
  PROJECTION_MIN_FRACTION: 0.35,
  /** Assumed inhale shape for the projection: 'sine' = decelerating
   *  (quarter-sine) rise, 'linear' = constant flow. VERIFY in Stage 1. */
  PROJECTION_SHAPE: 'sine' as 'sine' | 'linear',
  /** An entry counts as "tight" in drill scores when its voice spread is
   *  under this. */
  TIGHT_SPREAD_MS: 40,

  // ── Peak confirmation ───────────────────────────────────────────────────
  /** Peak confirmed when the slope has stayed ≤ 0 for this long. */
  PEAK_HOLD_MS: 150,
  /** Give up on confirming a peak after this long ("tempo not measured"). */
  PEAK_TIMEOUT_MS: 2500,

  // ── Release (P1) ────────────────────────────────────────────────────────
  /** A release cue is only accepted after the chord has sounded this long. */
  RELEASE_MIN_SOUNDING_MS: 1500,
  /** Exhale onset: slope below −this (rest/s), sustained ONSET_SUSTAIN_MS. */
  RELEASE_SLOPE_REST_PER_S: 0.5,
  /** Head pitch drop from its value at the entry. */
  RELEASE_PITCH_DROP_DEG: 4,
  /** Exhale and head drop must occur within this window of each other. */
  RELEASE_PAIR_WINDOW_MS: 600,
  /** Without a release cue the chord fades out after this long. */
  MAX_SUSTAIN_MS: 4500,

  // ── Quality gate ────────────────────────────────────────────────────────
  /** Non-OK validation must persist this long before the scene pauses
   *  (cues are blocked immediately). */
  PAUSE_DEBOUNCE_MS: 1000,
  /** OK frames needed before resuming. */
  RESUME_AFTER_MS: 1000,
  /** No new trace sample for this long → stale → cues blocked. */
  STALE_TRACE_MS: 1500,
  /** Warm-up message appears if breathing never becomes stable. */
  WARMUP_HINT_AFTER_S: 60,

  // ── Metronome mode ──────────────────────────────────────────────────────
  /** Count-in clicks before the entry (one bar of 4/4: the entry is beat 1
   *  of the next bar). */
  COUNT_IN_BEATS: 4,
} as const;

export type CueConfig = typeof CUE;
