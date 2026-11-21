// SDK errors and validation codes → programme notes over a paused stage.
// Every note offers a way on (retry, settings, metronome mode): never a dead
// end. Codes verified against @smartspectra/node-sdk 3.5.0 index.d.ts.

import { VC } from './gate';

export const EC = {
  kOk: 0,
  kInvalidState: 1,
  kAuthenticationFailed: 2,
  kConfigurationFailed: 3,
  kCreditExhausted: 4,
  kNetworkError: 5,
  kServerError: 6,
  kInputUnavailable: 7,
  kProcessingFailed: 8,
  kFrameConversionFailed: 9,
  kNonMonotonicTimestamp: 10,
  kTimestampGap: 11,
  kMetricNotAuthorized: 13,
  kSustainedLowFrameRate: 14,
} as const;

export type NoteAction = 'retry' | 'metronome' | 'settings' | 'setup' | 'welcome' | 'dismiss';

export interface ErrorNote {
  readonly title: string;
  readonly body: string;
  readonly actions: readonly NoteAction[];
  /** Restarting automatically is allowed (only for transient faults). */
  readonly autoRetry: boolean;
}

export function noteForError(code: number, retryable: boolean): ErrorNote {
  switch (code) {
    case EC.kAuthenticationFailed:
      return {
        title: 'The hall could not check your key',
        body: 'SmartSpectra did not accept the API key. Check it in Setup. You can keep practising with the metronome meanwhile.',
        actions: ['setup', 'metronome'], autoRetry: false,
      };
    case EC.kCreditExhausted:
      return {
        title: 'No measurement credit left',
        body: 'This SmartSpectra key has used its credit. Metronome mode and the recorded session still work.',
        actions: ['metronome', 'welcome'], autoRetry: false,
      };
    case EC.kNetworkError:
    case EC.kServerError:
      return {
        title: 'The hall is offline',
        body: 'SmartSpectra checks its licence online and could not reach its server. Check the connection and try again.',
        actions: ['retry', 'metronome'], autoRetry: false,
      };
    case EC.kInputUnavailable:
      return {
        title: 'No camera',
        body: 'The camera could not be opened. It may be in use by another app, or unplugged. Choose a camera in Settings or try again.',
        actions: ['retry', 'settings', 'metronome'], autoRetry: false,
      };
    case EC.kSustainedLowFrameRate:
      return {
        title: 'The camera fell behind',
        body: 'The frame rate stayed too low to follow your breathing (it needs about 25 frames a second). Close other camera or video apps, improve the light, then start again.',
        actions: ['retry', 'metronome'], autoRetry: false,
      };
    case EC.kMetricNotAuthorized:
    case EC.kConfigurationFailed:
      return {
        title: 'The measurement could not be set up',
        body: 'SmartSpectra refused the requested signals for this key. Metronome mode still works.',
        actions: ['metronome', 'welcome'], autoRetry: false,
      };
    default:
      return {
        title: 'The measurement stopped',
        body: retryable
          ? 'SmartSpectra stopped unexpectedly. Try again; if it keeps happening, use metronome mode.'
          : 'SmartSpectra stopped and cannot continue this session. Metronome mode still works.',
        actions: retryable ? ['retry', 'metronome'] : ['metronome', 'welcome'], autoRetry: false,
      };
  }
}

/** Short paused-stage title for a validation code; the SDK hint is shown
 *  beneath it verbatim. */
export function pauseTitle(code: number): string {
  switch (code) {
    case VC.kNoFaceFound: return 'The choir waits — no one on the podium';
    case VC.kMultipleFacesFound: return 'The choir waits — one conductor at a time';
    case VC.kChestNotVisible: return 'The choir waits — chest out of view';
    case VC.kExcessiveMotion: return 'The choir waits — stand still';
    case VC.kTooDark: return 'The choir waits — too dark';
    case VC.kTooBright: return 'The choir waits — too bright';
    case VC.kFrameRateTooLow: return 'The choir waits — the camera is slow';
    case VC.kCameraTuning: return 'The choir waits — the camera is adjusting';
    default: return 'The choir waits';
  }
}
