// Reference acoustic "signature" of assets/sounds/click.wav, precomputed
// OFFLINE (once, not at app startup, not per-beat) so the app never needs to
// decode the WAV file itself or add a file-system/audio-decoding dependency
// just to build a reference template.
//
// How this was generated: click.wav is mono/24-bit/192kHz; its audible
// transient starts almost immediately (~0.02ms in) and is fully decayed
// within ~24ms. A 24ms window from that onset was extracted and Hann-windowed,
// then:
//   - spectrum: magnitude at each of TEMPLATE_FREQS_HZ, computed directly via
//     the Goertzel algorithm (see analyzeGoertzelMagnitude in audio-dsp.ts —
//     the runtime code re-runs the exact same function on live audio so the
//     two sides of the comparison are computed identically), then
//     max-normalized to 1.0.
//   - envelope: RMS of TEMPLATE_ENVELOPE_SLICES equal-length slices across
//     that same window, max-normalized to 1.0.
// Re-run this analysis (see the tool-call history for the exact script) if
// click.wav is ever replaced with a different sample.

// The window length (from the detected onset) that both the reference above
// and the live candidate segment (see sync-recorder.tsx) are computed over.
export const TEMPLATE_WINDOW_MS = 24;

// Frequency points (Hz) at which the spectral signature is sampled — a fixed
// grid rather than raw FFT bins, so the comparison is independent of
// whatever sample rate/window length the live analysis happens to use.
export const TEMPLATE_FREQS_HZ = [
  300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2100,
  2250, 2400, 2550, 2700, 2850, 3000, 3150, 3300, 3450, 3600, 3750, 3900,
  4050, 4200, 4350, 4500, 4650, 4800, 4950, 5100, 5250, 5400, 5550, 5700,
  5850, 6000,
];

// Max-normalized (0..1) magnitude at each of TEMPLATE_FREQS_HZ above.
// Dominant peak sits at 3000 Hz, matching the "narrow band around 3-4kHz"
// design goal — click.wav already is that click.
export const TEMPLATE_SPECTRUM = [
  0.0834, 0.3971, 0.1119, 0.1803, 0.4541, 0.2596, 0.1869, 0.0767, 0.0462,
  0.0354, 0.0396, 0.03, 0.0314, 0.0615, 0.0727, 0.0913, 0.1698, 0.6026, 1.0,
  0.4774, 0.3252, 0.1803, 0.0777, 0.0433, 0.0461, 0.0483, 0.067, 0.0593,
  0.0928, 0.1022, 0.1025, 0.1428, 0.1008, 0.0371, 0.0175, 0.0068, 0.0048,
  0.0068, 0.0049,
];

// Number of equal-length slices the envelope shape is sampled into.
export const TEMPLATE_ENVELOPE_SLICES = 12;

// Max-normalized (0..1) RMS per slice — a fast, percussive attack (near-full
// amplitude in the first two slices) decaying to near-silence by slice 3.
export const TEMPLATE_ENVELOPE = [
  0.9732, 1.0, 0.1842, 0.1114, 0.0565, 0.0308, 0.0114, 0.0136, 0.0097, 0.0096,
  0.0112, 0.0073,
];
