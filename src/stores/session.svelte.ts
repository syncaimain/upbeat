// The session controller: owns the clocks, the sense client (live) or the
// replay cursor, the pipeline (cue engine), the audio engine and the
// recorder, and exposes reactive state to the screens and the scene.

import { CUE } from '../../config/cue';
import { calibrate, CALIBRATION_TEMPI, trialTiming, type CalibrationOutcome, type TrialTiming } from '../engine/calibration';
import type { EngineEvent, TempoMode } from '../engine/cue/cueEngine';
import { voiceOffsets } from '../engine/cue/entryQuality';
import { makeDrill, scoreDrill, scoredTempo, type DrillDef, type DrillKind, type DrillScore } from '../engine/drills';
import { entryCaption, feedbackLines } from '../engine/feedback';
import { assessFraming, framingInstruction, type Framing } from '../engine/framing';
import { mulberry32 } from '../engine/rng';
import { ClockMap } from '../engine/timing/clocks';
import type { DelaySummary } from '../engine/timing/delay';
import { bpmToBeat, ms, us, type Microseconds } from '../engine/timing/units';
import type { CommittedEntry, CueResult } from '../engine/types';
import { stepReplay } from '../sense/driver';
import { EC, noteForError, pauseTitle, type ErrorNote } from '../sense/errors';
import type { GateView } from '../sense/gate';
import { Pipeline } from '../sense/pipeline';
import { Recorder } from '../sense/record';
import { parseRecording, ReplayCursor, type ParsedRecording } from '../sense/replay';
import { DEFAULT_CAPTURE, LOW_CAPTURE, NoKeyError, SenseClient, type CaptureSettings } from '../sense/sdk';
import type { ReplayHeader, SenseEvent } from '../sense/types';
import { AudioEngine } from '../sound/scheduler';
import { profileStore } from './profile.svelte';
import { settings } from './settings.svelte';

export type Screen =
  | 'welcome' | 'consent' | 'setup' | 'warmup' | 'calibration'
  | 'practice' | 'drills' | 'results' | 'timing' | 'probe';

export type Mode = 'idle' | 'live' | 'replay' | 'metronome';

export interface Caption { id: number; text: string; tone: 'together' | 'ragged' | 'plain' }

export interface CalibState {
  phase: 'intro' | 'rest' | 'trials' | 'analysing' | 'done';
  restLeftS: number;
  trial: number;
  bpm: number;
  outcome: CalibrationOutcome | null;
}

export interface DrillRun {
  def: DrillDef;
  index: number;
  results: CueResult[];
}

const nowPerf = () => performance.now();

class Session {
  // ── reactive state ────────────────────────────────────────────────────
  screen = $state<Screen>('welcome');
  mode = $state<Mode>('idle');
  replayInfo = $state<{ synthetic: boolean; description: string } | null>(null);
  replayEnded = $state(false);
  cameraOn = $state(false);
  starting = $state(false);
  gate = $state<GateView | null>(null);
  level = $state(0);
  armed = $state(false);
  armSource = $state<'gesture' | 'key' | null>(null);
  sounding = $state(false);
  pitchDeg = $state<number | null>(null);
  rateConfidence = $state(0);
  landmarkCount = $state(0);
  onset = $state<{ perf: number; level: number } | null>(null);
  plan = $state<{ id: number; t0Perf: number; downbeatPerf: number; cause: string } | null>(null);
  voiceLitPerf = $state<(number | null)[]>([]);
  voiceLate = $state<boolean[]>([]);
  entryQuality = $state<CommittedEntry['quality'] | null>(null);
  frame = $state(0);
  feedback = $state<string[]>([]);
  feedbackTone = $state<'together' | 'ragged' | 'plain'>('plain');
  captions = $state<Caption[]>([]);
  strip = $state<CueResult[]>([]);
  countLabel = $state<string | null>(null);
  note = $state<(ErrorNote & { code?: number }) | null>(null);
  stoppedNote = $state(false);
  pause = $state<{ title: string; hint: string } | null>(null);
  curtain = $state<null | 'settings' | 'privacy'>(null);
  plates = $state(false);
  announcement = $state('');
  recording = $state(false);
  lastRecording = $state<string | null>(null);
  warmupStartedAt = $state(0);
  warmupStable = $state(false);
  calib = $state<CalibState>({ phase: 'intro', restLeftS: CUE.REST_WINDOW_S, trial: 0, bpm: 60, outcome: null });
  drill = $state<DrillRun | null>(null);
  lastScore = $state<DrillScore | null>(null);
  stream = $state<MediaStream | null>(null);
  readiness = $state<{ verdict: string; reason: string } | null>(null);
  delays = $state<{ newest: DelaySummary; samples: DelaySummary } | null>(null);
  ensembleKind = $state<string>('choir');
  flags = $state({ probe: false, e2e: false });
  results = $state<CueResult[]>([]);
  /** Mirror hidden for this session after a low-frame-rate stop. */
  mirrorSuspended = $state(false);
  /** Is the camera mirror shown on the stage right now? */
  get mirrorVisible(): boolean {
    return settings.value.showMirror && !this.mirrorSuspended && !!this.stream;
  }
  /** Newest tracked face points (nose tip, outer eye corners), frame pixels. */
  head = $state<import('../engine/types').HeadPoints | null>(null);

  // ── machinery ─────────────────────────────────────────────────────────
  readonly clock = new ClockMap({ perfNow: nowPerf, dateNow: () => Date.now() });
  audio: AudioEngine | null = null;
  readonly sense: SenseClient;
  pipeline: Pipeline | null = null;
  private recorder: Recorder | null = null;
  private cursor: ReplayCursor | null = null;
  private replayData: ParsedRecording | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private captionId = 0;
  private lastEpochRefresh = 0;
  private lastValidation: SenseEvent | null = null;
  private entries = new Map<number, CommittedEntry>();
  private visualCues: { perf: number; label: string | null }[] = [];
  private calibTimers: ReturnType<typeof setTimeout>[] = [];
  private capture: CaptureSettings = { ...DEFAULT_CAPTURE };
  /** Probe hook (Stage 1 tools): sees every live sense event. */
  probeSink: ((e: SenseEvent) => void) | null = null;

  constructor() {
    this.sense = new SenseClient(this.clock, (e) => this.onLiveEvent(e));
  }

  async init(): Promise<void> {
    await settings.load();
    await profileStore.load();
    this.flags = (await window.upbeat?.flags()) ?? { probe: false, e2e: false };
    // Demo mode shows the (blurred) mirror so a real person is visibly there.
    // Demo mode: a large, UNBLURRED mirror while recording; the recorder logs
    // where the mirror is, and `npm run demo:mp4` blurs those areas afterwards.
    this.applyMotion();
    window.upbeat?.onShutdown(() => this.shutdown());
    window.addEventListener('beforeunload', () => { void this.sense.stop(); });
    const loop = () => {
      this.frame = nowPerf();
      if (this.audio) this.audio.stamp(this.clock);
      this.updateVisualCue();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  applyMotion(): void {
    document.documentElement.dataset.motion = settings.reducedMotion() ? 'reduce' : 'full';
  }

  get reducedMotion(): boolean {
    return settings.reducedMotion();
  }

  /** Audio must start from a user gesture. */
  async ensureAudio(): Promise<AudioEngine> {
    if (!this.audio) {
      this.audio = new AudioEngine();
      this.audio.setVoicing(settings.value.voicing);
      this.audio.setVolume(settings.value.volumeDb);
    }
    await this.audio.unlock();
    if (this.audio.kind === null || (settings.value.ensemble === 'quartet') !== (this.audio.kind !== 'choir')) {
      this.ensembleKind = await this.audio.setEnsemble(settings.value.ensemble);
    } else {
      this.ensembleKind = this.audio.kind;
    }
    return this.audio;
  }

  async setEnsemble(kind: 'choir' | 'quartet'): Promise<void> {
    await settings.update({ ensemble: kind });
    if (this.audio) this.ensembleKind = await this.audio.setEnsemble(kind);
    this.rebuildPipeline();
  }

  get voices(): number {
    return settings.value.ensemble === 'choir' ? 8 : 4;
  }

  // ── navigation ────────────────────────────────────────────────────────
  go(s: Screen): void {
    this.screen = s;
    this.note = null;
    if (s === 'welcome' || s === 'results') {
      // The camera is off on Welcome and Results.
      void this.stopSensing();
    }
  }

  async enterHall(): Promise<void> {
    await this.ensureAudio();
    if (!settings.value.consented) return this.go('consent');
    this.go('setup');
  }

  // ── live sensing ──────────────────────────────────────────────────────
  async checkReadiness(): Promise<void> {
    this.readiness = { verdict: 'checking', reason: 'The hall is opening…' };
    const r = (await window.upbeat?.readiness(settings.value.cameraLabel || undefined)) ?? { verdict: 'blocked', reason: 'App bridge unavailable.' };
    this.readiness = r;
  }

  async startSensing(): Promise<boolean> {
    if (this.mode === 'live' && this.sense.running) return true;
    this.stopReplay();
    this.starting = true;
    this.note = null;
    this.stoppedNote = false;
    try {
      await this.ensureAudio();
      this.rebuildPipeline();
      this.mode = 'live';
      this.stream = await this.sense.start({ ...this.captureSettings(), ...(settings.value.cameraId ? { deviceId: settings.value.cameraId } : {}) });
      this.cameraOn = true;
      this.startTicking();
      return true;
    } catch (err) {
      this.cameraOn = false;
      this.stream = null;
      this.mode = 'idle';
      if (err instanceof NoKeyError) {
        this.note = { ...noteForError(EC.kAuthenticationFailed, false), title: 'No API key yet', body: 'Add your SmartSpectra API key in Setup to sense your breath. Metronome mode works without one.' };
      } else {
        const e = err as { code?: number; retryable?: boolean; name?: string; message?: string };
        if (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError') {
          this.note = noteForError(EC.kInputUnavailable, true);
        } else {
          this.note = { ...noteForError(typeof e.code === 'number' ? e.code : -1, e.retryable ?? true), code: e.code };
        }
      }
      return false;
    } finally {
      this.starting = false;
    }
  }

  /** Camera tracks stop at once; SDK stop + destroy follow (< 1 s). */
  async stopSensing(): Promise<void> {
    const wasLive = this.sense.running || this.cameraOn;
    this.cameraOn = false;
    this.stream = null;
    if (this.recording) await this.toggleRecording();
    if (wasLive) await this.sense.stop();
    this.sense.closePreview();
    if (this.mode === 'live') this.mode = 'idle';
  }

  async openPreview(): Promise<void> {
    try {
      this.stream = await this.sense.openPreview({ ...this.captureSettings(), ...(settings.value.cameraId ? { deviceId: settings.value.cameraId } : {}) });
      this.cameraOn = true;
    } catch {
      this.note = noteForError(EC.kInputUnavailable, true);
    }
  }

  private onLiveEvent(e: SenseEvent): void {
    if (this.mode !== 'live' || !this.pipeline) return;
    this.recorder?.push(e);
    this.probeSink?.(e);
    if (e.kind === 'validation') this.lastValidation = e;
    if (e.kind === 'error') this.onSdkError(e.code, e.message, e.retryable);
    const evs = this.pipeline.handle(e, this.clock.nowUs());
    this.afterPipeline(evs);
  }

  private onSdkError(code: number, _message: string, retryable: boolean): void {
    if (code === EC.kSustainedLowFrameRate) {
      this.capture = { ...LOW_CAPTURE };
      // Hide the mirror for this session only (less work per frame); never
      // change the saved setting.
      this.mirrorSuspended = true;
    }
    if (code === EC.kNonMonotonicTimestamp || code === EC.kTimestampGap || code === EC.kFrameConversionFailed) return;
    this.note = { ...noteForError(code, retryable), code };
    void this.stopSensing();
    this.pipeline?.stop(this.clock.nowUs());
    this.audio?.silence();
  }

  /** Settings choice, lowered automatically after a sustained-low-frame-rate stop. */
  private captureSettings(): CaptureSettings {
    if (settings.value.captureSize === '960x540' || this.capture.width < 1280) return { ...LOW_CAPTURE };
    return { ...DEFAULT_CAPTURE };
  }

  rebuildPipeline(): void {
    const p = this.mode === 'replay' ? this.replayData?.header.profile ?? null : profileStore.profile;
    this.pipeline = new Pipeline({
      profile: p,
      mode: this.tempoMode(p),
      voices: this.voices,
      gesture: settings.value.readyGesture,
      seed: this.mode === 'replay' ? 1 : (Date.now() & 0xffff),
      fuseAbdomen: settings.value.fuseAbdomen,
    });
    this.pipeline.onSample = (s) => { this.level = s.v; };
    if (this.lastValidation && this.mode === 'live') this.pipeline.handle(this.lastValidation, this.clock.nowUs());
  }

  tempoMode(p = this.pipeline ? (this.mode === 'replay' ? this.replayData?.header.profile ?? null : profileStore.profile) : null): TempoMode {
    const target = this.drill ? this.drill.def.targets[this.drill.index] ?? settings.value.targetBpm : settings.value.targetBpm;
    if (p && p.predictionTrusted) return { kind: 'predict', k: p.k, targetBpm: target };
    return { kind: 'fixed', targetBpm: target };
  }

  get targetBpm(): number {
    return this.drill ? this.drill.def.targets[this.drill.index] ?? settings.value.targetBpm : settings.value.targetBpm;
  }

  private startTicking(): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => this.tick(), this.mode === 'replay' ? 8 : 30);
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.tickTimer = null;
    this.deadlineTimer = null;
  }

  private tick(): void {
    if (!this.pipeline) return;
    const t = nowPerf();
    if (t - this.lastEpochRefresh > 1000) {
      this.clock.refreshEpochOffset();
      this.lastEpochRefresh = t;
    }
    if (this.mode === 'replay' && this.cursor) {
      stepReplay(this.pipeline, this.cursor, this.clock.nowUs(), {
        onEngine: (evs) => this.handleEngine(evs),
        onSense: (e) => { if (e.kind === 'metrics' || e.kind === 'validation') this.refreshSnapshot(); },
        metronomeBpm: () => this.targetBpm,
      });
      if (this.cursor.done && !this.replayEnded && !this.sounding && this.pipeline.engine.phaseKind === 'listening') {
        this.replayEnded = true;
        this.announce('End of the recorded session.');
      }
      this.refreshSnapshot();
      return;
    }
    this.afterPipeline(this.pipeline.tick(this.clock.nowUs()));
  }

  private afterPipeline(evs: EngineEvent[]): void {
    if (evs.length) this.handleEngine(evs);
    this.refreshSnapshot();
    this.armDeadline();
  }

  private armDeadline(): void {
    if (!this.pipeline || this.mode === 'replay') return;
    const d = this.pipeline.engine.nextDeadline();
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    if (d === null) return;
    const wait = Math.max(0, this.clock.sdkToPerf(d) - nowPerf());
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      if (this.pipeline) this.afterPipeline(this.pipeline.tick(this.clock.nowUs()));
    }, wait);
  }

  private refreshSnapshot(): void {
    if (!this.pipeline) return;
    const now = this.mode === 'replay' ? this.clock.nowUs() : this.clock.nowUs();
    const s = this.pipeline.snapshot(now);
    this.gate = s.gate;
    this.pitchDeg = s.pitchDeg;
    this.head = this.pipeline.lastHead;
    this.rateConfidence = s.rateConfidence;
    this.landmarkCount = s.landmarkCount;
    if (!this.pipeline.calibrated) this.level = s.level;
    const sensingScreens: Screen[] = ['setup', 'warmup', 'calibration', 'practice', 'drills'];
    if (s.gate.state === 'paused' && (this.mode === 'live' || this.mode === 'replay') && sensingScreens.includes(this.screen)) {
      const title = pauseTitle(s.gate.code);
      if (!this.pause) {
        this.audio?.silence();
        this.caption('The ensemble pauses', 'plain');
      }
      this.pause = { title, hint: s.gate.hint || 'Breathing data stopped. Check the camera.' };
    } else if (this.pause) {
      this.pause = null;
      this.announce('The choir is listening again.');
    }
    if (this.screen === 'warmup' && s.gate.breathingStable && !this.warmupStable) {
      this.warmupStable = true;
      this.audio?.humOff();
      this.caption('The tuning hum fades — the choir is in tune', 'plain');
      this.announce('The choir is in tune.');
    }
  }

  // ── engine events → scene, sound, captions ────────────────────────────
  private handleEngine(evs: EngineEvent[]): void {
    for (const e of evs) {
      switch (e.type) {
        case 'armed':
          this.armed = true;
          this.armSource = e.source;
          this.announce('Ready. The ensemble is watching you.');
          break;
        case 'disarmed':
          this.armed = false;
          this.armSource = null;
          if (e.reason === 'talking') this.caption('Ready cancelled — talking', 'plain');
          break;
        case 'onset':
          this.onset = { perf: this.clock.sdkToPerf(e.t0), level: this.level };
          break;
        case 'plan':
          this.plan = {
            id: e.plan.id,
            t0Perf: e.plan.t0 !== undefined ? this.clock.sdkToPerf(e.plan.t0) : nowPerf(),
            downbeatPerf: this.clock.sdkToPerf(e.plan.entryAt),
            cause: e.plan.cause,
          };
          break;
        case 'count': {
          const perf = this.clock.sdkToPerf(e.at);
          if (this.audio && this.clock.hasAudio()) this.audio.clickAt(this.clock.sdkToAudio(e.at), e.beat === 1);
          this.visualCues.push({ perf, label: String(e.beat) });
          this.captionAt(perf, `Count ${e.beat}`, 'plain');
          break;
        }
        case 'commit':
          this.onCommit(e.entry);
          break;
        case 'result':
          this.onResult(e.result);
          break;
        case 'release': {
          const at = this.clock.hasAudio() ? this.clock.sdkToAudio(e.at) : undefined;
          this.audio?.releaseAll(at);
          const perf = this.clock.sdkToPerf(e.at);
          if (e.cause !== 'stop') this.captionAt(perf, e.cause === 'cue' ? `${this.who()} releases on your cue` : `${this.who()} releases`, 'plain');
          setTimeout(() => {
            this.sounding = false;
            this.voiceLitPerf = [];
            this.plan = null;
            this.onset = null;
          }, Math.max(0, perf - nowPerf()) + 350);
          break;
        }
        case 'cancelled':
          this.plan = null;
          this.onset = null;
          this.caption(`Entry held back — ${e.reason}`, 'plain');
          break;
        case 'nod':
        case 'peak':
          break;
      }
    }
  }

  private who(): string {
    return settings.value.ensemble === 'choir' ? 'Choir' : 'Quartet';
  }

  private onCommit(entry: CommittedEntry): void {
    this.entries.set(entry.id, entry);
    if (this.entries.size > 50) this.entries.delete(this.entries.keys().next().value!);
    this.entryQuality = entry.quality;
    if (this.audio && this.audio.running) {
      const sch = this.audio.scheduleEntry(entry, this.clock);
      this.voiceLitPerf = sch.times.map((t) => (this.clock.hasAudio() ? this.clock.audioToPerf(t as never) : nowPerf()));
    } else {
      const base = this.clock.sdkToPerf(entry.soundAt);
      this.voiceLitPerf = entry.offsetsMs.map((o) => base + o);
    }
    const lateCut = Math.min(...entry.offsetsMs) + 50;
    this.voiceLate = entry.offsetsMs.map((o) => entry.quality === 'ragged' && o > lateCut);
    this.sounding = true;
    const downbeat = this.clock.sdkToPerf(entry.soundAt);
    this.visualCues.push({ perf: downbeat, label: null });
    this.captionAt(downbeat, entryCaption(entry, settings.value.ensemble), entry.quality === 'ragged' ? 'ragged' : entry.quality === 'tight' ? 'together' : 'plain');
  }

  private onResult(r: CueResult): void {
    const entry = this.entries.get(r.id);
    this.results = [...this.results, r];
    this.strip = [...this.strip, r].slice(-10);
    this.feedback = feedbackLines(r, entry);
    this.feedbackTone = r.quality === 'tight' ? 'together' : r.quality === 'ragged' ? 'ragged' : 'plain';
    this.announce(this.feedback.join(' '));
    if (this.drill && r.cause === 'breath') {
      const d = this.drill;
      const results = [...d.results, r];
      const index = d.index + 1;
      if (index >= d.def.targets.length) {
        this.finishDrill(d.def, results);
      } else {
        this.drill = { ...d, index, results };
        this.pipeline?.engine.setMode(this.tempoMode());
      }
    }
  }

  // ── keys ──────────────────────────────────────────────────────────────
  keyReady(): void {
    if (!this.pipeline || this.mode !== 'live') return;
    const e: SenseEvent = { kind: 'key', recvUs: this.clock.nowUs(), key: 'ready' };
    this.recorder?.push(e);
    this.afterPipeline(this.pipeline.handle(e, e.recvUs));
    if (!this.pipeline.calibrated) this.caption('Calibrate first so the choir can read your breath', 'plain');
    else if (!this.gate?.cuesAllowed) this.caption(`Not yet — ${this.gate?.reason ?? 'waiting'}`, 'plain');
  }

  async keyMetronome(): Promise<void> {
    await this.ensureAudio();
    if (!this.pipeline) {
      this.mode = this.mode === 'idle' ? 'metronome' : this.mode;
      this.rebuildPipeline();
      this.startTicking();
    } else if (!this.tickTimer) {
      this.startTicking();
    }
    if (this.mode === 'replay') return;
    const now = this.clock.nowUs();
    if (this.mode === 'live') this.recorder?.push({ kind: 'key', recvUs: now, key: 'metronome' });
    this.afterPipeline(this.pipeline!.metronome(now, this.targetBpm));
  }

  /** Esc / Stop: sensing and sound stop within 1 s, from anywhere. */
  async stopAll(): Promise<void> {
    this.curtain = null;
    this.plates = false;
    this.cancelCalibration();
    const now = this.clock.nowUs();
    if (this.pipeline) this.handleEngine(this.pipeline.stop(now));
    this.audio?.silence();
    this.stopReplay();
    const hadSensing = this.cameraOn || this.mode === 'live';
    await this.stopSensing();
    this.stopTicking();
    this.armed = false;
    this.sounding = false;
    this.voiceLitPerf = [];
    this.plan = null;
    this.onset = null;
    this.pause = null;
    this.drill = null;
    this.countLabel = null;
    this.visualCues = [];
    this.mode = this.pipeline ? 'metronome' : 'idle';
    if (hadSensing) {
      this.stoppedNote = true;
      this.caption('Sensing stopped', 'plain');
    }
    this.announce('Stopped. The camera is off.');
  }

  async resume(): Promise<void> {
    this.stoppedNote = false;
    await this.startSensing();
  }

  async shutdown(): Promise<void> {
    this.stopReplay();
    this.cancelCalibration();
    this.audio?.silence();
    await this.stopSensing();
    this.stopTicking();
    cancelAnimationFrame(this.raf);
  }

  // ── captions & announcements ──────────────────────────────────────────
  caption(text: string, tone: Caption['tone']): void {
    const c = { id: ++this.captionId, text, tone };
    this.captions = [...this.captions, c].slice(-3);
  }

  private captionAt(perf: number, text: string, tone: Caption['tone']): void {
    const wait = Math.max(0, perf - nowPerf());
    if (wait < 5) this.caption(text, tone);
    else setTimeout(() => this.caption(text, tone), wait);
  }

  announce(text: string): void {
    this.announcement = '';
    queueMicrotask(() => { this.announcement = text; });
  }

  private updateVisualCue(): void {
    if (this.visualCues.length === 0) return;
    const t = nowPerf();
    let label: string | null | undefined;
    while (this.visualCues.length && this.visualCues[0]!.perf <= t) label = this.visualCues.shift()!.label;
    if (label !== undefined) this.countLabel = label;
  }

  // ── replay (F12) ──────────────────────────────────────────────────────
  async startReplay(text?: string): Promise<void> {
    await this.ensureAudio();
    await this.stopSensing();
    this.stopReplay();
    const body = text ?? (await (await fetch('fixtures/demo-session.jsonl')).text());
    this.replayData = parseRecording(body);
    const h = this.replayData.header;
    this.replayInfo = { synthetic: h.synthetic, description: h.description };
    this.replayEnded = false;
    this.mode = 'replay';
    this.results = [];
    this.strip = [];
    this.feedback = [];
    if (h.ensemble && h.ensemble !== settings.value.ensemble) await this.setEnsemble(h.ensemble);
    if (h.targetBpm) await settings.update({ targetBpm: h.targetBpm });
    this.rebuildPipeline();
    this.cursor = new ReplayCursor(this.replayData, us(this.clock.nowUs() + 400_000));
    this.screen = 'practice';
    this.startTicking();
  }

  stopReplay(): void {
    if (this.mode !== 'replay') return;
    this.cursor = null;
    this.replayInfo = null;
    this.mode = 'idle';
    this.stopTicking();
    this.audio?.silence();
  }

  // ── recorder ──────────────────────────────────────────────────────────
  async toggleRecording(): Promise<void> {
    if (!this.recording) {
      if (this.mode !== 'live') return;
      const header: ReplayHeader = {
        kind: 'header', format: 'upbeat-replay', version: 1, createdAt: new Date().toISOString(),
        synthetic: false, description: 'Recorded Upbeat session (numbers only)',
        frameSize: { w: this.capture.width, h: this.capture.height },
        ...(profileStore.profile ? { profile: $state.snapshot(profileStore.profile) } : {}),
        targetBpm: settings.value.targetBpm, ensemble: settings.value.ensemble,
      };
      this.recorder = new Recorder(header);
      this.recorder.start();
      if (this.lastValidation) this.recorder.push(this.lastValidation);
      this.recording = true;
      this.caption('Recording numbers (no video)', 'plain');
    } else {
      const text = this.recorder?.stop() ?? '';
      this.recorder = null;
      this.recording = false;
      if (text.split('\n').length > 2) this.lastRecording = (await window.upbeat?.rec.save(text)) ?? null;
      this.caption('Recording saved', 'plain');
    }
  }

  // ── warm-up (F2) ──────────────────────────────────────────────────────
  async beginWarmup(): Promise<void> {
    this.screen = 'warmup';
    this.warmupStartedAt = nowPerf();
    this.warmupStable = !!this.gate?.breathingStable;
    if (!this.sense.running) {
      const ok = await this.startSensing();
      if (!ok) return;
    }
    if (!this.warmupStable) this.audio?.humOn();
  }

  afterWarmup(): void {
    this.audio?.humOff();
    if (!profileStore.profile) {
      this.calib = { phase: 'intro', restLeftS: CUE.REST_WINDOW_S, trial: 0, bpm: 60, outcome: null };
      this.screen = 'calibration';
    } else {
      this.toPractice();
    }
  }

  toPractice(): void {
    this.screen = 'practice';
    this.rebuildPipeline();
    if (!settings.value.platesSeen) this.plates = true;
  }

  // ── calibration (F3) ──────────────────────────────────────────────────
  startCalibration(): void {
    if (!this.pipeline || this.mode !== 'live') return;
    this.cancelCalibration();
    // Calibrate on a pipeline without a profile (raw capture only).
    this.pipeline = new Pipeline({ profile: null, mode: { kind: 'fixed', targetBpm: 60 }, voices: this.voices, gesture: false, seed: 1, fuseAbdomen: false });
    this.pipeline.onSample = (s) => { this.level = s.v; };
    if (this.lastValidation) this.pipeline.handle(this.lastValidation, this.clock.nowUs());
    this.pipeline.startCapture();
    const restFrom = this.clock.nowUs();
    this.calib = { phase: 'rest', restLeftS: CUE.REST_WINDOW_S, trial: 0, bpm: 60, outcome: null };
    const restMs = CUE.REST_WINDOW_S * 1000;
    const countdown = setInterval(() => {
      this.calib.restLeftS = Math.max(0, Math.ceil((restMs - (Number(this.clock.nowUs() - restFrom) / 1000)) / 1000));
    }, 250);
    this.calibTimers.push(countdown as unknown as ReturnType<typeof setTimeout>);
    this.calibTimers.push(setTimeout(() => {
      clearInterval(countdown);
      this.runTrials(restFrom, us(restFrom + restMs * 1000));
    }, restMs));
  }

  private runTrials(restFrom: Microseconds, restTo: Microseconds): void {
    this.calib.phase = 'trials';
    const trials: TrialTiming[] = [];
    let start = this.clock.nowUs() + 1_500_000;
    const rng = mulberry32(42);
    CALIBRATION_TEMPI.forEach((bpm, i) => {
      const tr = trialTiming(us(start), bpm);
      trials.push(tr);
      const beatUs = bpmToBeat(bpm) * 1e6;
      const startPerf = this.clock.sdkToPerf(tr.start);
      this.calibTimers.push(setTimeout(() => { this.calib.trial = i; this.calib.bpm = bpm; }, Math.max(0, startPerf - nowPerf() - 400)));
      for (let b = 0; b < 4; b++) {
        const at = us(tr.start + b * beatUs);
        const perf = this.clock.sdkToPerf(at);
        if (this.audio && this.clock.hasAudio()) this.audio.clickAt(this.clock.sdkToAudio(at), b === 0);
        this.visualCues.push({ perf, label: b === 3 ? 'breathe in' : String(b + 1) });
      }
      // The choir enters on the downbeat, together (it is following the
      // metronome here, not the breath).
      const entry: CommittedEntry = {
        id: -1 - i, cause: 'metronome', entryAt: tr.downbeatAt, beat: tr.beat, beatSource: 'target', tooFast: false,
        quality: 'tight', offsetsMs: voiceOffsets('tight', this.voices, rng), soundAt: tr.downbeatAt, reason: 'calibration',
      };
      const dbPerf = this.clock.sdkToPerf(tr.downbeatAt);
      this.calibTimers.push(setTimeout(() => {
        if (this.audio?.running) {
          const sch = this.audio.scheduleEntry(entry, this.clock);
          this.voiceLitPerf = sch.times.map((t) => this.clock.audioToPerf(t as never));
          this.voiceLate = sch.times.map(() => false);
          this.sounding = true;
          this.audio.releaseAll(sch.times[0]! + 1.1);
        }
        this.visualCues.push({ perf: dbPerf, label: 'enter' });
      }, Math.max(0, dbPerf - nowPerf() - 250)));
      this.calibTimers.push(setTimeout(() => { this.sounding = false; this.voiceLitPerf = []; }, Math.max(0, dbPerf - nowPerf() + 1500)));
      start += 4 * beatUs + 3_500_000;
    });
    const end = this.clock.sdkToPerf(trials[trials.length - 1]!.windowTo) + 600;
    this.calibTimers.push(setTimeout(() => this.analyseCalibration(restFrom, restTo, trials), Math.max(0, end - nowPerf())));
  }

  private analyseCalibration(restFrom: Microseconds, restTo: Microseconds, trials: TrialTiming[]): void {
    this.calib.phase = 'analysing';
    this.countLabel = null;
    const cap = this.pipeline!.capture;
    this.pipeline!.stopCapture();
    const outcome = calibrate({
      chest: cap.chest, abdomen: cap.abdomen, head: cap.head, restFrom, restTo, trials,
      ...(profileStore.profile ? { previousK: profileStore.profile.k } : {}),
    });
    this.calib = { ...this.calib, phase: 'done', outcome };
    this.announce(outcome.message);
  }

  async saveCalibration(): Promise<void> {
    const p = this.calib.outcome?.profile;
    if (!p) return;
    await profileStore.saveProfile(p);
    this.toPractice();
  }

  cancelCalibration(): void {
    this.calibTimers.forEach((t) => { clearTimeout(t); clearInterval(t as unknown as ReturnType<typeof setInterval>); });
    this.calibTimers = [];
    this.pipeline?.stopCapture();
  }

  // ── drills (F9) ───────────────────────────────────────────────────────
  startDrill(kind: DrillKind): void {
    const def = makeDrill(kind, { tempo: settings.value.targetBpm, seed: Date.now() & 0xffff });
    this.drill = { def, index: 0, results: [] };
    this.lastScore = null;
    this.screen = 'drills';
    this.pipeline?.engine.setMode(this.tempoMode());
    this.announce(`${def.title}. ${def.blurb}`);
  }

  private finishDrill(def: DrillDef, results: CueResult[]): void {
    const score = scoreDrill(def.kind, results);
    this.lastScore = score;
    this.drill = null;
    void profileStore.addHistory({
      at: new Date().toISOString(), kind: def.kind, cues: score.cues,
      meanErrorBpm: score.meanErrorBpm, spreadBpm: score.spreadBpm, meanAbsErrorBpm: score.meanAbsErrorBpm,
      tightFraction: score.tightFraction,
      ...(score.predictionErrorBpm !== undefined ? { predictionErrorBpm: score.predictionErrorBpm } : {}),
      targets: results.map((r) => r.targetBpm ?? 0),
      set: results.map((r) => scoredTempo(r) ?? null),
      measured: results.map((r) => r.measuredBpm ?? null),
      qualities: results.map((r) => r.quality),
      replay: this.mode === 'replay',
    });
    this.pipeline?.engine.setMode(this.tempoMode());
    setTimeout(() => { this.screen = 'results'; void this.stopSensing(); }, 1800);
  }

  /** Camera frame size (the stream's actual settings). */
  frameSize(): { w: number; h: number } {
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    return { w: s?.width ?? 1280, h: s?.height ?? 720 };
  }

  /** Framing check: face centred, distance, chest in view (with hints). */
  framing(): Framing {
    const { w, h } = this.frameSize();
    return assessFraming(this.head, w, h, this.gate?.code ?? 0);
  }

  /** The one framing instruction to show the person. */
  framingText(): string {
    return framingInstruction(this.framing());
  }

  timingSnapshot(): void {
    if (!this.pipeline) return;
    this.delays = { newest: this.pipeline.delays.summary(), samples: this.pipeline.sampleDelays.summary() };
  }

  elapsedMs(since: number): number {
    return ms(nowPerf() - since);
  }
}

export const session = new Session();
