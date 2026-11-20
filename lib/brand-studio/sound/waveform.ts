/**
 * Waveform values for a sound row (docs/BRAND-SOUND-STUDIO.md §7.3): the peak of each slice of the file,
 * 0..1, rounded to hundredths so the values stay small enough to keep (SS2 stores them on the result row).
 * The browser decodes the file (Web Audio) and hands the channels here; this part has no browser in it.
 */
export const WAVEFORM_BARS = 160;

export function peaksFromChannels(channels: readonly Float32Array[], bars = WAVEFORM_BARS): number[] {
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  if (length === 0 || bars <= 0) return [];
  const count = Math.min(bars, length);
  const out: number[] = new Array(count).fill(0);
  for (let bar = 0; bar < count; bar += 1) {
    const start = Math.floor((bar * length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * length) / count));
    let peak = 0;
    for (const channel of channels) {
      const stop = Math.min(end, channel.length);
      // Sampling every few frames keeps a 3-minute file under a few milliseconds; peaks barely move.
      const step = Math.max(1, Math.floor((stop - start) / 256));
      for (let i = start; i < stop; i += step) {
        const v = Math.abs(channel[i]!);
        if (v > peak) peak = v;
      }
    }
    out[bar] = peak;
  }
  const loudest = Math.max(...out);
  // Normalised so a quiet master still draws a readable shape; silence stays flat.
  return out.map((v) => (loudest > 0.001 ? Math.round((v / loudest) * 100) / 100 : 0));
}

/** Validates stored or received values: 1..1000 numbers within 0..1. */
export function cleanPeaks(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) return null;
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return null;
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}
