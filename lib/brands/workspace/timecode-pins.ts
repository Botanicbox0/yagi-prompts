import type { BrandDecision, BrandMessage } from './types';

export interface RealTimecodePin {
  id: string;
  seconds: number;
  label: string;
  author: 'studio' | 'brand';
  body: string;
}

export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  const hundredths = Math.floor((sec - Math.floor(sec)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

const TIMECODE_RE = /\[?@?\s*(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]?/;

function parseSecondsFromText(text: string): number | null {
  const match = TIMECODE_RE.exec(text);
  if (!match) return null;
  const mins = Number.parseInt(match[1]!, 10);
  const secs = Number.parseInt(match[2]!, 10);
  const frac = match[3] ? Number.parseInt(match[3].padEnd(2, '0'), 10) / 100 : 0;
  return mins * 60 + secs + frac;
}

/**
 * Extracts real frame/timecode pins strictly from persisted project messages and content decisions.
 * Never fabricates placeholder comments when none exist.
 */
export function extractRealTimecodePins(
  messages: readonly BrandMessage[],
  decisions: readonly BrandDecision[],
): RealTimecodePin[] {
  const pins: RealTimecodePin[] = [];

  for (const m of messages) {
    const seconds = parseSecondsFromText(m.body);
    if (seconds === null) continue;
    pins.push({
      id: `msg-${m.id}`,
      seconds,
      label: formatTimecode(seconds),
      author: m.authorRole,
      body: m.body,
    });
  }

  for (const d of decisions) {
    if (!d.comment) continue;
    const seconds = parseSecondsFromText(d.comment);
    if (seconds === null) continue;
    pins.push({
      id: `dec-${d.id}`,
      seconds,
      label: formatTimecode(seconds),
      author: 'brand',
      body: d.comment,
    });
  }

  return pins;
}
