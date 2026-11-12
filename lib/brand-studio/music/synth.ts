/**
 * Pure TypeScript 16-bit PCM WAV synthesizer for Brand Studio Music Preview (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Synthesizes a warm Rhodes electric-piano + airy pad chord progression at the exact `bpm` and
 * `keySignature`, carves a dramatic `Pre-Drop Hush` vacuum window immediately before `revealSec`,
 * lands a `0ms` sub-bass & kick drop right on `revealSec`, and normalizes output to a `-14 LUFS`
 * broadcast feel (`-1.0 dBTP` ceiling).
 */

export interface SynthMusicInput {
  bpm: number;
  keySignature: string;
  durationSec: number;
  revealSec?: number | null;
  preDropHushMs?: number;
  sampleRate?: number;
}

export interface SynthMusicOutput {
  bytes: Uint8Array;
  mime: 'audio/wav';
  dataUrl: string;
  sampleRate: number;
  durationSec: number;
  dropSec: number;
  hushStartSec: number;
  dropSampleIndex: number;
  hushStartSampleIndex: number;
  peakAmplitude: number;
  rmsDb: number;
}

const KEY_ROOT_HZ: Readonly<Record<string, number>> = {
  Cm: 130.81,
  C: 130.81,
  Dm: 146.83,
  Em: 164.81,
  Fm: 174.61,
  F: 174.61,
  Gm: 196.0,
  Am: 220.0,
};

// Semitone intervals for warm Neo-Soul / French House progressions
const MINOR_CHORDS: ReadonlyArray<readonly number[]> = [
  [0, 3, 7, 10, 14], // i9
  [-4, 0, 3, 7, 10], // VI7
  [5, 8, 12, 15],    // iv7
  [7, 10, 14, 17],   // v7sus4
];

const MAJOR_CHORDS: ReadonlyArray<readonly number[]> = [
  [0, 4, 7, 11, 14], // Imaj9
  [9, 12, 16, 19],   // vi7
  [5, 9, 12, 16],    // IVmaj7
  [7, 12, 14, 17],   // V9sus4
];

function semitoneHz(rootHz: number, semitones: number): number {
  return rootHz * Math.pow(2, semitones / 12);
}

export function wavBytesToDataUrl(bytes: Uint8Array): string {
  return `data:audio/wav;base64,${Buffer.from(bytes).toString('base64')}`;
}

export function synthesizePreviewMusicWav(input: SynthMusicInput): SynthMusicOutput {
  const sampleRate = Math.max(8000, Math.min(48_000, Math.trunc(input.sampleRate ?? 24_000)));
  const durationSec = Math.max(1, Math.min(60, input.durationSec));
  const bpm = Math.max(60, Math.min(180, input.bpm));
  const totalSamples = Math.max(sampleRate, Math.round(durationSec * sampleRate));

  const revealSec =
    input.revealSec != null && Number.isFinite(input.revealSec)
      ? Math.max(0.2, Math.min(durationSec - 0.2, input.revealSec))
      : Math.min(durationSec * 0.35, 3.8);

  const hushSec = Math.max(0, Math.min(0.6, (input.preDropHushMs ?? 180) / 1000));
  const hushStartSec = Math.max(0, revealSec - hushSec);
  const hushStartSampleIndex = Math.round(hushStartSec * sampleRate);
  const dropSampleIndex = Math.round(revealSec * sampleRate);

  const isMajor = input.keySignature === 'C' || input.keySignature === 'F';
  const rootHz = KEY_ROOT_HZ[input.keySignature] ?? KEY_ROOT_HZ.Dm!;
  const chords = isMajor ? MAJOR_CHORDS : MINOR_CHORDS;

  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const twoPi = Math.PI * 2;

  const floatBuf = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;

    // Pre-Drop Hush window: dramatic vacuum tension right before revealSec
    if (i >= hushStartSampleIndex && i < dropSampleIndex) {
      const hushProgress =
        dropSampleIndex > hushStartSampleIndex
          ? (i - hushStartSampleIndex) / (dropSampleIndex - hushStartSampleIndex)
          : 1;
      // Smooth duck down to strict silence before the 0ms drop
      const tailFade = hushProgress < 0.18 ? 1 - hushProgress / 0.18 : 0;
      if (tailFade <= 0.001) {
        floatBuf[i] = 0;
        continue;
      }
      const padOnly = Math.sin(twoPi * rootHz * t) * 0.04 * tailFade;
      floatBuf[i] = padOnly;
      continue;
    }

    const isPostDrop = i >= dropSampleIndex;
    // Align beat phase so `t === revealSec` is an exact `0ms` downbeat!
    const relTime = t - revealSec;
    const beatPos = ((relTime / beatSec) % 1 + 1) % 1;
    const barIndex = Math.floor(((t / barSec) % chords.length + chords.length)) % chords.length;
    const chord = chords[barIndex]!;

    // 1. Warm Rhodes electric piano chord + soft pad bed
    const chordDecay = Math.exp(-beatPos * (isPostDrop ? 2.6 : 1.9));
    let chordSum = 0;
    for (let n = 0; n < chord.length; n += 1) {
      const freq = semitoneHz(rootHz, chord[n]!);
      const tine =
        Math.sin(twoPi * freq * t) * 0.72 +
        Math.sin(twoPi * freq * 2 * t) * 0.18 * Math.exp(-beatPos * 5.5) +
        Math.sin(twoPi * freq * 3 * t) * 0.06 * Math.exp(-beatPos * 8.0);
      chordSum += tine;
    }
    chordSum = (chordSum / chord.length) * (0.28 * chordDecay + 0.12);

    let sample = isPostDrop ? chordSum * 1.05 : chordSum * 0.72;

    // 2. Post-drop 0ms sub-bass + four-on-the-floor kick + crisp offbeat hi-hat
    if (isPostDrop) {
      const timeSinceDrop = (i - dropSampleIndex) / sampleRate;
      const beatInDropSec = beatPos * beatSec;

      // Sub-bass sidechained slightly to the kick
      const subFreq = semitoneHz(rootHz * 0.5, chord[0]!);
      const sidechain = Math.min(1, beatInDropSec / 0.11);
      const subBass =
        (Math.sin(twoPi * subFreq * t) * 0.8 + Math.sin(twoPi * subFreq * 2 * t) * 0.2) *
        0.34 *
        (0.35 + 0.65 * sidechain);
      sample += subBass;

      // Kick transient on every beat (strongest at exact 0ms reveal drop!)
      if (beatInDropSec < 0.18) {
        const kEnv = Math.exp(-beatInDropSec * 22);
        const kFreq = 48 + 92 * Math.exp(-beatInDropSec * 38);
        const dropImpactBoost = timeSinceDrop < 0.18 ? 1.35 : 1.0;
        sample += Math.sin(twoPi * kFreq * beatInDropSec) * 0.58 * kEnv * dropImpactBoost;
      }

      // Brushed off-beat hi-hat deterministic shimmer
      const halfBeatPos = ((beatPos * 2) % 1 + 1) % 1;
      const hatSec = halfBeatPos * (beatSec * 0.5);
      if (hatSec < 0.045) {
        const hatEnv = Math.exp(-hatSec * 65);
        const metallic =
          Math.sin(twoPi * 6340 * t) * 0.4 +
          Math.sin(twoPi * 8190 * t) * 0.35 +
          Math.sin(twoPi * 10_430 * t) * 0.25;
        sample += metallic * 0.09 * hatEnv;
      }
    }

    floatBuf[i] = sample;
  }

  // Smooth fade-in (15ms) and fade-out (120ms) to eliminate boundary clicks
  const fadeInSamples = Math.min(totalSamples, Math.round(0.015 * sampleRate));
  const fadeOutSamples = Math.min(totalSamples, Math.round(0.12 * sampleRate));
  for (let i = 0; i < fadeInSamples; i += 1) {
    floatBuf[i] = floatBuf[i]! * (i / fadeInSamples);
  }
  for (let i = 0; i < fadeOutSamples; i += 1) {
    const idx = totalSamples - 1 - i;
    floatBuf[idx] = floatBuf[idx]! * (i / fadeOutSamples);
  }

  // Normalize integrated RMS toward -14 dBFS feel (~0.1995) with -1.0 dBTP (0.891) true-peak limiter
  let sqSum = 0;
  let activeCount = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    if (i >= hushStartSampleIndex && i < dropSampleIndex) continue;
    const v = floatBuf[i]!;
    sqSum += v * v;
    activeCount += 1;
  }
  const rawRms = activeCount > 0 ? Math.sqrt(sqSum / activeCount) : 0.1;
  const targetRms = 0.1995; // -14.0 dBFS
  const gain = rawRms > 1e-5 ? Math.min(4.0, targetRms / rawRms) : 1.0;
  const ceiling = 0.891; // -1.0 dBTP

  let peakAmplitude = 0;
  let finalSqSum = 0;

  const dataByteLen = totalSamples * 2;
  const wav = new Uint8Array(44 + dataByteLen);
  const view = new DataView(wav.buffer);

  // RIFF WAVE header (16-bit mono PCM)
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataByteLen, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataByteLen, true);

  for (let i = 0; i < totalSamples; i += 1) {
    let x = floatBuf[i]! * gain;
    // Soft saturating true-peak limiter capped strictly at -1.0 dBTP
    if (Math.abs(x) > ceiling) {
      x = Math.sign(x) * ceiling * Math.tanh(Math.abs(x) / ceiling);
    }
    const absX = Math.abs(x);
    if (absX > peakAmplitude) peakAmplitude = absX;
    finalSqSum += x * x;

    const pcm = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
    view.setInt16(44 + i * 2, pcm, true);
  }

  const finalRms = Math.sqrt(finalSqSum / totalSamples);
  const rmsDb = Math.round(20 * Math.log10(Math.max(1e-6, finalRms)) * 100) / 100;

  return {
    bytes: wav,
    mime: 'audio/wav',
    dataUrl: wavBytesToDataUrl(wav),
    sampleRate,
    durationSec,
    dropSec: revealSec,
    hushStartSec,
    dropSampleIndex,
    hushStartSampleIndex,
    peakAmplitude: Math.round(peakAmplitude * 10000) / 10000,
    rmsDb,
  };
}
