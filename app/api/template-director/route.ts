import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isLocale } from '@/lib/i18n/config';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import {
  createFlashTemplateDirector,
  directorConfigFromEnv,
  runHeuristicDirectorTurn,
  toClientDirectorTurnResponse,
} from '@/lib/template-director/flash-director';
import {
  DIRECTOR_EDITABLE_SLOTS,
  PERSONAL_AUDIO_MODES,
  PERSONAL_BGM_MOODS,
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

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);

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

  const references: DirectorReferenceAttachment[] = [];
  const slotFields: Array<{ field: string; slotName: string; role: 'look' | 'product' | 'scene' }> = [
    { field: 'slot_look_ref', slotName: 'look_ref', role: 'look' },
    { field: 'slot_prop_ref', slotName: 'prop_ref', role: 'product' },
    { field: 'slot_scene_ref', slotName: 'scene_ref', role: 'scene' },
  ];

  for (const { field, slotName, role } of slotFields) {
    const file = form.get(field);
    if (file instanceof File && file.size > 0) {
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
    (locale === 'en'
      ? 'Apply my attached reference photo naturally to this scene.'
      : '첨부한 레퍼런스 사진을 장면에 자연스럽게 반영해 주세요.');

  const turnInput = {
    templateId: template.id,
    templateSummaryKo: templateSummaryKo || template.slug,
    editableSlots: DIRECTOR_EDITABLE_SLOTS,
    userMessage: effectiveMessage,
    references,
  };

  const config = directorConfigFromEnv();
  if (config) {
    try {
      const director = createFlashTemplateDirector(config);
      const result = await director.runChatTurn(turnInput);
      return json({ ok: true, model: director.model, turn: toClientDirectorTurnResponse(result) }, 200);
    } catch {
      // Fall back to deterministic Stage 1 parser if Gemini API is temporarily unreachable.
    }
  }

  const fallback = runHeuristicDirectorTurn({ ...turnInput, audioMode, bgmMood });
  return json({ ok: true, model: 'heuristic', turn: toClientDirectorTurnResponse(fallback) }, 200);
}
