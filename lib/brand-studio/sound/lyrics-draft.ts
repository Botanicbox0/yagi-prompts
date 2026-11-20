/**
 * `lyrics.draft` (docs/BRAND-SOUND-STUDIO.md §4.2, §7.5): a first draft of lyrics from the description, in the
 * language asked for, for the customer to edit. No credits; a per-organization limit per minute instead, and
 * only while this month's allowance is open (the same guard as the other free text operations).
 *
 * Model: the editing studio's "말로 편집" model by default (`gemini-4-hydrogen`), swapped only by the server
 * environment (`BRAND_SOUND_LYRICS_MODEL`). The prompt forbids singers, songs and brands that are not the
 * customer's, and the answer is checked against the same name list as the description. The draft comes back as
 * stanzas separated by blank lines; section marks are added when the music request is sent (./lyrics.ts).
 *
 * Local mode (`BRAND_STUDIO_PROVIDER=fake`) answers with a fixed draft: no network, no model.
 */
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { requireCreate, StudioDenied, studioSeat } from '../access';
import { LyricsDraftSchema, type StudioFailure, type StudioLyricsDraft } from '../contracts';
import { callGeminiJson, studioGeminiConfig, type GeminiConfig } from '../enhancer/gemini';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import type { StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { LYRICS_LIMITS } from './lyrics';
import { namedArtist } from './names';

/** The model "말로 편집" runs on (lib/brand-studio/edit-assist/service.ts), the default here too. */
export const LYRICS_DEFAULT_MODEL = 'gemini-4-hydrogen';

export function lyricsGeminiConfig(env: Record<string, string | undefined>): GeminiConfig | null {
  const base = studioGeminiConfig(env);
  if (!base) return null;
  const override = env.BRAND_SOUND_LYRICS_MODEL?.trim();
  return { ...base, model: override && /^[a-z0-9.-]{1,60}$/i.test(override) ? override : LYRICS_DEFAULT_MODEL };
}

const SYSTEM = [
  'You write short song lyrics for brand advertising music (15 to 60 second ads and social videos).',
  'Write new, original lyrics only. Never quote or paraphrase an existing song. Never name a real singer, band,',
  'song, album or a brand other than one the request itself names. No health or medical claims, no superlatives',
  'such as "best" or "No.1". Two to four short stanzas of two to four lines, stanzas separated by one blank line,',
  'no section labels, no title, no notes. Write in the language asked for.',
].join(' ');

const SCHEMA = { type: 'object', properties: { lyrics: { type: 'string' } }, required: ['lyrics'] } as const;

/** A stanza block as the screen expects it: no marks, trimmed lines, one blank line between stanzas. */
export function cleanDraft(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*\[[^\]]{1,40}\]\s*$/.test(line))
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, LYRICS_LIMITS.max);
}

const LOCAL_DRAFT: Readonly<Record<'ko' | 'en', string>> = {
  ko: '창가에 스민 아침빛\n오늘은 조금 더 가볍게\n\n천천히 숨을 고르고\n나답게 하루를 시작해',
  en: 'Morning light through the window\nToday feels a little lighter\n\nTake a slow breath and smile\nStart the day your way',
};

export async function draftLyrics(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioLyricsDraft | (StudioFailure & { blocked?: 'name' }) | StudioFailure> {
  if (!deps.env.soundStudio) return failure('invalid');
  const parsed = LyricsDraftSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const gate = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(sql, v.organizationId, 'sound');
      } catch (error) {
        if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw error;
      }
      requireCreate(seat);
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      return { ok: true as const };
    }),
  );
  if (!('ok' in gate) || gate.ok !== true) return gate as StudioFailure;
  if (namedArtist(v.topic)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (!takeFreeIntelSlot(`lyrics:${v.organizationId}`, FREE_INTEL_LIMITS.lyricsPerMinute, now.getTime())) return failure('too_many_running');

  if (deps.env.provider === 'fake') return { ok: true, lyrics: LOCAL_DRAFT[v.language] };
  const config = lyricsGeminiConfig(deps.intelDeps.env);
  if (!config) return failure('provider_unavailable');
  let answer: unknown;
  try {
    answer = await callGeminiJson(config, deps.intelDeps.fetch, {
      system: SYSTEM,
      parts: [{ text: `Language: ${v.language === 'ko' ? 'Korean' : 'English'}\nWhat the music is for, in the customer's words:\n${v.topic}` }],
      schema: SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: 25_000,
    });
  } catch (error) {
    deps.log?.('studio_lyrics_draft_failed', { message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return failure('provider_unavailable');
  }
  const text = typeof (answer as { lyrics?: unknown })?.lyrics === 'string' ? cleanDraft((answer as { lyrics: string }).lyrics) : '';
  // A draft that names someone else's song or singer is not handed over.
  if (!text || namedArtist(text)) return failure('failed');
  return { ok: true, lyrics: text };
}
