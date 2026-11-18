/**
 * Fixed sentences both paths share: what a reference supplies, the keep list, the sound line, the
 * shot plan from a film sheet. The fallback is built from them; the model's output is checked
 * against them so a required line is never missing.
 */
import type { StudioAudioMode, StudioKeepKey } from '@/lib/brand-studio/contracts';
import type { BoundReference } from './references';
import type { EnhanceInput, EnhanceVideo } from './types';

export const KEEP_PHRASES: Record<StudioKeepKey, string> = {
  camera: 'the camera path',
  timing: 'the cut timing',
  composition: 'the composition',
  motion: 'the movement',
  look: 'the light, palette and texture',
};

export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function keepPhrase(keep: readonly StudioKeepKey[] | undefined): string {
  const keys = (keep ?? []).filter((k, i, all) => all.indexOf(k) === i);
  return joinList(keys.map((k) => KEEP_PHRASES[k]));
}

function clean(note: string | undefined): string | null {
  const text = (note ?? '').replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '');
  return text.length > 0 ? text : null;
}

/** One sentence on what a reference supplies and what it does not. English, model syntax. */
export function referenceClause(profile: EnhanceInput['profile'], b: BoundReference): string {
  const t = b.token ?? b.name;
  const take = clean(b.ref.use);
  const leave = clean(b.ref.avoid);
  let base: string;
  if (b.ref.kind === 'audio') {
    base = `Use ${t} for the sound`;
  } else if (b.ref.frame === 'start' && b.token) {
    base = `${t} is the opening frame: start from this picture`;
  } else if (b.ref.frame === 'end' && b.token) {
    base = `${t} is the closing frame: end on this picture`;
  } else {
    switch (b.ref.role) {
      case 'product':
        base =
          profile === 'seedance'
            ? `${t} supplies only the product: keep its exact shape, label, proportions and colours in every shot`
            : `Use ${t} only for the product and keep the exact label, proportions and colours of ${t}`;
        break;
      case 'person':
        base = `${profile === 'seedance' ? `${t} supplies` : `Use ${t} for`} only the person's face, hair and build, not the background, lighting or clothing`;
        break;
      case 'logo':
        // Nano Banana reads positive phrasing best (profiles/nano-banana.ts, Google's image docs 2026-11-19).
        base =
          profile === 'nano-banana'
            ? `Reproduce the mark from ${t} exactly as drawn: the same letterforms, orientation, proportions and colours`
            : `Use the exact mark from ${t}; do not redraw, mirror or restyle it`;
        break;
      case 'style':
        base = `Use ${t} only for its light, palette and texture, not its subject or layout`;
        break;
      case 'place':
        base = `Use ${t} only for the setting`;
        break;
      default:
        base = `Use ${t} as a reference`;
    }
  }
  const parts = [base];
  if (take) parts.push(`take from it: ${take}`);
  if (leave) parts.push(`do not take: ${leave}`);
  return `${parts.join('; ')}.`;
}

/* ----------------------------------------------------------------- sound */

export const AMBIENT_AUDIO_LINE =
  'Audio: no music, only location sound and effects. No background music, score, melody or beat.';
export const NATIVE_AUDIO_LINE = 'Audio: natural location sound and effects, with music that fits the mood.';

export function audioLine(mode: StudioAudioMode): string | null {
  if (mode === 'silent') return null;
  return mode === 'ambient' ? AMBIENT_AUDIO_LINE : NATIVE_AUDIO_LINE;
}

const AUDIO_LINE_RE = /^[ \t]*(?:\*\*)?(?:audio|sound)(?:\*\*)?\s*:.*$/gim;
const NO_MUSIC_RE = /\bno (?:background )?music\b/i;
const MUSIC_TERM =
  '(?:background\\s+)?(?:music|musical\\s+instruments?|score|melody|melodies|beats?|songs?|soundtrack|bgm)';
/** "no background music, score, melody or beat", "without music", "no music, no score" … */
const NEGATED_MUSIC_RE = new RegExp(
  `\\b(?:no|without|zero|never|not\\s+any)\\s+(?:any\\s+)?${MUSIC_TERM}\\b(?:\\s*(?:,|or|and|nor)\\s*(?:no\\s+)?${MUSIC_TERM}\\b)*|\\bmusic-free\\b`,
  'gi',
);
const MUSIC_WORD_RE = /\b(?:music|musical|score|melody|melodies|songs?|soundtrack|bgm|beats?)\b/i;

/**
 * Makes the sound line match the chosen mode. Returns null when the text contradicts the mode in a
 * way a single line cannot fix (music written into an "ambient" run).
 */
export function enforceAudio(prompt: string, mode: StudioAudioMode): string | null {
  const lines = prompt.match(AUDIO_LINE_RE) ?? [];
  if (mode === 'silent') {
    return prompt.replace(AUDIO_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (mode === 'ambient') {
    const stripped = prompt.replace(NEGATED_MUSIC_RE, ' ');
    if (MUSIC_WORD_RE.test(stripped)) return null;
    if (NO_MUSIC_RE.test(prompt)) return prompt;
    return lines.length > 0
      ? prompt.replace(lines[0]!, `${lines[0]!.trim()} ${AMBIENT_AUDIO_LINE.replace(/^Audio:\s*/, '')}`)
      : `${prompt.trim()}\n${AMBIENT_AUDIO_LINE}`;
  }
  return lines.length > 0 ? prompt : `${prompt.trim()}\n${NATIVE_AUDIO_LINE}`;
}

/* ------------------------------------------------------------ shot plan */

export interface PlannedShot {
  start: number;
  end: number;
  framing: string;
  camera: string;
  action: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Output length of a video run: asked length, or the reference's when the result follows it. */
export function effectiveSeconds(kind: EnhanceInput['kind'], video: EnhanceVideo | null | undefined): number | null {
  if (!video) return null;
  const sheetSeconds = video.sheet && video.sheet.seconds > 0 ? video.sheet.seconds : null;
  if (kind === 'video_remix' && video.method === 'edit') return sheetSeconds ?? video.seconds;
  if (video.seconds !== null && video.seconds > 0) return video.seconds;
  if (kind === 'video_remix' && sheetSeconds !== null) return Math.min(15, Math.max(4, Math.round(sheetSeconds)));
  return null;
}

/**
 * The reference's shots laid on the output length: contiguous from 0 to the end, scaled when the
 * lengths differ, at 0.1 s. Empty without a sheet or a length.
 */
export function planShots(seconds: number | null, video: EnhanceVideo | null | undefined): PlannedShot[] {
  const sheet = video?.sheet;
  if (!sheet || !seconds || sheet.seconds <= 0 || sheet.shots.length === 0) return [];
  const factor = seconds / sheet.seconds;
  const shots = [...sheet.shots].sort((a, b) => a.start - b.start);
  const planned: PlannedShot[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i]!;
    const start = i === 0 ? 0 : planned[planned.length - 1]!.end;
    const end = i === shots.length - 1 ? round1(seconds) : round1(Math.min(seconds, s.end * factor));
    if (end - start < 0.1) continue;
    planned.push({ start, end, framing: s.framing, camera: s.camera, action: s.action });
  }
  if (planned.length > 0) planned[planned.length - 1]!.end = round1(seconds);
  return planned;
}

export function formatRange(start: number, end: number): string {
  return `${start.toFixed(1)}–${end.toFixed(1)}s`;
}
