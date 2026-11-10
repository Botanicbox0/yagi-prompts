/** The film sheet as Gemini returns it, and the clean-up into the contract's `FilmSheet`. */
import { z } from 'zod';
import type { FilmSheet } from '@/lib/brand-studio/contracts';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import { aspectLabel, type VideoProbe } from './probe';

const SHOTS_MAX = 40;
const FIELD_MAX = 160;
const SUMMARY_MAX = 500;

const Text = z.string().catch('');
const Num = z.coerce.number().catch(Number.NaN);

const SUBJECTS_MAX = 12;

const RawMoveSchema = z.object({ travel: Text, turn: Text, zoom: Text }).optional().catch(undefined);

export const RawFilmSheetSchema = z.object({
  seconds: Num,
  aspect: Text,
  shots: z
    .array(
      z.object({
        start: Num,
        end: Num,
        framing: Text,
        camera: Text,
        action: Text,
        // `blueprint` reading only.
        transition: z.string().optional().catch(undefined),
        move: RawMoveSchema,
      }),
    )
    .catch([]),
  look: z.object({ lighting: Text, palette: Text, texture: Text }).catch({ lighting: '', palette: '', texture: '' }),
  audio: z
    .object({ music: z.boolean().catch(false), speech: z.boolean().catch(false), effects: Text })
    .catch({ music: false, speech: false, effects: '' }),
  summary: z.string(),
  // `blueprint` reading only.
  subjects: z
    .array(z.object({ id: Text, what: Text, count: Num }))
    .optional()
    .catch(undefined),
  setting: z.string().optional().catch(undefined),
});

const shotSchema = {
  type: 'object',
  properties: {
    start: { type: 'number' },
    end: { type: 'number' },
    framing: { type: 'string' },
    camera: { type: 'string' },
    action: { type: 'string' },
  },
  required: ['start', 'end', 'framing', 'camera', 'action'],
} as const;

/** Sent as `responseJsonSchema`. */
export const FILM_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    seconds: { type: 'number' },
    aspect: { type: 'string' },
    shots: { type: 'array', items: shotSchema, minItems: 1, maxItems: SHOTS_MAX },
    look: {
      type: 'object',
      properties: { lighting: { type: 'string' }, palette: { type: 'string' }, texture: { type: 'string' } },
      required: ['lighting', 'palette', 'texture'],
    },
    audio: {
      type: 'object',
      properties: { music: { type: 'boolean' }, speech: { type: 'boolean' }, effects: { type: 'string' } },
      required: ['music', 'speech', 'effects'],
    },
    summary: { type: 'string' },
  },
  required: ['seconds', 'aspect', 'shots', 'look', 'audio', 'summary'],
} as const;

const blueprintShotSchema = {
  type: 'object',
  properties: {
    ...shotSchema.properties,
    transition: { type: 'string' },
    move: {
      type: 'object',
      properties: { travel: { type: 'string' }, turn: { type: 'string' }, zoom: { type: 'string' } },
      required: ['travel', 'turn', 'zoom'],
    },
  },
  required: [...shotSchema.required, 'transition', 'move'],
} as const;

/**
 * Sent as `responseJsonSchema` for a `blueprint` reading: the basic sheet plus handovers, split camera,
 * subjects and setting. No item counts here: Gemini answered 400 (INVALID_ARGUMENT) to this schema with
 * `maxItems: 40` on the richer shot rows (checked 2026-11-11; the same cap on the basic rows is accepted),
 * so the caps are applied by `normalizeFilmSheet` (SHOTS_MAX, SUBJECTS_MAX) instead.
 */
export const FILM_BLUEPRINT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    ...FILM_RESPONSE_SCHEMA.properties,
    shots: { type: 'array', items: blueprintShotSchema },
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, what: { type: 'string' }, count: { type: 'number' } },
        required: ['id', 'what', 'count'],
      },
    },
    setting: { type: 'string' },
  },
  required: [...FILM_RESPONSE_SCHEMA.required, 'subjects', 'setting'],
} as const;

function field(text: string, max = FIELD_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const HANGUL = /[가-힣]/g;

function summaryFits(summary: string, locale: 'ko' | 'en'): boolean {
  const hangul = summary.match(HANGUL)?.length ?? 0;
  const letters = summary.replace(/[^\p{L}]/gu, '').length || 1;
  return locale === 'ko' ? hangul / letters > 0.5 : hangul / letters < 0.1;
}

/**
 * Validated sheet, or null when it is not usable: no length, no shot, an empty or wrong-language
 * summary. Lengths come from the file when it can be read; shot times are clamped to that length,
 * sorted and rounded to 0.1 s.
 */
export function normalizeFilmSheet(raw: unknown, probe: VideoProbe, locale: 'ko' | 'en'): FilmSheet | null {
  const parsed = RawFilmSheetSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sheet = parsed.data;

  const reported = Number.isFinite(sheet.seconds) && sheet.seconds > 0 && sheet.seconds <= 600 ? sheet.seconds : null;
  const lastEnd = Math.max(0, ...sheet.shots.map((s) => (Number.isFinite(s.end) ? s.end : 0)));
  const seconds = round1(probe.seconds ?? reported ?? (lastEnd > 0 && lastEnd <= 600 ? lastEnd : 0));
  if (!(seconds > 0)) return null;

  const clamp = (n: number) => round1(Math.min(seconds, Math.max(0, Number.isFinite(n) ? n : 0)));
  const shots = sheet.shots
    .map((s) => {
      const transition = field(s.transition ?? '', 80);
      const move = s.move ? { travel: field(s.move.travel, 120), turn: field(s.move.turn, 120), zoom: field(s.move.zoom, 120) } : null;
      return {
        start: clamp(Math.min(s.start, s.end)),
        end: clamp(Math.max(s.start, s.end)),
        framing: field(s.framing),
        camera: field(s.camera),
        action: field(s.action),
        ...(transition ? { transition } : {}),
        ...(move && (move.travel || move.turn || move.zoom) ? { move } : {}),
      };
    })
    .filter((s) => s.end - s.start >= 0.1)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, SHOTS_MAX);
  if (shots.length === 0) return null;

  const summary = field(sheet.summary, SUMMARY_MAX);
  if (!summary || !summaryFits(summary, locale) || containsInternalTerm(summary)) return null;

  const aspect =
    probe.width && probe.height
      ? aspectLabel(probe.width, probe.height)
      : /^\d{1,2}:\d{1,2}$/.test(sheet.aspect.trim())
        ? sheet.aspect.trim()
        : '';

  const subjects = (sheet.subjects ?? [])
    .map((s, i) => ({
      id: field(s.id, 4) || String.fromCharCode(65 + i),
      what: field(s.what, 120),
      count: Number.isFinite(s.count) ? Math.min(50, Math.max(1, Math.round(s.count))) : 1,
    }))
    .filter((s) => s.what && !containsInternalTerm(s.what))
    .slice(0, SUBJECTS_MAX);
  const setting = field(sheet.setting ?? '', 200);

  return {
    seconds,
    aspect,
    shots,
    look: {
      lighting: field(sheet.look.lighting, 200),
      palette: field(sheet.look.palette, 200),
      texture: field(sheet.look.texture, 200),
    },
    audio: { music: sheet.audio.music, speech: sheet.audio.speech, effects: field(sheet.audio.effects, 200) },
    summary,
    ...(subjects.length ? { subjects } : {}),
    ...(setting ? { setting } : {}),
  };
}
