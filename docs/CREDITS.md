# Credits and licences

Every font, sample and library that ships with Upbeat, with its licence. Nothing is loaded from the network at run time except SmartSpectra's own licence check.

## Fonts (bundled via Fontsource)

| Font | Designer | Licence | Package |
|---|---|---|---|
| Cormorant Garamond (500, 600, 600 italic) | Christian Thalmann, Catharsis Fonts | SIL Open Font License 1.1 | `@fontsource/cormorant-garamond` 5.3.0 |
| Cormorant SC (600), the small caps for labels and buttons | Christian Thalmann, Catharsis Fonts | SIL Open Font License 1.1 | `@fontsource/cormorant-sc` 5.3.0 |
| Source Sans 3 (400, 600) | Paul D. Hunt, Adobe | SIL Open Font License 1.1 | `@fontsource/source-sans-3` 5.3.1 |

The full OFL text ships in each package's `LICENSE` file.

## String samples

**VS Chamber Orchestra: Community Edition (VSCO 2 CE)**, by Versilian Studios: recorded by Sam Gossner and Simon Dalzell, sample cutting by Elan Hickler (Soundemote). https://github.com/sgossner/VSCO-2-CE

- **Licence: CC0 1.0 Universal (public domain dedication).** Checked against the repository's `LICENSE` on 20 Nov 2026; a copy is in [`static/samples/LICENSE-VSCO2-CE-CC0.txt`](../static/samples/LICENSE-VSCO2-CE-CC0.txt). Attribution is not required but is given here.
- Used: 8 notes each of *Solo Violin, Arco Vib* (soft dynamic, the `_p` files), *Viola Section, susvib* (v1) and *Cello Section, susvib* (v1). The Community Edition has no solo viola or cello, so the inner and bass parts use section samples.
- Changes: converted to mono 44.1 kHz Ogg Vorbis, trimmed to 5 s with a 0.8 s fade (`scripts/prepare-samples.mjs`). Each file's pitch was measured, not taken from its name. The section folders name notes one octave low (for example `ViolaEns_susvib_C2` is C3, 130.9 Hz) and the files were renamed to the measured note. The violin C4 sample measured 25 cents sharp. Measurements are in [`static/samples/samples.json`](../static/samples/samples.json).

## Sound design data

The choir's "ah" formants (frequency, bandwidth, level per voice part) are the standard singing-vowel values listed in the Csound manual's *Formant Values* appendix. They are reproduced as numbers in `src/sound/voicing.ts`.

## Software

| Package | Licence |
|---|---|
| `@smartspectra/node-sdk` 3.5.0, Presage Technologies | Proprietary: Presage Terms of Service (https://physiology.presagetech.com/tos). The package also bundles FFmpeg under LGPL; see its `THIRD_PARTY_FFMPEG.md`, `COPYING.LGPLv2.1`, `COPYING.LGPLv3` and `THIRD_PARTY_NOTICES.txt` |
| Electron 45.4.1 | MIT |
| electron-vite 6.0.0 | MIT |
| Svelte 5.58.0 | MIT |
| Tone.js 15.1.22, Yotam Mann | MIT |
| koffi 2.16.4 (an SDK dependency) | MIT |
| protobufjs 7.6.6 (an SDK dependency) | BSD-3-Clause |
| Vite, Vitest, Playwright, TypeScript, tsx (development only) | MIT / Apache-2.0 |

## Walkthrough narration

The walkthrough video's voice is **Kokoro-82M** by hexgrad (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M), run offline with **kokoro-onnx** by thewh1teagle (MIT). The voice is used only to make the video; it is not part of the app.

## Original work

The logo, icon, engraved line icons, scene drawings, cue engine and synth voices were made for Upbeat.
