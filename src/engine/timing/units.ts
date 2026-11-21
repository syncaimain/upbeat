// Unit-safe time values. Seconds, milliseconds and microseconds are distinct
// branded number types, so passing an SDK microsecond timestamp where the
// audio clock expects seconds is a compile error, not a 1000x bug.

declare const unit: unique symbol;
type Branded<U extends string> = number & { readonly [unit]: U };

/** Seconds — the Web Audio clock (AudioContext.currentTime) and beat lengths. */
export type Seconds = Branded<'s'>;
/** Milliseconds — performance.now(), UI timers, thresholds in config. */
export type Milliseconds = Branded<'ms'>;
/** Microseconds — SmartSpectra timestamps (epoch-based µs). */
export type Microseconds = Branded<'us'>;

export const sec = (n: number): Seconds => n as Seconds;
export const ms = (n: number): Milliseconds => n as Milliseconds;
export const us = (n: number): Microseconds => n as Microseconds;

export const usToMs = (t: Microseconds): Milliseconds => ms(t / 1000);
export const usToSec = (t: Microseconds): Seconds => sec(t / 1_000_000);
export const msToUs = (t: Milliseconds): Microseconds => us(t * 1000);
export const msToSec = (t: Milliseconds): Seconds => sec(t / 1000);
export const secToMs = (t: Seconds): Milliseconds => ms(t * 1000);
export const secToUs = (t: Seconds): Microseconds => us(t * 1_000_000);

/** Arithmetic that keeps the unit. */
export const addUs = (a: Microseconds, b: Microseconds): Microseconds => us(a + b);
export const subUs = (a: Microseconds, b: Microseconds): Microseconds => us(a - b);
export const addMs = (a: Milliseconds, b: Milliseconds): Milliseconds => ms(a + b);
export const addSec = (a: Seconds, b: Seconds): Seconds => sec(a + b);

/** Beat length in seconds ⇄ beats per minute. */
export const beatToBpm = (b: Seconds): number => 60 / b;
export const bpmToBeat = (bpm: number): Seconds => sec(60 / bpm);
