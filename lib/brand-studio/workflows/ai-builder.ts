/**
 * AI Workflow Builder (`op: 'build_with_ai'`, `docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 *
 * Compiles a plain-language Korean/English brief (e.g. "향수 보틀 사진 1장 넣으면 스튜디오 화보 3컷과
 * 9:16 오프닝 영상을 만드는 워크플로우") into a validated `WorkflowRecipe` + title + summary + category.
 * Uses `gemini-3.8-flash` via `studioGeminiConfig` when available, and falls back deterministically
 * to a structured multi-step recipe compiler when offline or unconfigured.
 */
import { callGeminiJson, studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { studioModel } from '@/lib/brand-studio/models';
import type { IntelDeps } from '@/lib/brand-studio/types';
import {
  WORKFLOW_CATEGORIES,
  WorkflowRecipeSchema,
  type WorkflowCategory,
  type WorkflowInputSlot,
  type WorkflowRecipe,
  type WorkflowStep,
} from './contracts';

export interface CompiledWorkflowSpec {
  title: string;
  summary: string;
  category: WorkflowCategory;
  recipe: WorkflowRecipe;
  mode: 'gemini' | 'fallback';
}

const IMAGE_ASPECTS = new Set(['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9']);
const VIDEO_ASPECTS = new Set(['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']);

function normalizeStep(raw: Partial<WorkflowStep>, index: number, hasImageSlot: boolean, hasVideoSlot: boolean): WorkflowStep {
  const medium = raw.medium === 'video' ? 'video' : 'image';
  if (medium === 'video') {
    const aspect = raw.aspect && VIDEO_ASPECTS.has(raw.aspect) ? raw.aspect : '9:16';
    const resolution = raw.resolution === '1080p' || raw.resolution === '480p' ? raw.resolution : '720p';
    const seconds = typeof raw.seconds === 'number' && raw.seconds >= 4 && raw.seconds <= 15 ? Math.round(raw.seconds) : 5;
    const refs: string[] = [];
    if (hasVideoSlot && raw.useReferenceSlots?.includes('video1')) refs.push('video1');
    if (hasImageSlot && (raw.useReferenceSlots?.includes('image1') ?? true)) refs.push('image1');
    const id = (raw.id?.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 32) || `step_video_${index + 1}`).toLowerCase();
    return {
      id,
      label: raw.label?.trim().slice(0, 90) || `영상 컷 ${index + 1} (${aspect} · ${seconds}초)`,
      packId: id,
      medium: 'video',
      model: 'seedance-2.5',
      aspect,
      resolution,
      seconds,
      audio: 'ambient',
      count: 1,
      useReferenceSlots: refs,
      promptTemplate:
        raw.promptTemplate?.trim().slice(0, 2800) ||
        `Reference authority: Keep {subject} (@image1) consistent. 0.0s–${seconds}.0s composed studio camera movement with natural lighting and crisp detail. Clean room tone and foley only, strict no BGM. {prompt}`,
    };
  }

  const requestedModel = raw.model && studioModel(raw.model)?.medium === 'image' && studioModel(raw.model)?.availability === 'live'
    ? raw.model
    : 'nano-banana-pro';
  const modelDef = studioModel(requestedModel);
  const allowedAspects = new Set(modelDef?.aspects ?? [...IMAGE_ASPECTS]);
  const aspect = raw.aspect && allowedAspects.has(raw.aspect) ? raw.aspect : allowedAspects.has('4:5') ? '4:5' : '3:4';
  const resolution = raw.resolution === '1K' || raw.resolution === '4K' ? raw.resolution : '2K';
  const id = (raw.id?.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 32) || `step_img_${index + 1}`).toLowerCase();
  const refs = hasImageSlot ? ['image1'] : [];
  return {
    id,
    label: raw.label?.trim().slice(0, 90) || `스튜디오 컷 ${index + 1} (${aspect})`,
    packId: id,
    medium: 'image',
    model: requestedModel,
    aspect,
    resolution,
    count: 1,
    useReferenceSlots: refs,
    promptTemplate:
      raw.promptTemplate?.trim().slice(0, 2800) ||
      `Editorial studio photograph of {subject}${hasImageSlot ? ' faithfully locked to @image1 proportions and surface details' : ''}, balanced architectural lighting, natural micro-texture, clean composition. {prompt}`,
  };
}

/** Deterministic offline compiler that turns any Korean/English brief into a tailored multi-step recipe. */
export function compileWorkflowFallback(briefRaw: string): CompiledWorkflowSpec {
  const brief = briefRaw.trim();
  const lower = brief.toLowerCase();

  const isCharacter = /캐릭터|인물|모델|턴어라운드|표정|착장|룩북|character|turnaround|persona|lookbook/.test(lower);
  const wantsVideo = /영상|비디오|오프닝|클립|숏폼|릴스|광고|티저|9:16|video|clip|reel|teaser|opening/.test(lower);
  const wantsRefVideo = /레퍼런스\s*영상|참고\s*영상|리버스|reference\s*video|reverse/.test(lower);
  const isProduct = !isCharacter && /보틀|향수|화장품|제품|팩샷|상세|패키지|상품|bottle|perfume|product|packshot|skincare/.test(lower);

  const category: WorkflowCategory = isCharacter
    ? 'character'
    : wantsVideo && !isProduct
      ? 'video'
      : isProduct
        ? 'product'
        : wantsVideo
          ? 'campaign'
          : 'custom';

  const briefWithoutInputClause = brief.replace(
    /(\d)\s*(?:장|개|컷)(?:을|를)?\s*(?:넣으?면|넣고|올리?면|업로드하?면|주?면|기준으로|바탕으로|으로|로)/gu,
    '',
  );
  const cutMatches = [...briefWithoutInputClause.matchAll(/(\d)\s*(?:컷|장|개|stills?|shots?|cuts?|angles?)/gi)];
  const countMatch = cutMatches.at(-1);
  const stillCount = countMatch ? Math.max(1, Math.min(4, Number(countMatch[1]))) : wantsVideo && !isProduct && !isCharacter ? 0 : 3;

  const aspectMatch = /(9:16|16:9|4:5|3:4|4:3|1:1)/.exec(brief);
  const preferredImageAspect = aspectMatch && IMAGE_ASPECTS.has(aspectMatch[1]!) ? aspectMatch[1]! : isCharacter ? '16:9' : '4:5';
  const preferredVideoAspect = /(16:9|1:1|4:3|3:4|9:16)/.exec(brief)?.[1] ?? '9:16';

  const cleanedTopic = brief
    .replace(/만드는\s*워크플로우.*$/u, '')
    .replace(/워크플로우.*$/u, '')
    .replace(/workflow.*$/i, '')
    .trim()
    .slice(0, 44);
  const title =
    cleanedTopic.length >= 4
      ? cleanedTopic.slice(0, 60)
      : isCharacter
        ? '커스텀 캐릭터 · 룩북 시트'
        : isProduct && wantsVideo
          ? '제품 화보 + 오프닝 영상 패키지'
          : isProduct
            ? '커스텀 제품 스튜디오 화보 세트'
            : '팀 맞춤 스튜디오 워크플로우';

  const slots: WorkflowInputSlot[] = [];
  if (wantsRefVideo) {
    slots.push({
      key: 'video1',
      kind: 'video_ref',
      label: '참고 영상 (@video1, 선택)',
      labelEn: 'Reference video (@video1, optional)',
      required: false,
    });
  }
  slots.push({
    key: 'image1',
    kind: 'image_ref',
    label: isCharacter ? '기준 인물 · 캐릭터 이미지 (@image1)' : '기준 제품 · 레퍼런스 사진 (@image1)',
    labelEn: isCharacter ? 'Character reference (@image1)' : 'Reference image (@image1)',
    required: false,
    role: isCharacter ? 'person' : 'product',
  });
  slots.push({
    key: 'subject',
    kind: 'text',
    label: isCharacter ? '캐릭터 · 프로젝트 이름' : '제품 · 캠페인 이름',
    labelEn: 'Subject or campaign name',
    placeholder: isCharacter ? '예: 26FW 캠페인 페르소나' : '예: 시그니처 오 드 퍼퓸',
    required: false,
    defaultValue: isCharacter ? '캠페인 모델' : '주력 아이템',
  });
  slots.push({
    key: 'prompt',
    kind: 'textarea',
    label: '추가 연출 · 무드 지시',
    labelEn: 'Additional styling & lighting notes',
    placeholder: '배경 질감, 조명 온도, 강조하고 싶은 디테일을 적어 주세요…',
    required: false,
  });

  const rawSteps: WorkflowStep[] = [];
  const stillAngles = ['정면 히어로 화보', '측면 · 입체 무드 컷', '소재 · 클로즈업 디테일 컷', '와이드 공간 연출 컷'];
  const stillAspects = [preferredImageAspect, '1:1', '4:3', '16:9'];

  for (let i = 0; i < stillCount; i += 1) {
    const aspect = stillAspects[i] ?? preferredImageAspect;
    rawSteps.push(
      normalizeStep(
        {
          id: `still_${i + 1}`,
          label: `${stillAngles[i] ?? `스튜디오 화보 ${i + 1}`} (${aspect})`,
          medium: 'image',
          model: 'nano-banana-pro',
          aspect,
          resolution: '2K',
          promptTemplate: `Editorial studio visual (${stillAngles[i] ?? `angle ${i + 1}`}) for {subject} strictly preserving @image1 proportions, silhouette, and key details. Goal: ${brief}. Clean directional studio light, natural surface texture. {prompt}`,
        },
        i,
        true,
        wantsRefVideo,
      ),
    );
  }

  if (wantsVideo || rawSteps.length === 0) {
    rawSteps.push(
      normalizeStep(
        {
          id: 'opening_video',
          label: `오프닝 모션 클립 (${preferredVideoAspect} · 5초)`,
          medium: 'video',
          model: 'seedance-2.5',
          aspect: preferredVideoAspect,
          resolution: '720p',
          seconds: 5,
          useReferenceSlots: wantsRefVideo ? ['video1', 'image1'] : ['image1'],
          promptTemplate: `Reference authority: Keep {subject} (@image1) accurate in shape, label, and color. 0.0s–2.4s controlled camera push-in from three-quarter angle; 2.4s–5.0s crisp editorial hero reveal matching "${brief}". Subtle room tone and foley only, strict no BGM. {prompt}`,
        },
        rawSteps.length,
        true,
        wantsRefVideo,
      ),
    );
  }

  slots.push({
    key: 'outputs',
    kind: 'multiselect',
    label: '실행할 단계 선택',
    labelEn: 'Steps to include',
    required: true,
    options: rawSteps.map((s) => ({
      id: s.id,
      label: s.label,
      defaultSelected: true,
    })),
  });
  slots.push({
    key: 'folderName',
    kind: 'folder',
    label: '저장할 공유 폴더명',
    labelEn: 'Shared folder name',
    placeholder: `${title.slice(0, 24)} · {이름}`,
    required: false,
  });

  const recipe = WorkflowRecipeSchema.parse({
    version: 1,
    guide: `요청 브리프("${brief.slice(0, 140)}")를 바탕으로 구성된 ${rawSteps.length}단계 팀 워크플로우입니다. 기준 이미지를 고르고 바로 실행하면 결과물이 공유 폴더에 자동 정리됩니다.`,
    defaultFolderPattern: `${title.slice(0, 28)} · {subject}`,
    consistencyCheck: isCharacter ? 'character_sheet' : 'none',
    slots,
    steps: rawSteps,
  });

  return {
    title,
    summary: `${rawSteps.length}단계 자동 구성 · ${brief.slice(0, 120)}`,
    category,
    recipe,
    mode: 'fallback',
  };
}

const AI_BUILDER_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  required: ['title', 'summary', 'category', 'guide', 'needsReferenceVideo', 'steps'],
  properties: {
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    category: { type: 'STRING', enum: [...WORKFLOW_CATEGORIES] },
    guide: { type: 'STRING' },
    needsReferenceVideo: { type: 'BOOLEAN' },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'label', 'medium', 'aspect', 'promptTemplate'],
        properties: {
          id: { type: 'STRING' },
          label: { type: 'STRING' },
          medium: { type: 'STRING', enum: ['image', 'video'] },
          aspect: { type: 'STRING' },
          seconds: { type: 'INTEGER' },
          promptTemplate: { type: 'STRING' },
        },
      },
    },
  },
};

const AI_BUILDER_SYSTEM = [
  'You design reusable multi-step Brand Studio workflows for a creative team.',
  'Given the user brief, output a concise Korean title (<=50 chars), a 1-sentence Korean summary, category, practical Korean usage guide, and 2 to 5 ordered steps.',
  'Each step promptTemplate should be detailed editorial English direction referencing {subject}, @image1 for the attached subject/product image, and {prompt} for per-run notes.',
  'For video steps, follow timeline syntax (0.0s–2.5s ... 2.5s–5.0s ...) and end with "Natural foley and ambience only, strict no BGM."',
  'Never mention internal server names or raw currency.',
].join(' ');

export async function buildWorkflowWithAi(brief: string, intelDeps: IntelDeps): Promise<CompiledWorkflowSpec> {
  const config = studioGeminiConfig(intelDeps.env);
  if (!config) return compileWorkflowFallback(brief);

  try {
    const raw = (await callGeminiJson(config, intelDeps.fetch, {
      system: AI_BUILDER_SYSTEM,
      parts: [{ text: `User workflow request:\n${brief.trim()}` }],
      schema: AI_BUILDER_SCHEMA,
      thinking: 'LOW',
      timeoutMs: 15_000,
    })) as {
      title?: unknown;
      summary?: unknown;
      category?: unknown;
      guide?: unknown;
      needsReferenceVideo?: unknown;
      steps?: Array<Partial<WorkflowStep>>;
    };

    if (!raw || typeof raw.title !== 'string' || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      return compileWorkflowFallback(brief);
    }

    const fallback = compileWorkflowFallback(brief);
    const hasVideoSlot = raw.needsReferenceVideo === true;
    const category: WorkflowCategory = (WORKFLOW_CATEGORIES as readonly string[]).includes(String(raw.category))
      ? (raw.category as WorkflowCategory)
      : fallback.category;

    const steps = raw.steps
      .slice(0, 5)
      .map((step, idx) => normalizeStep(step, idx, true, hasVideoSlot));

    const slots: WorkflowInputSlot[] = [
      ...(hasVideoSlot
        ? [
            {
              key: 'video1',
              kind: 'video_ref' as const,
              label: '참고 영상 (@video1, 선택)',
              labelEn: 'Reference video (@video1, optional)',
              required: false,
            },
          ]
        : []),
      ...fallback.recipe.slots.filter((s) => s.key !== 'video1' && s.key !== 'outputs'),
      {
        key: 'outputs',
        kind: 'multiselect',
        label: '실행할 단계 선택',
        labelEn: 'Steps to include',
        required: true,
        options: steps.map((s) => ({ id: s.id, label: s.label, defaultSelected: true })),
      },
    ];

    const title = raw.title.trim().slice(0, 80) || fallback.title;
    const recipe = WorkflowRecipeSchema.parse({
      version: 1,
      guide: typeof raw.guide === 'string' && raw.guide.trim() ? raw.guide.trim().slice(0, 800) : fallback.recipe.guide,
      defaultFolderPattern: `${title.slice(0, 28)} · {subject}`,
      consistencyCheck: category === 'character' ? 'character_sheet' : 'none',
      slots,
      steps,
    });

    return {
      title,
      summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 300) : fallback.summary,
      category,
      recipe,
      mode: 'gemini',
    };
  } catch {
    return compileWorkflowFallback(brief);
  }
}
