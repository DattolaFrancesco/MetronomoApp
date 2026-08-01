// Small, dependency-free signal-processing helpers shared by sync-recorder's
// two click-rejection layers (on top of the pre-existing temporal gate):
//
//   1. A cascaded biquad notch filter, run continuously on the live mic
//      signal, that attenuates the narrow band the metronome click occupies
//      before amplitude/onset detection ever sees the signal.
//   2. Goertzel-based spectral + envelope "signature" matching, run only on
//      already-detected candidate onsets (a handful per bar, not the
//      continuous stream), to veto any onset whose shape closely matches the
//      click's known signature (see click-signature.ts).
//
// No FFT library is used: technique 2 only ever needs the magnitude at a
// small fixed set of known frequencies (TEMPLATE_FREQS_HZ), and the Goertzel
// algorithm computes exactly that in O(N) per frequency without the
// power-of-2-length constraint a generic FFT would impose — cheaper and
// simpler than a full FFT for this "known frequencies only" use case.

// ---- Biquad notch filter (RBJ Audio EQ Cookbook formulas) ----

export type BiquadCoeffs = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export function notchCoeffs(
  sampleRate: number,
  centerFreqHz: number,
  q: number,
): BiquadCoeffs {
  const w0 = (2 * Math.PI * centerFreqHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);

  const a0 = 1 + alpha;
  return {
    b0: 1 / a0,
    b1: (-2 * cosW0) / a0,
    b2: 1 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

// One Direct-Form-I biquad stage's running state (previous 2 inputs/outputs).
type BiquadState = { x1: number; x2: number; y1: number; y2: number };

function freshState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

// A cascade of identical notch stages in series — each extra stage roughly
// doubles the stopband attenuation (in dB) at the cost of a little more
// group delay right around the notch, negligible at audio sample rates for
// a band this narrow.
export class CascadedNotchFilter {
  private readonly coeffs: BiquadCoeffs;
  private readonly stages: BiquadState[];

  constructor(sampleRate: number, centerFreqHz: number, q: number, stages: number) {
    this.coeffs = notchCoeffs(sampleRate, centerFreqHz, q);
    this.stages = Array.from({ length: stages }, freshState);
  }

  processSample(input: number): number {
    let x = input;
    const { b0, b1, b2, a1, a2 } = this.coeffs;
    for (const s of this.stages) {
      const y = b0 * x + b1 * s.x1 + b2 * s.x2 - a1 * s.y1 - a2 * s.y2;
      s.x2 = s.x1;
      s.x1 = x;
      s.y2 = s.y1;
      s.y1 = y;
      x = y;
    }
    return x;
  }

  // In place for throughput — avoids allocating a second typed array per buffer.
  processBuffer(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      samples[i] = this.processSample(samples[i]);
    }
  }
}

// ---- Goertzel single-frequency magnitude ----

// Returns the magnitude of `samples` at `freqHz`, comparable across calls
// with a differently-sized `samples` (already normalized by N and by 2 to
// approximate a single-sided FFT magnitude).
export function goertzelMagnitude(
  samples: ArrayLike<number>,
  freqHz: number,
  sampleRate: number,
): number {
  const n = samples.length;
  if (n === 0) return 0;
  const k = (freqHz * n) / sampleRate;
  const w = (2 * Math.PI * k) / n;
  const cosW = Math.cos(w);
  const coeff = 2 * cosW;

  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cosW;
  const imag = s2 * Math.sin(w);
  return (Math.hypot(real, imag) / n) * 2;
}

export function hannWindow(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  const denom = n > 1 ? n - 1 : 1;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
    out[i] = samples[i] * w;
  }
  return out;
}

// Spectral signature: magnitude at each of `freqsHz`, Hann-windowed first,
// then max-normalized to 0..1 so it's comparable to a reference signature
// regardless of absolute input level.
export function computeSpectrumSignature(
  samples: Float32Array,
  freqsHz: readonly number[],
  sampleRate: number,
): number[] {
  const windowed = hannWindow(samples);
  const mags = freqsHz.map((f) => goertzelMagnitude(windowed, f, sampleRate));
  const max = Math.max(...mags, 1e-9);
  return mags.map((m) => m / max);
}

// Envelope signature: RMS of `sliceCount` equal-length slices, max-normalized.
export function computeEnvelopeSignature(
  samples: Float32Array,
  sliceCount: number,
): number[] {
  const n = samples.length;
  const sliceLen = n / sliceCount;
  const rms: number[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const a = Math.round(i * sliceLen);
    const b = Math.max(a + 1, Math.round((i + 1) * sliceLen));
    let sumSq = 0;
    let count = 0;
    for (let j = a; j < b && j < n; j++) {
      sumSq += samples[j] * samples[j];
      count++;
    }
    rms.push(count > 0 ? Math.sqrt(sumSq / count) : 0);
  }
  const max = Math.max(...rms, 1e-9);
  return rms.map((v) => v / max);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-9 ? dot / denom : 0;
}
