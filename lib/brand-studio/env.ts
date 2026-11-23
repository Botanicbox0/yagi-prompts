/**
 * Brand studio server settings (docs/BRAND-STUDIO-V2.md §7, §11), read once per request from the
 * environment. Server-only: names and booleans leave this module, secret values never do (the two
 * secrets are compared in constant time by `secretMatches`).
 */
import { timingSafeEqual } from 'node:crypto';
import { BRAND_PLAN_GRACE_DAYS_DEFAULT } from '@/lib/brands/billing/math';
import {
  brandStudioEditAssistOpen,
  brandStudioMusicGenerationOpen,
  brandStudioOutpaintOpen,
  brandStudioProjectsOpen,
  brandStudioRegionV2Open,
  brandStudioReviseV2Open,
  brandSoundMaxModeShown,
  brandSoundStudioOpen,
} from '@/lib/flags';
import { STUDIO_LANES, type StudioLane } from './models';

export type StudioEnvSource = Record<string, string | undefined>;

export interface StudioEnv {
  /** `fake` never spends money: placeholders after a couple of polls. */
  provider: 'live' | 'fake';
  defaultLane: StudioLane;
  defaultMonthlyKrw: number;
  planGraceDays: number;
  caps: Record<StudioLane, number>;
  /** True when the API lane can submit (a Sunra key is configured, or the fake provider is on). */
  apiConfigured: boolean;
  /** Absolute https origin the provider can call back, or null (no webhook; polling still works). */
  webhookUrl: string | null;
  /** Origin used to turn a relative media URL into one a provider can fetch (null = keep as is). */
  appOrigin: string | null;
  /** `BRAND_STUDIO_OUTPAINT=on`: the layer editor may offer "빈 곳 채우기" (lib/flags.ts). */
  outpaint?: boolean;
  /** `BRAND_STUDIO_PROJECTS=on`: runs may belong to a project (lib/flags.ts, lib/brand-studio/job-projects.ts). */
  projects?: boolean;
  /** `BRAND_STUDIO_REGION_V2=on`: partial edits run on one engine with a wide window (lib/flags.ts). */
  regionV2?: boolean;
  /** `BRAND_STUDIO_EDIT_ASSIST=on`: the editing studio's "말로 편집" (`assist.plan`, lib/flags.ts). */
  editAssist?: boolean;
  /** `BRAND_STUDIO_REVISE_V2=on`: the clip edit panel as a conversation, drafts and finals named (lib/flags.ts). */
  reviseV2?: boolean;
  /** `BRAND_STUDIO_MUSIC_GENERATION=on`: `music.generate` and its controls (lib/flags.ts). Closed by default. */
  musicGeneration?: boolean;
  /** `BRAND_SOUND_STUDIO=on`: the sound studio (docs/BRAND-SOUND-STUDIO.md, lib/flags.ts). Closed by default. */
  soundStudio?: boolean;
  /** `BRAND_SOUND_MAX_MODE=on`: "더 고르게 만들기" is offered (lib/flags.ts). Hidden by default. */
  soundMaxMode?: boolean;
}

function whole(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function planGraceDaysFromEnv(env: StudioEnvSource = process.env): number {
  return whole(env.BRAND_PLAN_GRACE_DAYS, BRAND_PLAN_GRACE_DAYS_DEFAULT, 365);
}

/**
 * `BRAND_STUDIO_PROVIDER`: `fake` or `live`. Unset means `live`, except in local mode
 * (`PLAYBOOK_MODE=local`) where an unset value means `fake` so a laptop never spends by accident.
 */
export function studioEnv(env: StudioEnvSource = process.env): StudioEnv {
  const explicit = env.BRAND_STUDIO_PROVIDER?.trim();
  const provider: 'live' | 'fake' =
    explicit === 'fake' ? 'fake' : explicit === 'live' ? 'live' : env.PLAYBOOK_MODE?.trim() === 'local' ? 'fake' : 'live';
  const lane = env.BRAND_STUDIO_DEFAULT_LANE?.trim();
  const defaultLane: StudioLane = (STUDIO_LANES as readonly string[]).includes(lane ?? '') ? (lane as StudioLane) : 'sunra_api';
  const appOrigin = httpsOrigin(env.NEXT_PUBLIC_APP_URL);
  const secret = env.BRAND_STUDIO_WEBHOOK_SECRET?.trim();
  return {
    provider,
    defaultLane,
    defaultMonthlyKrw: whole(env.BRAND_STUDIO_DEFAULT_MONTHLY_KRW, 0, 100_000_000),
    planGraceDays: planGraceDaysFromEnv(env),
    caps: {
      sunra_api: whole(env.BRAND_STUDIO_API_CONCURRENCY, 20, 200),
      sunra_mcp: whole(env.BRAND_STUDIO_MCP_CONCURRENCY, 20, 200),
    },
    apiConfigured: provider === 'fake' || Boolean(env.SUNRA_API_KEY?.trim()),
    webhookUrl:
      provider === 'live' && appOrigin && secret
        ? `${appOrigin}/api/brand-studio/webhook?token=${encodeURIComponent(secret)}`
        : null,
    appOrigin,
    outpaint: brandStudioOutpaintOpen(env),
    projects: brandStudioProjectsOpen(env),
    regionV2: brandStudioRegionV2Open(env),
    editAssist: brandStudioEditAssistOpen(env),
    reviseV2: brandStudioReviseV2Open(env),
    musicGeneration: brandStudioMusicGenerationOpen(env),
    soundStudio: brandSoundStudioOpen(env),
    soundMaxMode: brandSoundMaxModeShown(env),
  };
}

/** Constant-time comparison against a configured secret; false when the secret is not configured. */
export function secretMatches(configured: string | undefined, received: string | null | undefined): boolean {
  const expected = configured?.trim();
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
