/**
 * `revise.mark`: what one spot the customer pointed at on a clip is on (docs/BRAND-STUDIO-V6-PLAN.md
 * §4.5). The browser sends the paused frame with the mark drawn on it; one small Gemini JSON call names
 * the thing: `label` for the chip in the customer's language, `what` for the prompt writer.
 *
 * Free like `revise.plan`: same seat, role and allowance>0 checks, its own per-organization rate cap.
 * The frame is read once and never stored. Any failure of the reading answers nulls (the mark still
 * works, by position); only a malformed request, a frame that is not a small JPEG, or a result that is
 * not this organization's video is refused.
 */
import type { Viewer } from '@/lib/auth/identity';
import { ReviseMarkReadSchema, type StudioFailure, type StudioReviseMarkRead } from '../contracts';
import { requireCreate, studioSeat, StudioDenied } from '../access';
import { callGeminiJson, inlinePart, studioGeminiConfig } from '../enhancer/gemini';
import { sniffMime } from '../files';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import type { IntelDeps, StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { loadRevisionRecipe } from './recipe';

export const MARK_FRAME_MAX_BYTES = 300 * 1024;
const MARK_TIMEOUT_MS = 12_000;
const MADE_WITH_MAX = 1500;
const LABEL_MAX = 60;
const WHAT_MAX = 240;

const MARK_SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string' }, what: { type: 'string' } },
  required: ['label', 'what'],
} as const;

const MARK_SYSTEM = `The image is one frame of an AI-generated video clip. A bright ring (kind "pin") or a bright rectangle (kind "box") drawn on it marks one thing the customer pointed at. "mark" gives where it is in fractions of the picture (x, y from the top-left; for a box also w, h) and "time" the second of the clip. "madeWith" is the prompt the clip was generated from. "locale" is the customer's language.
Say what the mark is on. Answer with JSON {"label": string, "what": string} only.
- label: a 2-5 word name of the thing in the customer's language ("ko" Korean, "en" English), plain words, no punctuation at the end.
- what: one English noun phrase precise enough to find the thing in the video: its look and whose or where it is. When "madeWith" names the thing, reuse its words.
Describe the thing itself. Never mention the ring, the rectangle, a number, a mark or coordinates. If the mark is on empty background, name that surface or area.`;

/** One line, trimmed, capped; null when nothing is left. */
function clean(value: unknown, max: number, trailing: boolean): string | null {
  if (typeof value !== 'string') return null;
  let text = value.replace(/\s+/g, ' ').trim();
  if (!trailing) text = text.replace(/[\s.!?。,;:·…]+$/u, '').trim();
  if (text.length > max) text = text.slice(0, max).trim();
  return text || null;
}

/** Decoded JPEG bytes of a data URL, or null when it is not a JPEG within the size limit. */
export function markFrameBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const bytes = new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > MARK_FRAME_MAX_BYTES) return null;
  return sniffMime(bytes) === 'image/jpeg' ? bytes : null;
}

/** What the mark is on, or nulls when it could not be read (no key, timeout, an unexpected answer). */
export async function readMark(
  deps: IntelDeps,
  input: {
    frame: Uint8Array;
    mark: { x: number; y: number; w?: number; h?: number; time: number };
    madeWith: string;
    locale: 'ko' | 'en';
  },
): Promise<{ label: string | null; what: string | null }> {
  const none = { label: null, what: null };
  const config = studioGeminiConfig(deps.env);
  if (!config) return none;
  try {
    const { x, y, w, h, time } = input.mark;
    const raw = await callGeminiJson(config, deps.fetch, {
      system: MARK_SYSTEM,
      parts: [
        inlinePart(input.frame, 'image/jpeg'),
        {
          text: JSON.stringify({
            mark: { x, y, ...(w !== undefined ? { w, h } : {}), time },
            kind: w !== undefined ? 'box' : 'pin',
            madeWith: input.madeWith.slice(0, MADE_WITH_MAX),
            locale: input.locale,
          }),
        },
      ],
      schema: MARK_SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: MARK_TIMEOUT_MS,
    });
    const answer = (raw ?? {}) as { label?: unknown; what?: unknown };
    return { label: clean(answer.label, LABEL_MAX, false), what: clean(answer.what, WHAT_MAX, true) };
  } catch {
    return none;
  }
}

export async function readStudioMark(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioReviseMarkRead | StudioFailure> {
  const parsed = ReviseMarkReadSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const now = deps.now?.() ?? new Date();
  const ready = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      if (!takeFreeIntelSlot(`mark:${v.organizationId}`, FREE_INTEL_LIMITS.markPerMinute, now.getTime())) {
        throw new StudioDenied('too_many_running');
      }
      const recipe = await loadRevisionRecipe(sql, v.organizationId, v.outputId);
      const frame = markFrameBytes(v.frame);
      if (!frame) throw new StudioDenied('invalid');
      return { madeWith: recipe.madeWith, frame };
    }),
  );
  if ('ok' in ready) return ready;
  const read = await readMark(deps.intelDeps, {
    frame: ready.frame,
    mark: { x: v.x, y: v.y, ...(v.w !== undefined ? { w: v.w, h: v.h } : {}), time: v.time },
    madeWith: ready.madeWith,
    locale,
  });
  return { ok: true, ...read };
}
