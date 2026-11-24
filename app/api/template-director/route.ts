import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { personalEditSheetOpen } from '@/lib/flags';
import { isLocale } from '@/lib/i18n/config';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import {
  DIRECTOR_DEFAULT_REFERENCE_MESSAGE_EN,
  DIRECTOR_DEFAULT_REFERENCE_MESSAGE_KO,
  createFlashTemplateDirector,
  directorConfigFromEnv,
  runHeuristicDirectorTurn,
  toClientDirectorTurnResponse,
} from '@/lib/template-director/flash-director';
import { editableSlotsFor, lockChipsTurn, parseTemplateLocks, publicLocks } from '@/lib/template-director/locks';
import { takeDirectorTurnSlot } from '@/lib/template-director/rate-limit';
import { cleanPersonalSheetState } from '@/lib/template-director/sheet';
import {
  DIRECTOR_EDITABLE_SLOTS,
  PERSONAL_AUDIO_MODES,
  PERSONAL_BGM_MOODS,
  type CustomDirectorRefSlot,
  type DirectorChatTurnResult,
  type DirectorReferenceAttachment,
  type PersonalAudioMode,
  type PersonalBgmMood,
} from '@/lib/template-director/schema';

export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_REF_BYTES = 8 * 1024 * 1024;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);

  // docs/PERSONAL-STUDIO.md §3.1 — every turn may call the Stage-1 model; admins are not limited.
  if (!viewer.isAdmin) {
    const slot = takeDirectorTurnSlot(viewer.userId);
    if (!slot.ok) {
      return NextResponse.json(
        { ok: false, code: 'rate_limited' },
        { status: 429, headers: { ...HEADERS, 'Retry-After': String(slot.retryAfterSec) } },
      );
    }
  }

  const sql = await getSqlRunner();
  if (!sql) return json({ ok: false, code: 'unavailable' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400);
  }

  const slug = String(form.get('template') ?? '').trim();
  const localeRaw = String(form.get('locale') ?? 'ko');
  const locale = isLocale(localeRaw) ? localeRaw : 'ko';
  const rawMessage = String(form.get('message') ?? '').trim();
  const audioModeRaw = String(form.get('audioMode') ?? 'ambient');
  const audioMode: PersonalAudioMode = (PERSONAL_AUDIO_MODES as readonly string[]).includes(audioModeRaw)
    ? (audioModeRaw as PersonalAudioMode)
    : 'ambient';
  const bgmMoodRaw = String(form.get('bgmMood') ?? '');
  const bgmMood: PersonalBgmMood | null =
    audioMode === 'bgm' && (PERSONAL_BGM_MOODS as readonly string[]).includes(bgmMoodRaw)
      ? (bgmMoodRaw as PersonalBgmMood)
      : audioMode === 'bgm'
        ? 'cinematic'
        : null;

  if (!slug) return json({ ok: false, code: 'not_found' }, 404);
  const template = await loadPromptBySlug(sql, slug);
  if (!template || template.status !== 'published' || template.audience === 'brand') {
    return json({ ok: false, code: 'not_found' }, 404);
  }

  // docs/PERSONAL-STUDIO.md §3.3 — the template's own locks, read from its prompt. Without a `Template locks:` block
  // this is NO_LOCKS and every branch below that uses it is skipped: the turn and the answer are exactly as before.
  const locks = parseTemplateLocks(template.promptText);

  const references: DirectorReferenceAttachment[] = [];
  const slotFields: Array<{ field: string; slotName: CustomDirectorRefSlot; role: 'look' | 'product' | 'scene' }> = [
    { field: 'slot_look_ref', slotName: 'look_ref', role: 'look' },
    { field: 'slot_prop_ref', slotName: 'prop_ref', role: 'product' },
    { field: 'slot_scene_ref', slotName: 'scene_ref', role: 'scene' },
  ];

  for (const { field, slotName, role } of slotFields) {
    const file = form.get(field);
    if (file instanceof File && file.size > 0) {
      // A photo for a reference the template closed is refused before any model sees it (the screen hides its picker).
      if (locks.any && locks.refs.includes(slotName)) {
        return json({ ok: false, code: 'locked_slot_photo' }, 400);
      }
      if (!ALLOWED_MIMES.has(file.type) || file.size > MAX_REF_BYTES) {
        return json({ ok: false, code: 'bad_slot_photo' }, 400);
      }
      references.push({
        slotName,
        role,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      });
    }
  }

  if (!rawMessage && references.length === 0) {
    return json({ ok: false, code: 'bad_request' }, 400);
  }

  // Only safe public Korean/English metadata reaches Stage 1 — private master prompt never leaves the server.
  const templateSummaryKo = [
    template.titleKo || template.title,
    template.processMdKo || template.processMd,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' — ');

  const effectiveMessage =
    rawMessage ||
    (locale === 'en' ? DIRECTOR_DEFAULT_REFERENCE_MESSAGE_EN : DIRECTOR_DEFAULT_REFERENCE_MESSAGE_KO);

  // docs/PERSONAL-STUDIO.md §2.3 — the edit sheet the screen kept. Read only with the flag on, and untrusted:
  // cleaned and guarded here and again in the director. Off (or no field), the turn is today's chips turn.
  const sheetField = personalEditSheetOpen() ? form.get('sheet') : null;
  const sheetState = typeof sheetField === 'string' ? cleanPersonalSheetState(parseJsonOrNull(sheetField)) : null;

  // A sheet turn answers in the screen's language; a chips turn gets no locale and stays as it was. With locks the
  // closed slots leave `editableSlots`, and a sheet turn gets the locks (a locked line never lands on the sheet).
  const turnInput = {
    templateId: template.id,
    templateSummaryKo: templateSummaryKo || template.slug,
    editableSlots: locks.any ? editableSlotsFor(locks) : DIRECTOR_EDITABLE_SLOTS,
    userMessage: effectiveMessage,
    references,
    ...(sheetState ? { sheetState, locale, ...(locks.any ? { locks } : {}) } : {}),
  };

  // A chips turn (flag off, or no sheet) has the locked chips and overrides taken out; with nothing left it is refused.
  const settle = (result: DirectorChatTurnResult): DirectorChatTurnResult =>
    locks.any && !sheetState ? lockChipsTurn(result, locks) : result;
  // The answer names the locked parts (the public projection only) so the screen can show them; absent without locks.
  const lockField = locks.any ? { locks: publicLocks(locks) } : {};

  const config = directorConfigFromEnv();
  if (config) {
    try {
      const director = createFlashTemplateDirector(config);
      const result = settle(await director.runChatTurn(turnInput));
      return json({ ok: true, model: director.model, turn: toClientDirectorTurnResponse(result), ...lockField }, 200);
    } catch {
      // Fall back to deterministic Stage 1 parser if Gemini API is temporarily unreachable.
    }
  }

  const fallback = settle(runHeuristicDirectorTurn({ ...turnInput, audioMode, bgmMood }));
  return json({ ok: true, model: 'heuristic', turn: toClientDirectorTurnResponse(fallback), ...lockField }, 200);
}
