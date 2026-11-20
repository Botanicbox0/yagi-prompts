/**
 * Commercial music and warnings (docs/BRAND-SOUND-STUDIO.md §12.5, SA3): what happens when a music request is
 * stopped, by us before a press or by the engine after it.
 *
 *  - Before a press (nothing reserved): a singer's or song's name in the description or the lyrics (the name list),
 *    and lyrics that read like a widely known song (a text-model judgment, `judgeExistingLyrics`). Passing is not a
 *    guarantee; failing blocks.
 *  - Repeated blocks: three in ten minutes for one organization pause its music requests for a minute. The counter
 *    lives in memory, like the free-operation limits (no new table, §12.5 "새 표는 만들지 않는다").
 *  - Engine refusals (a run that failed `provider_rejected`): zero credits as before, one line and "다르게 설계하기" on
 *    the screen, never a silent retry (../block-retry.ts skips music). More than five in a day make the organization's
 *    next requests stricter: the lyrics judgment runs on every lyric (drafts too) and the Prompt Architect cannot be
 *    switched off.
 *  - The record: organization, user, time, which field, which check, the engine's error class. Never the lyrics: their
 *    length and a short fingerprint only. Blocked presses have no job row, so the record is the log line.
 */
import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { callGeminiJson, type GeminiConfig } from '../enhancer/gemini';

export const MUSIC_BLOCK_LIMITS = {
  /** Blocks counted per organization inside this window… */
  windowMs: 10 * 60_000,
  /** …this many of them pause it… */
  blocks: 3,
  /** …for this long. */
  pauseMs: 60_000,
  /** Engine refusals in a day after which the checks get stricter. */
  engineRefusalsPerDay: 5,
} as const;

const blockTimes = new Map<string, number[]>();
const pausedUntil = new Map<string, number>();

export function resetMusicBlocks(): void {
  blockTimes.clear();
  pausedUntil.clear();
}

/** Counts a block; true when it starts a pause. */
export function noteMusicBlock(organizationId: string, nowMs: number): boolean {
  const recent = (blockTimes.get(organizationId) ?? []).filter((t) => t > nowMs - MUSIC_BLOCK_LIMITS.windowMs);
  recent.push(nowMs);
  if (recent.length >= MUSIC_BLOCK_LIMITS.blocks) {
    blockTimes.delete(organizationId);
    pausedUntil.set(organizationId, nowMs + MUSIC_BLOCK_LIMITS.pauseMs);
    return true;
  }
  blockTimes.set(organizationId, recent);
  return false;
}

export function musicPaused(organizationId: string, nowMs: number): boolean {
  const until = pausedUntil.get(organizationId);
  if (until == null) return false;
  if (until > nowMs) return true;
  pausedUntil.delete(organizationId);
  return false;
}

/** Length and a 12-character fingerprint: enough to tell repeats apart, nothing to read back. */
export function lyricsMark(lyrics: string | null | undefined): { lyricsLength: number; lyricsFingerprint: string } | Record<string, never> {
  const text = (lyrics ?? '').trim();
  if (!text) return {};
  return { lyricsLength: text.length, lyricsFingerprint: createHash('sha256').update(text).digest('hex').slice(0, 12) };
}

export interface MusicBlockRecord {
  organizationId: string;
  userId: string | null;
  field: 'prompt' | 'lyrics' | 'design' | 'request';
  check: 'ours' | 'judge' | 'engine' | 'paused';
  errorClass?: string | null;
  lyrics?: string | null;
}

export function logMusicBlock(log: ((event: string, detail: Record<string, unknown>) => void) | undefined, record: MusicBlockRecord, now: Date): void {
  log?.('studio_music_blocked', {
    organizationId: record.organizationId,
    userId: record.userId,
    at: now.toISOString(),
    field: record.field,
    check: record.check,
    ...(record.errorClass ? { errorClass: record.errorClass } : {}),
    ...lyricsMark(record.lyrics),
  });
}

/** Engine refusals of this organization's music runs in the last 24 hours. */
export async function engineRefusalsToday(sql: Pick<SqlRunner, 'query'>, organizationId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const rows = (
    await sql.query<{ n: string | number }>(
      `select count(*) as n from brand_studio_jobs
        where organization_id = $1 and kind = 'music' and status = 'failed' and error_code = 'provider_rejected' and created_at > $2`,
      [organizationId, since],
    )
  ).rows;
  return Number(rows[0]?.n ?? 0);
}

export async function strictMusicChecks(sql: Pick<SqlRunner, 'query'>, organizationId: string, now: Date): Promise<boolean> {
  return (await engineRefusalsToday(sql, organizationId, now)) > MUSIC_BLOCK_LIMITS.engineRefusalsPerDay;
}

/* ------------------------------------------------------------------ the lyrics judgment */

export const JUDGE_SYSTEM = [
  'You check lyrics before they are sent to a music generator for brand advertising.',
  'Answer whether the text reproduces the lyrics of an existing, published song: whole lines quoted or closely',
  'paraphrased from a known song. Common phrases, a slogan, or original lyrics in a familiar style are not existing',
  'lyrics. Do not name the song. Answer JSON only.',
].join(' ');

const JUDGE_SCHEMA = {
  type: 'object',
  properties: { existing: { type: 'boolean' }, confidence: { type: 'number' } },
  required: ['existing', 'confidence'],
} as const;

/** Blocks only a confident "existing". */
export const JUDGE_THRESHOLD = 0.7;

/** Local test marker: lyrics carrying it are judged existing without a model (fake provider only). */
export const FAKE_EXISTING = '[[fake:existing]]';

export type LyricsVerdict = 'existing' | 'original' | 'unknown';

/**
 * "가사가 기존 곡으로 보임" (§12.5). `unknown` on any error or timeout: the press goes on (the engine has its own
 * filter) and the log says so.
 */
export async function judgeExistingLyrics(
  lyrics: string,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
): Promise<LyricsVerdict> {
  try {
    const answer = (await callGeminiJson(config, fetchImpl, {
      system: JUDGE_SYSTEM,
      parts: [{ text: `Lyrics:\n${lyrics.slice(0, 3000)}` }],
      schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: 15_000,
    })) as { existing?: unknown; confidence?: unknown };
    const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0;
    return answer?.existing === true && confidence >= JUDGE_THRESHOLD ? 'existing' : 'original';
  } catch (error) {
    log?.('studio_lyrics_judge_failed', { message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return 'unknown';
  }
}
