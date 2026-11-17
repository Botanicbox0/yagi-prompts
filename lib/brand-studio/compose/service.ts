/**
 * Server operations for Brand Studio Video Composer (`docs/BRAND-VIDEO-COMPOSE-D.md`, Founder Decision 3).
 *
 * - `chat.edit`: Free (`0` TWINGS credits) timeline/caption chat with a per-minute sliding-window rate limit
 *   (`20` requests / `60s` per member+organization). Uses deterministic `parseComposeChatCommand` first and
 *   falls back to TWINGS's server-side structured parser (`callGeminiJson`) when configured — zero BYOK keys
 *   or external vendor names.
 * - `render.reserve`: Deducts TWINGS credits (`composeFinalRenderKrw`) before high-resolution 1080p MP4 export
 *   under the organization lock (`reserveAllowance` + `brand_studio_jobs` `video_final` / `compose-1080p`).
 * - `render.refund`: Marks a failed client 1080p export row as `failed` (`usage_krw = null`) for an automatic
 *   100% credit refund.
 * - `assist.plan`: "말로 편집" (`docs/BRAND-EDITING-STUDIO.md` §4, `lib/brand-studio/edit-assist/service.ts`).
 *   Behind `BRAND_STUDIO_EDIT_ASSIST`; off, it answers exactly like an unknown operation. Same gate and the
 *   same per-minute budget as `chat.edit`, free.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import type { StudioAllowanceView, StudioErrorCode } from '@/lib/brand-studio/contracts';
import { creditsOf } from '@/lib/brand-studio/credits';
import { callGeminiJson, studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { allowanceView, loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { AssistPlanInputSchema, planEditAssist, type AssistPlanResult } from '../edit-assist/service';
import {
  ComposePatchesEnvelopeSchema,
  describeTimelinePatches,
  parseComposeChatCommand,
} from './chat-intent';
import { COMPOSE_FINAL_RENDER_MODEL, composeFinalRenderKrw } from './credits';
import { COMPOSE_ASPECTS, type ComposerProject, type TimelinePatch } from './timeline';

export const COMPOSE_OPERATIONS = ['chat.edit', 'render.reserve', 'render.refund', 'assist.plan'] as const;
export type ComposeOperation = (typeof COMPOSE_OPERATIONS)[number];

export const COMPOSE_CHAT_LIMIT_PER_MIN = 20;
export const COMPOSE_CHAT_WINDOW_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chatBuckets = new Map<string, number[]>();

export function resetComposeChatRateLimitsForTest(): void {
  chatBuckets.clear();
}

function consumeComposeChatSlot(
  key: string,
  nowMs: number,
  limit = COMPOSE_CHAT_LIMIT_PER_MIN,
): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  const cutoff = nowMs - COMPOSE_CHAT_WINDOW_MS;
  const recent = (chatBuckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? nowMs;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + COMPOSE_CHAT_WINDOW_MS - nowMs) / 1000));
    chatBuckets.set(key, recent);
    return { ok: false, retryAfterSec };
  }
  recent.push(nowMs);
  chatBuckets.set(key, recent);
  return { ok: true, remaining: Math.max(0, limit - recent.length) };
}

const ChatProjectSchema: z.ZodType<ComposerProject> = z.object({
  version: z.literal(1).default(1),
  aspect: z.enum(COMPOSE_ASPECTS).default('9:16'),
  clips: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        label: z.string().max(160),
        sourceKind: z.enum(['asset', 'output', 'local']),
        assetId: z.string().max(80).optional(),
        outputId: z.string().max(80).optional(),
        srcUrl: z.string().max(500),
        thumbUrl: z.string().max(500).nullable().optional(),
        durationSec: z.number().min(0.1).max(600),
        trimStartSec: z.number().min(0).max(600),
        trimEndSec: z.number().min(0.1).max(600),
        volume: z.number().min(0).max(1),
        muted: z.boolean(),
      }),
    )
    .max(40),
  captions: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        text: z.string().max(160),
        startSec: z.number().min(0).max(600),
        endSec: z.number().min(0.1).max(600),
        position: z.enum(['bottom', 'center', 'top']),
        size: z.enum(['sm', 'md', 'lg']),
      }),
    )
    .max(40),
  bgm: z
    .object({
      label: z.string().max(160),
      sourceKind: z.enum(['asset', 'local']),
      assetId: z.string().max(80).optional(),
      srcUrl: z.string().max(500),
      durationSec: z.number().min(0.1).max(600),
      trimStartSec: z.number().min(0).max(600),
      volume: z.number().min(0).max(1),
    })
    .nullable()
    .default(null),
});

const ChatEditInputSchema = z.object({
  organizationId: z.uuid(),
  message: z.string().trim().min(1).max(500),
  locale: z.enum(['ko', 'en']).default('ko'),
  project: ChatProjectSchema,
});

const RenderReserveInputSchema = z.object({
  organizationId: z.uuid(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  durationSec: z.number().min(0.3).max(300),
});

const RenderRefundInputSchema = z.object({
  organizationId: z.uuid(),
  jobId: z.uuid(),
});

const COMPOSE_GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    patches: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: [
              'set_aspect',
              'trim_clip',
              'move_clip',
              'swap_clips',
              'remove_clip',
              'set_clip_audio',
              'add_caption',
              'update_caption',
              'remove_caption',
              'set_bgm_volume',
              'remove_bgm',
            ],
          },
          aspect: { type: 'string', enum: [...COMPOSE_ASPECTS] },
          clipIndex: {},
          trimStartSec: { type: 'number' },
          trimEndSec: { type: 'number' },
          targetDurationSec: { type: 'number' },
          fromIndex: { type: 'number' },
          toIndex: { type: 'number' },
          indexA: { type: 'number' },
          indexB: { type: 'number' },
          volume: { type: 'number' },
          muted: { type: 'boolean' },
          text: { type: 'string' },
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          anchor: { type: 'string', enum: ['start', 'end', 'full'] },
          durationSec: { type: 'number' },
          position: { type: 'string', enum: ['bottom', 'center', 'top'] },
          size: { type: 'string', enum: ['sm', 'md', 'lg'] },
          captionIndex: {},
        },
        required: ['op'],
      },
    },
  },
  required: ['patches'],
};

export type ComposeFailure =
  | { ok: false; code: StudioErrorCode }
  | { ok: false; code: 'rate_limited'; retryAfterSec: number };

export type ComposeChatResult =
  | { ok: true; kind: 'undo'; creditsUsed: 0 }
  | { ok: true; kind: 'patches'; patches: TimelinePatch[]; detail: string; creditsUsed: 0 }
  | { ok: true; kind: 'unrecognized'; creditsUsed: 0 };

export type ComposeRenderReserveResult = {
  ok: true;
  jobId: string;
  creditsUsed: number;
  allowance: StudioAllowanceView;
};

export type ComposeRenderRefundResult = {
  ok: true;
  refunded: boolean;
  allowance: StudioAllowanceView;
};

export type ComposeOperationResult =
  | ComposeFailure
  | ComposeChatResult
  | ComposeRenderReserveResult
  | ComposeRenderRefundResult
  | AssistPlanResult;

export interface ComposeExtraOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

async function translateFreeformTimelineChat(options: {
  message: string;
  project: ComposerProject;
  locale: 'ko' | 'en';
  env: Record<string, string | undefined>;
  providerMode: 'live' | 'fake';
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; patches: TimelinePatch[]; detail: string } | { ok: false }> {
  const config = studioGeminiConfig(options.env);
  if (!config) return { ok: false };
  if (options.providerMode === 'fake' && !options.fetchImpl) return { ok: false };

  const stateSummary = {
    aspect: options.project.aspect,
    clips: options.project.clips.map((c, idx) => ({
      clipIndex: idx,
      label: c.label,
      durationSec: c.durationSec,
      trimStartSec: c.trimStartSec,
      trimEndSec: c.trimEndSec,
      volume: c.volume,
      muted: c.muted,
    })),
    captions: options.project.captions.map((c, idx) => ({
      captionIndex: idx,
      text: c.text,
      startSec: c.startSec,
      endSec: c.endSec,
      position: c.position,
    })),
    hasBgm: Boolean(options.project.bgm),
    bgmVolume: options.project.bgm?.volume ?? null,
  };

  const system = [
    'Convert the user video timeline editing instruction into JSON matching {"patches":[...]} only.',
    'Allowed patch ops (0-based indices):',
    '- {"op":"set_aspect","aspect":"9:16"|"16:9"|"4:5"|"1:1"}',
    '- {"op":"trim_clip","clipIndex":0,"trimStartSec":0,"trimEndSec":3,"targetDurationSec":3}',
    '- {"op":"move_clip","fromIndex":2,"toIndex":0}',
    '- {"op":"swap_clips","indexA":0,"indexB":1}',
    '- {"op":"remove_clip","clipIndex":0}',
    '- {"op":"set_clip_audio","clipIndex":0|"all","volume":0.8,"muted":false}',
    '- {"op":"add_caption","text":"...","anchor":"start"|"end"|"full","durationSec":2.5,"position":"bottom"|"center"|"top","size":"sm"|"md"|"lg"}',
    '- {"op":"remove_caption","captionIndex":0|"all"}',
    '- {"op":"set_bgm_volume","volume":0.3}',
    '- {"op":"remove_bgm"}',
    `Current timeline: ${JSON.stringify(stateSummary)}`,
  ].join('\n');

  try {
    const raw = await callGeminiJson(config, options.fetchImpl ?? fetch, {
      system,
      parts: [{ text: options.message.slice(0, 500) }],
      schema: COMPOSE_GEMINI_SCHEMA,
      thinking: 'LOW',
      timeoutMs: 8_000,
    });
    const parsed = ComposePatchesEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { ok: false };
    return {
      ok: true,
      patches: parsed.data.patches,
      detail: describeTimelinePatches(parsed.data.patches, options.locale),
    };
  } catch {
    return { ok: false };
  }
}

export async function runComposeOperation(
  deps: StudioDeps,
  viewer: Viewer,
  operation: unknown,
  input: unknown,
  extra?: ComposeExtraOptions,
): Promise<ComposeOperationResult> {
  if (typeof operation !== 'string' || !(COMPOSE_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, code: 'invalid' };
  }
  // Flag off: `assist.plan` is indistinguishable from an unknown operation (no gate, no rate-limit slot).
  if (operation === 'assist.plan' && !deps.env.editAssist) {
    return { ok: false, code: 'invalid' };
  }
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    return { ok: false, code: 'invalid' };
  }

  // Gate first: membership -> Morphic hardline -> generative_media + self_studio -> role.
  let seatUserId = '';
  try {
    seatUserId = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      requireCreate(seat);
      return seat.userId;
    });
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }

  const now = deps.now?.() ?? new Date();
  const nowMs = extra?.nowMs ?? now.getTime();

  if (operation === 'chat.edit') {
    const parsed = ChatEditInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const v = parsed.data;

    const slot = consumeComposeChatSlot(`${seatUserId}:${v.organizationId}`, nowMs);
    if (!slot.ok) return { ok: false, code: 'rate_limited', retryAfterSec: slot.retryAfterSec };

    const deterministic = parseComposeChatCommand(v.message, v.project, v.locale);
    if (deterministic.kind === 'undo') {
      return { ok: true, kind: 'undo', creditsUsed: 0 };
    }
    if (deterministic.kind === 'patches') {
      return {
        ok: true,
        kind: 'patches',
        patches: deterministic.patches,
        detail: deterministic.detail,
        creditsUsed: 0,
      };
    }

    const ai = await translateFreeformTimelineChat({
      message: v.message,
      project: v.project,
      locale: v.locale,
      env: extra?.env ?? process.env,
      providerMode: deps.env.provider,
      fetchImpl: extra?.fetchImpl,
    });
    if (ai.ok) {
      return { ok: true, kind: 'patches', patches: ai.patches, detail: ai.detail, creditsUsed: 0 };
    }
    return { ok: true, kind: 'unrecognized', creditsUsed: 0 };
  }

  if (operation === 'assist.plan') {
    const parsed = AssistPlanInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    // One budget with `chat.edit`: both are the same chat box to the user.
    const slot = consumeComposeChatSlot(`${seatUserId}:${parsed.data.organizationId}`, nowMs);
    if (!slot.ok) return { ok: false, code: 'rate_limited', retryAfterSec: slot.retryAfterSec };
    return planEditAssist(parsed.data, {
      env: extra?.env ?? process.env,
      providerMode: deps.env.provider,
      ...(extra?.fetchImpl ? { fetchImpl: extra.fetchImpl } : {}),
    });
  }

  if (operation === 'render.reserve') {
    const parsed = RenderReserveInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const v = parsed.data;
    const krw = composeFinalRenderKrw(v.durationSec);

    try {
      return await deps.sql.transaction(async (tx) => {
        const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
        if (seat.role === 'guest') throw new StudioDenied('not_found');
        requireCreate(seat);

        await lockOrganization(tx, v.organizationId);
        const existing = (
          await tx.query<{ id: string; status: string; estimate_krw: number; usage_krw: number | null }>(
            `select id, status, estimate_krw, usage_krw
               from brand_studio_jobs
              where organization_id = $1 and created_by = $2 and request_id = $3`,
            [v.organizationId, seat.userId, v.requestId],
          )
        ).rows[0];

        if (existing) {
          const allowance = await loadAllowance(tx, v.organizationId, deps.env, now);
          if (existing.status === 'succeeded') {
            return {
              ok: true as const,
              jobId: existing.id,
              creditsUsed: creditsOf(Number(existing.usage_krw ?? existing.estimate_krw ?? 0)),
              allowance: allowanceView(allowance),
            };
          }
          return { ok: false as const, code: 'conflict' as const };
        }

        const verdict = await reserveAllowance(tx, v.organizationId, krw, deps.env, now);
        if (!verdict.ok) return { ok: false as const, code: verdict.code };

        const ts = now.toISOString();
        const params = JSON.stringify({
          resolution: '1080p',
          seconds: Math.max(1, Math.ceil(v.durationSec)),
          source: 'compose',
        });
        const inserted = await tx.query<{ id: string }>(
          `insert into brand_studio_jobs (
             organization_id, created_by, request_id, kind, status, lane, model,
             prompt, enhance, refs, params, estimate_krw, usage_krw, created_at, started_at, finished_at
           ) values (
             $1, $2, $3, 'video_final', 'succeeded', null, $4,
             '1080p MP4 compose', false, '[]'::jsonb, $5::jsonb, $6, $6, $7, $7, $7
           ) returning id`,
          [v.organizationId, seat.userId, v.requestId, COMPOSE_FINAL_RENDER_MODEL, params, krw, ts],
        );

        const updated = await loadAllowance(tx, v.organizationId, deps.env, now);
        return {
          ok: true as const,
          jobId: inserted.rows[0]!.id,
          creditsUsed: creditsOf(krw),
          allowance: allowanceView(updated),
        };
      });
    } catch (error) {
      if (error instanceof StudioDenied) return { ok: false, code: error.code };
      throw error;
    }
  }

  const parsed = RenderRefundInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;

  try {
    return await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      requireCreate(seat);

      await lockOrganization(tx, v.organizationId);
      const updatedJob = await tx.query<{ id: string }>(
        `update brand_studio_jobs
            set status = 'failed', usage_krw = null, error_code = 'failed', finished_at = $4
          where id = $1 and organization_id = $2 and created_by = $3 and model = $5 and status = 'succeeded'
          returning id`,
        [v.jobId, v.organizationId, seat.userId, now.toISOString(), COMPOSE_FINAL_RENDER_MODEL],
      );
      const updated = await loadAllowance(tx, v.organizationId, deps.env, now);
      return {
        ok: true as const,
        refunded: updatedJob.rows.length > 0,
        allowance: allowanceView(updated),
      };
    });
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }
}
