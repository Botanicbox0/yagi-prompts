/**
 * G1c class test, `<=>` equivalence against the single explicit registry, fixed behaviour-rule locators,
 * <4-word allow exclusion, per-site tight allow-corpus hygiene, and exhaustive programmatic option sweep
 * across every enhancer × skin mode × switch state and every director configuration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_LINE,
  dictatedSpans,
  guardRequest,
  NON_DISCLOSURE_RULE,
  type GuardLogLine,
} from '@/lib/ai-guard';
import { Corpus, unitsOf } from '@/lib/ai-guard/outgoing';
import { foldText, wordGrams, wordUnits } from '@/lib/ai-guard/text';
import {
  STUDIO_AUDIO_MODES,
  STUDIO_KEEP_KEYS,
  STUDIO_REMIX_METHODS,
  STUDIO_REVISE_MODES,
  type StudioKeepKey,
  type StudioRemixMethod,
} from '@/lib/brand-studio/contracts';
import {
  buildSeedanceDirectorSystemInstruction,
  classifyPromptIntent,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  DIRECTOR_V2_PALETTE_ROLES_LIST,
  directorAllow,
  directorAllowV2,
  hasPersonInDirectorScene,
  isGarmentReference,
  requestsExplicitMusicPerformance,
  type DirectorAudioMode,
  type DirectorCompileInput,
} from '@/lib/brand-studio/director';
import {
  composeFallbackPrompt,
  effectiveSeconds,
  enhancerAllow,
  enhancePrompt,
  filterSubsumedDictated,
  type EnhanceInput,
} from '@/lib/brand-studio/enhancer';
import { blueprintShots, isBlueprint } from '@/lib/brand-studio/enhancer/blueprint';
import {
  AMBIENT_AUDIO_LINE,
  NATIVE_AUDIO_LINE,
  planShots,
} from '@/lib/brand-studio/enhancer/lines';
import {
  buildSystemInstruction,
  gptImageAllowPhrases,
  MODEL_BLOCKS,
  nanoBananaAllowPhrases,
  REGION_EDIT_PEOPLE_KEEP_PHRASE,
  seedanceAllowPhrases,
  seedreamAllowPhrases,
  skinAllowFor,
  skinVariantOf,
} from '@/lib/brand-studio/enhancer/profiles';
import * as coreMod from '@/lib/brand-studio/enhancer/profiles/core';
import * as gptImageMod from '@/lib/brand-studio/enhancer/profiles/gpt-image';
import * as nanoBananaMod from '@/lib/brand-studio/enhancer/profiles/nano-banana';
import * as seedanceMod from '@/lib/brand-studio/enhancer/profiles/seedance';
import * as seedreamMod from '@/lib/brand-studio/enhancer/profiles/seedream';
import * as skinMod from '@/lib/brand-studio/enhancer/profiles/skin';
import * as tasksMod from '@/lib/brand-studio/enhancer/profiles/tasks';
import * as schemaMod from '@/lib/brand-studio/enhancer/schema';
import * as linesMod from '@/lib/brand-studio/enhancer/lines';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import { promptGuardMode } from '@/lib/flags';
import {
  configFamilyOf,
  containsNormalizedPhrase,
  CONTRIBUTING_MODULES,
  NON_PHRASE_STRING_EXPORTS,
  normalizePhraseWs,
  OUTPUT_PHRASE_REGISTRY,
  postAnswerAppendedLinesForConfig,
  REEXPORT_PHRASE_ALIASES,
} from './output-phrase-registry';
import {
  REVIEWED_SENTENCE_LOCATORS,
  SHARED_ENHANCER_CORE_SENTENCE_LOCATORS,
} from './reviewed-sentence-locators';
import { FAKE_ANALYZER, isSiteCall, MARKED_SHEET, recordingFetch } from './reference-cases';

const THUMB = {
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]),
  mime: 'image/png',
} as const;

const PERSON_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'person' as const,
  use: '얼굴과 피부 톤 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const PERSON_BASE_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'person' as const,
  use: '얼굴 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const PRODUCT_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'product' as const,
  use: '유리 용기와 라벨 비율 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const GARMENT_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'product' as const,
  use: '코트 의상 실루엣과 소재만 유지',
  avoid: '배경 제외',
  thumb: THUMB,
};

const OTHER_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'other' as const,
  use: '전체 분위기 참고',
  thumb: THUMB,
};

let logs: GuardLogLine[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[prompt-guard] ')) {
      logs.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
    }
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

interface ConfigCase {
  id: string;
  site: 'enhancer' | 'director';
  env: Record<string, string | undefined>;
  input: EnhanceInput | DirectorCompileInput;
  buildAnswer: (wovenPhrases: string) => string;
  notes: string;
  markup?: boolean;
}

function instantiatePlaceholders(phrase: string, input: EnhanceInput | DirectorCompileInput): string {
  const binding = bindReferences(input);
  const firstImage =
    binding.bound.find((b) => b.token && b.ref.kind === 'image')?.token ??
    (input.kind === 'region_edit' ? binding.editTarget ?? 'image 1' : 'the subject');
  const personImage =
    binding.bound.find((b) => b.token && b.ref.kind === 'image' && b.ref.role === 'person')?.token ?? firstImage;
  const spacedPerson = personImage.replace(/^@Image(\d+)$/i, '@Image $1');
  const spacedImg = firstImage.replace(/^@Image(\d+)$/i, '@Image $1');

  let out = phrase;
  if (input.profile === 'seedance') {
    out = out
      .replaceAll('<person @Image token>', spacedPerson)
      .replaceAll('<token>', spacedImg)
      .replaceAll('@Image 1', spacedPerson)
      .replaceAll('@Image1', personImage);
  } else if (input.kind === 'region_edit') {
    const sourceTok =
      binding.bound.find((b) => b.token)?.token ??
      (input.profile === 'seedream' ? 'Image 1' : 'image 1');
    out = out.replaceAll('<token>', sourceTok).replace(/\bimage N\b/g, sourceTok);
  } else {
    const hasImg = binding.bound.some((b) => b.token && b.ref.kind === 'image');
    const tok = hasImg ? firstImage : 'the subject';
    out = out.replaceAll('<token>', tok).replace(/\bimage N\b/g, tok);
  }
  return out;
}

function activeRegistryPhrasesFor(c: ConfigCase, guardedSystem: string): string[] {
  const postAnswerSet = new Set(postAnswerAppendedLinesForConfig(c).map(normalizePhraseWs));
  const out: string[] = [];
  for (const entry of OUTPUT_PHRASE_REGISTRY) {
    if (entry.category !== 'output_phrase' || (entry.markupOnly && !c.markup)) continue;
    if (containsNormalizedPhrase(guardedSystem, entry.value) || postAnswerSet.has(normalizePhraseWs(entry.value))) {
      out.push(entry.value);
    }
  }
  return [...new Set(out)];
}

function buildImageAnswer(inp: EnhanceInput, woven: string): string {
  const binding = bindReferences(inp);
  const toks = binding.bound.map((b) => b.token).filter((t): t is string => Boolean(t));
  const tok = toks.join(' and ');
  if (inp.profile === 'seedream') {
    const refPart = tok ? `The scene uses ${tok} on pale honed stone in calm morning light. ` : 'A calm skincare studio composition on pale stone in soft morning window light. ';
    return `${refPart}${woven}.`;
  }
  if (inp.profile === 'nano-banana') {
    const lead = tok ? `Using ${tok}, place the subject on pale stone in soft morning window light. ` : 'Create a quiet skincare studio photograph on pale stone in soft morning light. ';
    return `${lead}Details: ${woven}.`;
  }
  const lead = tok ? `A photorealistic studio brief using ${tok} on pale limestone in soft morning light. ` : 'A photorealistic studio photograph on pale limestone in soft morning light. ';
  return `${lead}${woven}.`;
}

function buildRegionAnswer(inp: EnhanceInput, woven: string): string {
  const target = inp.profile === 'seedream' ? 'Image 1' : 'image 1';
  const lead = inp.profile === 'seedream'
    ? `In ${target}, change only the targeted surface cleanly; do not move or resize anything else. `
    : `Using ${target}, change only the targeted surface cleanly; do not move or resize anything else. `;
  return `${lead}${woven}.`;
}

function buildEnhancerSeedanceAnswer(inp: EnhanceInput, woven: string): string {
  const binding = bindReferences(inp);
  const imgToks = binding.bound.filter((b) => b.ref.kind === 'image' && b.token).map((b) => b.token!);
  const vidTok = binding.bound.find((b) => b.ref.kind === 'video' && b.token)?.token ?? null;
  const audio = inp.video?.audio ?? 'native';
  const safeWoven = audio === 'ambient' ? woven.replace(/\bmusic that fits the mood\b/gi, 'location sound') : woven;
  const lines: string[] = [];
  if (inp.revision?.mode === 'edit' || inp.video?.method === 'edit') {
    const vref = vidTok ?? '@Video1';
    lines.push(`In ${vref}, change only the bottle tone to cobalt blue${imgToks.length > 0 ? ` while keeping ${imgToks.join(' and ')}` : ''}; everything else stays as it is.`);
    lines.push(`Scene notes: ${safeWoven}.`);
  } else if (inp.kind === 'video_remix' && inp.video?.method === 'blueprint') {
    for (const t of imgToks) lines.push(`${t} supplies only the subject geometry and label.`);
    lines.push(`Visual style: pale daylight walls, #14171C shadow floor, #EAE4DC stone. ${safeWoven}.`);
    lines.push('0.0–2.0s: Close-up, gentle morning light moves across the scene. Camera — travel: slow push in; pan/tilt: none; zoom: none. Hard cut.');
    lines.push('2.0–5.0s: Medium shot, calm motion continues beside the window. Camera — travel: handheld follow; pan/tilt: none; zoom: none. Hard cut.');
    lines.push('5.0–8.0s: Wide shot, settled resting pose in daylight. Camera — travel: none; pan/tilt: none; zoom: none.');
    lines.push('Last frame: quiet room light over pale stone.');
  } else if (inp.kind === 'video_remix') {
    const vref = vidTok ?? '@Video1';
    lines.push(`Follow ${vref} for the camera path and the cut timing; replace the bottle with ${imgToks.length > 0 ? imgToks.join(' and ') : 'the new glass bottle'}; keep the room.`);
    lines.push(`Visual style: pale daylight walls. ${safeWoven}.`);
    lines.push('0.0–8.0s: Smooth medium shot following the motion cleanly.');
    lines.push('Last frame: calm resting pose.');
  } else {
    for (const t of imgToks) lines.push(`${t} supplies only its named reference subject.`);
    lines.push(`Visual style: pale daylight walls. ${safeWoven}.`);
    lines.push(`0.0–${(inp.video?.seconds ?? 8).toFixed(1)}s: Calm movement in natural window light.`);
    lines.push('Last frame: resting quietly on pale stone.');
  }
  if (audio === 'ambient') lines.push(AMBIENT_AUDIO_LINE);
  else if (audio === 'native') lines.push(NATIVE_AUDIO_LINE);
  return lines.join('\n');
}

function buildDirectorAnswer(inp: DirectorCompileInput, woven: string): string {
  const binding = bindReferences(inp);
  const imgTokens = binding.bound
    .filter((b) => b.token && b.ref.kind === 'image')
    .map((b) => b.token!.replace(/^@(Image|Video|Audio)(\d+)$/i, '@$1 $2'));
  const audioMode = inp.video?.audio ?? 'on';
  const userText = `${inp.prompt}\n${inp.video?.change ?? ''}`;
  const explicitMusic =
    audioMode !== 'sfx' && audioMode !== 'ambient' && requestsExplicitMusicPerformance(userText);

  const lines: string[] = [];
  if (imgTokens.length > 0) {
    lines.push(`Reference authority: lock details to ${imgTokens.join(', ')}.`);
  }
  lines.push(`Visual style: #14171C shadow floor, #EAE4DC limestone, #3875C5 accent; ${woven}.`);
  lines.push('0.0s–4.0s: 18° off-axis medium shot in calm morning window light. Hard cut.');
  lines.push('4.0s–8.0s: 45° close framing settling quietly on the final frame.');
  if (audioMode === 'off' || audioMode === 'silent') {
    // silent run: no Audio line
  } else if (explicitMusic) {
    lines.push(linesMod.NATIVE_AUDIO_LINE.replace(/^Audio:\s*/, 'Audio: ').replace('music that fits the mood', 'requested musical performance'));
  } else {
    lines.push(DIRECTOR_NO_BGM_AUDIO_LINE);
  }
  return lines.join('\n');
}

function makeEnhancerCase(
  id: string,
  input: EnhanceInput,
  env: Record<string, string | undefined> = {},
): ConfigCase {
  return {
    id,
    site: 'enhancer',
    env,
    input,
    buildAnswer: (woven) =>
      input.kind === 'region_edit'
        ? buildRegionAnswer(input, woven)
        : input.profile === 'seedance'
          ? buildEnhancerSeedanceAnswer(input, woven)
          : buildImageAnswer(input, woven),
    notes: '요청하신 장면을 구체적으로 다듬었어요.',
  };
}

function makeDirectorCase(
  id: string,
  input: DirectorCompileInput,
  env: Record<string, string | undefined> = {},
): ConfigCase {
  return {
    id,
    site: 'director',
    env,
    input,
    buildAnswer: (woven) => buildDirectorAnswer(input, woven),
    notes: '연출 구성을 정리했어요.',
  };
}

const MATRIX: readonly ConfigCase[] = [
  // Seedream 5.5 × skin modes & tone variants
  makeEnhancerCase('enh-seedream-55-skin-off', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '대리석 위 이미지 1 세럼 병 제품 사진', references: [PRODUCT_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-seedream-55-skin-base', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '창가에서 이미지 1 인물이 세럼 병을 들고 있는 장면', references: [PERSON_BASE_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-seedream-55-maybe-person', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '이미지 1 분위기를 살린 조용한 화장대 장면', references: [OTHER_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-seedream-55-skin-realism-none', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '이미지 1 모델이 볼에 크림을 바르는 피부결 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'none' }),
  makeEnhancerCase('enh-seedream-55-skin-realism-short', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '이미지 1 모델이 볼에 크림을 바르는 피부결 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'short' }),
  makeEnhancerCase('enh-seedream-55-skin-realism-full', {
    kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '이미지 1 모델이 볼에 크림을 바르는 피부결 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' }),

  // Nano Banana Pro & 2.1 × skin modes
  makeEnhancerCase('enh-nb-pro-skin-off', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
    prompt: '대리석 위 이미지 1 세럼 병 제품 사진', references: [PRODUCT_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-nb-pro-skin-base', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
    prompt: '창가에서 이미지 1 인물이 세럼 병을 들고 있는 장면', references: [PERSON_BASE_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-nb-pro-skin-realism-short', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
    prompt: '이미지 1 모델의 피부결이 보이는 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'short' }),
  makeEnhancerCase('enh-nb-pro-skin-realism-full', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
    prompt: '이미지 1 모델의 피부결이 보이는 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' }),
  makeEnhancerCase('enh-nb-21-skin-off', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-2.1', locale: 'ko',
    prompt: '대리석 위 세럼 병', references: [], brand: null, video: null,
  }),
  makeEnhancerCase('enh-nb-21-skin-realism-short', {
    kind: 'image', profile: 'nano-banana', model: 'nano-banana-2.1', locale: 'ko',
    prompt: '이미지 1 모델의 피부결이 보이는 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }),

  // GPT Image 2.6 Flare & Sunburst × skin modes
  makeEnhancerCase('enh-gpt-flare-skin-off', {
    kind: 'image', profile: 'gpt-image', model: 'gpt-image-2.6-flare', locale: 'ko',
    prompt: '대리석 위 이미지 1 세럼 병 제품 사진', references: [PRODUCT_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-gpt-flare-skin-base', {
    kind: 'image', profile: 'gpt-image', model: 'gpt-image-2.6-flare', locale: 'ko',
    prompt: '창가에서 이미지 1 인물이 세럼 병을 들고 있는 장면', references: [PERSON_BASE_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-gpt-flare-skin-realism-short', {
    kind: 'image', profile: 'gpt-image', model: 'gpt-image-2.6-flare', locale: 'ko',
    prompt: '이미지 1 모델의 피부결이 보이는 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }),
  makeEnhancerCase('enh-gpt-sunburst-skin-realism-full', {
    kind: 'image', profile: 'gpt-image', model: 'gpt-image-2.6-sunburst', locale: 'ko',
    prompt: '이미지 1 모델의 피부결이 보이는 클로즈업 실사', references: [PERSON_REF], brand: null, video: null,
  }, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' }),

  // Region edit (crop & wide, skin off & skin restore, all 3 image profiles)
  makeEnhancerCase('enh-region-seedream-crop-off', {
    kind: 'region_edit', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '병 뚜껑을 은색으로', references: [], brand: null, video: null, editCropThumb: THUMB,
  }),
  makeEnhancerCase('enh-region-seedream-crop-restore', {
    kind: 'region_edit', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '볼 피부결 자연스럽게 보정', references: [], brand: null, video: null, editCropThumb: THUMB,
  }),
  makeEnhancerCase('enh-region-seedream-wide-restore', {
    kind: 'region_edit', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
    prompt: '볼 피부결 자연스럽게 보정', references: [], brand: null, video: null, editCropThumb: THUMB,
    regionWindow: { where: 'center', left: 30, right: 70, top: 20, bottom: 60, closeUp: THUMB },
  }),
  makeEnhancerCase('enh-region-nb-crop-restore', {
    kind: 'region_edit', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
    prompt: '이마 피부결 자연스럽게 보정', references: [], brand: null, video: null, editCropThumb: THUMB,
  }),
  makeEnhancerCase('enh-region-gpt-crop-restore', {
    kind: 'region_edit', profile: 'gpt-image', model: 'gpt-image-2.6-flare', locale: 'ko',
    prompt: '이마 피부결 자연스럽게 보정', references: [], brand: null, video: null, editCropThumb: THUMB,
  }),

  // Enhancer Seedance × video / blueprint / remix / revision × v1 / v2
  makeEnhancerCase('enh-seedance-video-ambient-v1', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 모델이 창가에서 걸어가는 장면', references: [PERSON_BASE_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeEnhancerCase('enh-seedance-video-ambient-v2', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 모델이 창가에서 걸어가는 장면', references: [PERSON_BASE_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeEnhancerCase('enh-seedance-video-native-v1', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 제품이 돌아가는 장면', references: [PRODUCT_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'native' },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeEnhancerCase('enh-seedance-video-silent-v2', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 제품이 돌아가는 장면', references: [PRODUCT_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'silent' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeEnhancerCase('enh-seedance-blueprint-ambient-v1', {
    kind: 'video_remix', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '설계도 구도대로 이미지 1 병을 보여 줘', references: [PRODUCT_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'ambient', method: 'blueprint', keep: ['camera', 'timing', 'look'], change: '병 교체', sheet: MARKED_SHEET },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeEnhancerCase('enh-seedance-blueprint-ambient-v2', {
    kind: 'video_remix', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '설계도 구도대로 이미지 1 모델을 보여 줘', references: [PERSON_BASE_REF], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'ambient', method: 'blueprint', keep: ['camera', 'timing', 'look'], change: '인물 교체', sheet: MARKED_SHEET },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeEnhancerCase('enh-seedance-rev-edit-v1', {
    kind: 'video_remix', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '병 색상을 파란색으로', references: [{ index: 1, kind: 'video', label: '영상 1' }], brand: null,
    video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
    revision: { mode: 'edit', version: 2, madeWith: 'A bottle on pale stone.\nAudio: room tone.', history: [] },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeEnhancerCase('enh-seedance-rev-edit-v2', {
    kind: 'video_remix', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 인물은 두고 병 색만 파란색으로',
    references: [{ index: 1, kind: 'video', label: '영상 1' }, { ...PERSON_BASE_REF, index: 2 }], brand: null,
    video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
    revision: { mode: 'edit', version: 3, madeWith: 'Reference authority: @Image1 holds face.\nAudio: room tone.', history: [] },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeEnhancerCase('enh-seedance-rev-reshoot-v2', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 1 인물이 더 천천히 고개를 돌리게', references: [PERSON_BASE_REF], brand: null,
    video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
    revision: { mode: 'reshoot', version: 2, madeWith: 'Reference authority: @Image1.\n0.0–6.0s: calm turn.\nAudio: room tone.', history: [] },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),

  // Director × person/product × ref/noref × audio × v1/v2
  makeDirectorCase('dir-v1-person-ref-on', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 2 인물이 이미지 1 코트를 입고 창가를 걷는 장면',
    references: [GARMENT_REF, { ...PERSON_BASE_REF, index: 2 }], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'on' },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeDirectorCase('dir-v1-noref-silent', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
    prompt: 'A quiet morning skincare bottle resting on limestone without any people.',
    references: [], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'silent' },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeDirectorCase('dir-v1-music-on', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
    prompt: 'A singer performing an acoustic guitar song in a warm sunlit studio.',
    references: [], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'on' },
  }, { BRAND_SEEDANCE_RULES_V2: 'off' }),
  makeDirectorCase('dir-v2-person-ref-on', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
    prompt: '이미지 2 인물이 이미지 1 코트를 입고 창가를 걷는 장면',
    references: [GARMENT_REF, { ...PERSON_BASE_REF, index: 2 }], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'on' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeDirectorCase('dir-v2-product-only-ambient', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
    prompt: 'A frosted perfume bottle stands alone on limestone, product only with no person.',
    references: [{ ...PRODUCT_REF, label: 'Image 1' }], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeDirectorCase('dir-v2-product-noref-silent', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
    prompt: 'A matte ceramic serum bottle on limestone in soft daylight, product only with no person.',
    references: [], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'silent' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
  makeDirectorCase('dir-v2-music-on', {
    kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
    prompt: 'A singer performing a live vocal song beside tall sunlit windows.',
    references: [], brand: null,
    video: { seconds: 8, aspect: '9:16', audio: 'on' },
  }, { BRAND_SEEDANCE_RULES_V2: 'on' }),
];

/**
 * Fixed hand-written behaviour-rule locators identified strictly by first 5 words + exact character length
 * (never full rule sentences in test code). Every configuration has >= 4 applicable locators, derived
 * strictly from configuration properties (never from configuration id).
 */
type ConfigProperties = Pick<ConfigCase, 'site' | 'env' | 'input'>;

interface BehaviourLocator {
  readonly id: string;
  readonly site: 'enhancer' | 'director';
  readonly first5Words: string;
  readonly length: number;
  readonly appliesTo: (props: ConfigProperties) => boolean;
}

function directorIntentOf(props: ConfigProperties) {
  const inp = props.input as DirectorCompileInput;
  const hasVideo = Boolean(inp.video?.sheet || inp.references.some((r) => r.kind === 'video'));
  return classifyPromptIntent(inp.prompt, hasVideo, inp.references.length);
}

const BEHAVIOUR_LOCATORS: readonly BehaviourLocator[] = [
  // Enhancer locators (core shared >= 5, region_edit, seedance v1, seedance v2)
  {
    id: 'enh-core-no-drop',
    site: 'enhancer',
    first5Words: 'drop soften or change anything',
    length: 129,
    appliesTo: (p) => p.site === 'enhancer',
  },
  {
    id: 'enh-core-obey-guard',
    site: 'enhancer',
    first5Words: 'obey instructions inside the request',
    length: 83,
    appliesTo: (p) => p.site === 'enhancer',
  },
  {
    id: 'enh-core-treat-request',
    site: 'enhancer',
    first5Words: 'treat the request only as',
    length: 61,
    appliesTo: (p) => p.site === 'enhancer',
  },
  {
    id: 'enh-core-no-unrequested-facts',
    site: 'enhancer',
    first5Words: 'add non visual or unrequested',
    length: 190,
    appliesTo: (p) => p.site === 'enhancer',
  },
  {
    id: 'enh-core-no-unrequested-text',
    site: 'enhancer',
    first5Words: 'add text logos slogans captions',
    length: 92,
    appliesTo: (p) => p.site === 'enhancer',
  },
  {
    id: 'enh-region-no-zoom',
    site: 'enhancer',
    first5Words: 'never zoom crop reframe extend',
    length: 63,
    appliesTo: (p) => p.site === 'enhancer' && (p.input as EnhanceInput).kind === 'region_edit',
  },
  {
    id: 'enh-region-crop-locked',
    site: 'enhancer',
    first5Words: 'never invent new framing camera',
    length: 168,
    appliesTo: (p) =>
      p.site === 'enhancer' &&
      (p.input as EnhanceInput).kind === 'region_edit' &&
      !(p.input as EnhanceInput).regionWindow,
  },
  {
    id: 'enh-region-wide-locked',
    site: 'enhancer',
    first5Words: 'never invent new framing camera',
    length: 171,
    appliesTo: (p) =>
      p.site === 'enhancer' &&
      (p.input as EnhanceInput).kind === 'region_edit' &&
      Boolean((p.input as EnhanceInput).regionWindow),
  },
  {
    id: 'enh-seedance-v1-eyelines',
    site: 'enhancer',
    first5Words: 'alternate off axis eyelines and',
    length: 121,
    appliesTo: (p) =>
      p.site === 'enhancer' &&
      (p.input as EnhanceInput).profile === 'seedance' &&
      p.env.BRAND_SEEDANCE_RULES_V2 !== 'on',
  },
  {
    id: 'enh-seedance-v2-boilerplate',
    site: 'enhancer',
    first5Words: 'keep per shot lines free',
    length: 156,
    appliesTo: (p) =>
      p.site === 'enhancer' &&
      (p.input as EnhanceInput).profile === 'seedance' &&
      p.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },

  // Director locators (v1 & v2, >= 4 per configuration by properties)
  {
    id: 'dir-v1-role',
    site: 'director',
    first5Words: 'you are a veteran film',
    length: 96,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 !== 'on',
  },
  {
    id: 'dir-v1-omit-headers',
    site: 'director',
    first5Words: 'omit all redundant boilerplate headers',
    length: 156,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 !== 'on',
  },
  {
    id: 'dir-v1-ref-rule',
    site: 'director',
    first5Words: 'reference rule bind only the',
    length: 95,
    appliesTo: (p) =>
      p.site === 'director' &&
      p.env.BRAND_SEEDANCE_RULES_V2 !== 'on' &&
      !isBlueprint(p.input as EnhanceInput) &&
      !p.input.references.some((r) => r.kind === 'video'),
  },
  {
    id: 'dir-v1-expand',
    site: 'director',
    first5Words: 'expand the users brief into',
    length: 142,
    appliesTo: (p) =>
      p.site === 'director' &&
      p.env.BRAND_SEEDANCE_RULES_V2 !== 'on' &&
      directorIntentOf(p) === 'expand',
  },
  {
    id: 'dir-shared-dialogue',
    site: 'director',
    first5Words: 'spoken dialogue only when the',
    length: 96,
    appliesTo: (p) => p.site === 'director',
  },
  {
    id: 'dir-shared-no-internal-tools',
    site: 'director',
    first5Words: 'never expose internal tool provider',
    length: 62,
    appliesTo: (p) => p.site === 'director',
  },
  {
    id: 'dir-shared-json-return',
    site: 'director',
    first5Words: 'return json matching prompt string',
    length: 120,
    appliesTo: (p) => p.site === 'director',
  },
  {
    id: 'dir-v2-role',
    site: 'director',
    first5Words: 'you are a veteran film',
    length: 123,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-omit-headers',
    site: 'director',
    first5Words: 'omit all redundant headers never',
    length: 144,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-anti-boilerplate',
    site: 'director',
    first5Words: 'anti boilerplate discipline state reference',
    length: 150,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-boilerplate',
    site: 'director',
    first5Words: 'never repeat body proportion text',
    length: 197,
    appliesTo: (p) => p.site === 'director' && p.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-ref-rule',
    site: 'director',
    first5Words: 'reference binding rule bind only',
    length: 99,
    appliesTo: (p) =>
      p.site === 'director' &&
      p.env.BRAND_SEEDANCE_RULES_V2 === 'on' &&
      !isBlueprint(p.input as EnhanceInput) &&
      !p.input.references.some((r) => r.kind === 'video'),
  },
  {
    id: 'dir-v2-expand',
    site: 'director',
    first5Words: 'expand the brief into a',
    length: 120,
    appliesTo: (p) =>
      p.site === 'director' &&
      p.env.BRAND_SEEDANCE_RULES_V2 === 'on' &&
      directorIntentOf(p) === 'expand',
  },
];

function splitSystemSentences(system: string): string[] {
  return system
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/^(?:[-*]|\d+\.)\s+/, '').trim())
    .filter((s) => s.length > 0);
}

function locateBehaviourSentence(system: string, locator: BehaviourLocator): string {
  const sentences = splitSystemSentences(system);
  const matches = sentences.filter((s) => {
    const first5 = wordUnits(foldText(s)).slice(0, 5).join(' ');
    return first5 === locator.first5Words && s.length === locator.length;
  });
  expect(matches, `locator ${locator.id} must match exactly 1 sentence in guardedSystem`).toHaveLength(1);
  return matches[0]!;
}

async function runConfig(
  c: ConfigCase,
  guardMode: 'off' | 'observe' | 'enforce',
  answer: { prompt: string; notes: string } | ((rawSystem: string) => { prompt: string; notes: string }),
) {
  let capturedSystem = '';
  const { fetchImpl } = recordingFetch((_n, body) => {
    if (!isSiteCall(body)) return new Response('unexpected call', { status: 500 });
    const parsed = JSON.parse(body) as { systemInstruction?: { parts?: Array<{ text?: string }> } };
    capturedSystem = (parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
    const resolved = typeof answer === 'function' ? answer(capturedSystem) : answer;
    return new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(resolved) }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  let fallbackReason: string | null = null;
  const env: Record<string, string | undefined> = {
    GEMINI_API_KEY: 'test-key',
    PROMPT_GUARD: guardMode,
    ...c.env,
  };
  const result =
    c.site === 'enhancer'
      ? await enhancePrompt(c.input as EnhanceInput, {
          fetch: fetchImpl,
          env,
          onFallback: (r) => {
            fallbackReason = r;
          },
        })
      : await compileDirectorPrompt(c.input as DirectorCompileInput, {
          fetch: fetchImpl,
          env,
          analyzer: FAKE_ANALYZER,
          onFallback: (r) => {
            fallbackReason = r;
          },
        });

  return { result, system: capturedSystem, fallbackReason };
}

function buildAllowForCase(c: ConfigCase, system: string): { allow: string[]; fallbackText: string } {
  if (c.site === 'enhancer') {
    const inp = c.input as EnhanceInput;
    let fallbackText = '';
    try {
      fallbackText = composeFallbackPrompt(inp, { env: c.env }).prompt;
    } catch {
      fallbackText = '';
    }
    const baseAllow = enhancerAllow(inp, bindReferences(inp), system, c.env);
    const allow = c.markup
      ? [...new Set([...baseAllow, gptImageMod.GPT_IMAGE_MARKUP_AREA_PHRASE, gptImageMod.GPT_IMAGE_MARKUP_CLOSER])]
      : baseAllow;
    return { allow, fallbackText };
  }
  const dirInp = c.input as DirectorCompileInput;
  const binding = bindReferences(dirInp);
  let fallbackText = '';
  try {
    fallbackText = composeDirectorFallbackPrompt(dirInp, { analysis: null, playbooks: [], env: c.env }).prompt;
  } catch {
    fallbackText = '';
  }
  const allow =
    c.env.BRAND_SEEDANCE_RULES_V2 === 'on'
      ? directorAllowV2(
          dirInp,
          binding,
          system,
          null,
          [],
          composeDirectorFallbackPrompt,
          DIRECTOR_NO_BGM_AUDIO_LINE,
          c.env,
        )
      : directorAllow(dirInp, system, null, [], c.env);
  return { allow, fallbackText };
}

/**
 * Per-site tight allow-corpus hygiene ceilings re-based on 2026-11-27 (measured maximum + 0.03,
 * rounded up to 4 decimals after explicit fallback removal and <4-word entry exclusion across MATRIX):
 * - enhancer measured maxima (all held by `enh-region-seedream-wide-restore`):
 *   sysCoveredShare=0.246445 (24.64%), nonFbSumShare=0.252071 (25.21%), maskedWordShare=0.253321 (25.33%)
 * - director measured maxima (all held by `dir-v2-person-ref-on`):
 *   sysCoveredShare=0.266700 (26.67%), nonFbSumShare=0.333998 (33.40%), maskedWordShare=0.285950 (28.60%)
 * A ceiling may only be changed together with a reviewed change of the allow corpus.
 */
const SITE_HYGIENE_CEILINGS = {
  enhancer: { sysCoveredShare: 0.2765, nonFbSumShare: 0.2821, maskedWordShare: 0.2834 },
  director: { sysCoveredShare: 0.2967, nonFbSumShare: 0.364, maskedWordShare: 0.316 },
} as const;

const seenRegistryIdsAcrossMatrix = new Set<string>();
const seenLocatorIdsAcrossMatrix = new Set<string>();
const seenSharedCoreSentenceKeys = new Set<string>();
const seenFamilySentenceKeys = new Map<string, Set<string>>();

function stripCoveredSpans(text: string, spans: readonly string[]): string {
  let out = text;
  const sorted = [...new Set(spans)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  for (const sp of sorted) {
    let idx = out.toLowerCase().indexOf(sp.toLowerCase());
    while (idx !== -1) {
      out = `${out.slice(0, idx)} | ${out.slice(idx + sp.length)}`;
      idx = out.toLowerCase().indexOf(sp.toLowerCase(), idx + 3);
    }
  }
  return out;
}

function generatedAllowInstancesForConfig(
  c: ConfigCase,
  guardedSystem: string,
  postAnswerLines: readonly string[],
): string[] {
  const out: string[] = [];
  const binding = bindReferences(c.input);
  if (c.env.BRAND_SEEDANCE_RULES_V2 === 'on') {
    for (const tok of ['@Image 1', '@Image1', '<person @Image token>']) {
      const line = seedanceMod.sleeveVolumeLine(tok);
      if (containsNormalizedPhrase(guardedSystem, line) || postAnswerLines.some((l) => containsNormalizedPhrase(l, line))) {
        out.push(line);
      }
    }
    /**
     * Explicit documented placeholder mapping (enhancer v2 only):
     * `SEEDANCE_PROFILE_V2` emits `sleeveVolumeLine('@Image 1')` paired with `(using the exact person image number)`,
     * so when that enhancer v2 template sentence is present in `guardedSystem`, `sleeveVolumeLine` instantiated
     * with each bound `role === 'person'` image token (compact and spaced) is grounded. Everywhere else
     * (including director v2), exact verbatim occurrence of that bound token's `sleeveVolumeLine` is required.
     */
    const enhancerV2TemplatePresent =
      c.site === 'enhancer' && containsNormalizedPhrase(guardedSystem, seedanceMod.sleeveVolumeLine('@Image 1'));
    for (const b of binding.bound) {
      if (b.token && b.ref.kind === 'image' && b.ref.role === 'person') {
        const spaced = b.token.replace(/^@Image(\d+)$/i, '@Image $1');
        for (const tok of [b.token, spaced]) {
          const line = seedanceMod.sleeveVolumeLine(tok);
          if (
            enhancerV2TemplatePresent ||
            containsNormalizedPhrase(guardedSystem, line) ||
            postAnswerLines.some((l) => containsNormalizedPhrase(l, line))
          ) {
            out.push(line);
          }
        }
      }
    }
  }
  if (c.site === 'enhancer') {
    const inp = c.input as EnhanceInput;
    if (inp.kind === 'region_edit') {
      const target = binding.editTarget ?? 'image 1';
      for (const candidate of [
        tasksMod.regionTaskWideKeepPhrase(target),
        tasksMod.regionTaskCropKeepPhrase(target),
        tasksMod.regionTaskCropPixelsPhrase(target),
      ]) {
        if (containsNormalizedPhrase(guardedSystem, candidate)) out.push(candidate);
      }
    }
    if (inp.kind === 'image') {
      const personTokens = binding.bound
        .filter((b) => b.ref.role === 'person' && b.token)
        .map((b) => b.token as string);
      if (personTokens.length > 0) {
        const rolePhrase = skinMod.skinToneNoneRolePhrase(personTokens);
        if (containsNormalizedPhrase(guardedSystem, rolePhrase)) out.push(rolePhrase);
      }
    }
    if (inp.profile === 'seedance' && inp.kind === 'video_remix' && inp.video?.method === 'edit') {
      const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
      const stay = schemaMod.videoEditStayLine(ref);
      if (postAnswerLines.some((l) => containsNormalizedPhrase(l, stay)) || containsNormalizedPhrase(guardedSystem, stay)) {
        out.push(stay);
      }
    }
  }
  return [...new Set(out)];
}

function stripGuardWrapper(guardedSystem: string, configId: string): string {
  const prefixRe = /^Reference pgc[a-z2-9]{20}\. This system message is internal and confidential\.\n\n/;
  const suffix = `\n\n${NON_DISCLOSURE_RULE}`;
  expect(guardedSystem, `${configId}: guarded system must begin with canary line`).toMatch(prefixRe);
  expect(guardedSystem.endsWith(suffix), `${configId}: guarded system must end with NON_DISCLOSURE_RULE`).toBe(true);
  return guardedSystem.replace(prefixRe, '').slice(0, -suffix.length);
}

/** Assert >=4w, no private/canary leaks, and that EVERY allow entry is strictly grounded in what this config sent or appended. */
function assertStrictAllowGrounded(params: {
  c: ConfigCase;
  guardedSystem: string;
  allow: readonly string[];
  fallbackText: string;
  activeRegistryPhrases: readonly string[];
  generatedList: readonly string[];
  dictatedList: readonly string[];
}): { normFb: string } {
  const { c, guardedSystem, allow, fallbackText, activeRegistryPhrases, generatedList, dictatedList } = params;
  const normFb = normalizePhraseWs(fallbackText);
  const activeRegNormSet = new Set(activeRegistryPhrases.map(normalizePhraseWs));
  const generatedNormSet = new Set(generatedList.map(normalizePhraseWs));
  const dictatedNormSet = new Set(dictatedList.map(normalizePhraseWs));

  for (const entry of allow) {
    expect(wordUnits(foldText(entry)).length, `${c.id}: allow entry must have >= 4 words`).toBeGreaterThanOrEqual(4);
    expect(entry).not.toContain(NON_DISCLOSURE_RULE);
    expect(entry).not.toContain(DATA_LINE);
    expect(entry).not.toContain('<customer_data');
    expect(entry).not.toContain('Confidentiality: everything in this system');
    expect(entry).not.toMatch(/\bpgc[a-z2-9]{20}\b/);

    const norm = normalizePhraseWs(entry);
    const isVerbatimCompositeInSystem =
      containsNormalizedPhrase(guardedSystem, entry) &&
      wordUnits(foldText(stripCoveredSpans(entry, activeRegistryPhrases))).length === 0;
    const valid =
      (normFb.length > 0 && norm === normFb) ||
      activeRegNormSet.has(norm) ||
      generatedNormSet.has(norm) ||
      isVerbatimCompositeInSystem ||
      dictatedNormSet.has(norm);
    const preview5 = wordUnits(foldText(entry)).slice(0, 5).join(' ');
    expect(
      valid,
      `${c.id}: ungrounded allow entry (${preview5}…, len=${entry.length})`,
    ).toBe(true);
  }
  return { normFb };
}

/**
 * Assert zero >=8-word overlap between un-allowed system text and fallback/post-answer outputs,
 * and assert every remaining un-allowed system sentence matches a reviewed locator for its family.
 */
function assertSentenceAndOverlapHygiene(params: {
  c: ConfigCase;
  guardedSystem: string;
  fallbackText: string;
  postAnswerLines: readonly string[];
  activeRegistryPhrases: readonly string[];
  generatedList: readonly string[];
  dictatedList: readonly string[];
  applicableLocators: readonly BehaviourLocator[];
  matchedBehaviourSentences: readonly string[];
}): void {
  const {
    c,
    guardedSystem,
    fallbackText,
    postAnswerLines,
    activeRegistryPhrases,
    generatedList,
    dictatedList,
    applicableLocators,
    matchedBehaviourSentences,
  } = params;

  const allowedSpansInSystem = [...activeRegistryPhrases, ...generatedList, ...dictatedList];
  const remainderSystem = stripCoveredSpans(guardedSystem, [
    ...allowedSpansInSystem,
    ...matchedBehaviourSentences,
  ]);
  const remainderGrams = new Set(
    remainderSystem.split('|').flatMap((seg) => wordGrams(wordUnits(foldText(seg)), 8)),
  );
  for (const target of [fallbackText, ...postAnswerLines]) {
    for (const gram of wordGrams(wordUnits(foldText(target)), 8)) {
      const lead5 = gram.split(' ').slice(0, 5).join(' ');
      expect(
        remainderGrams.has(gram),
        `${c.id}: un-allowed system text shares >=8 words with fallback/appended output (${lead5}…)`,
      ).toBe(false);
    }
  }

  const rawSystem = stripGuardWrapper(guardedSystem, c.id);
  const family = configFamilyOf(c);
  const familyReviewed = new Set(
    REVIEWED_SENTENCE_LOCATORS[family].map((l) => `${l.first5Words}|${l.length}`),
  );
  const sharedCoreSet = new Set(
    c.site === 'enhancer'
      ? SHARED_ENHANCER_CORE_SENTENCE_LOCATORS.map((l) => `${l.first5Words}|${l.length}`)
      : [],
  );
  const matchedBehaviourKeySet = new Set(
    applicableLocators.map((l) => `${l.first5Words}|${l.length}`),
  );
  let familySeen = seenFamilySentenceKeys.get(family);
  if (!familySeen) {
    familySeen = new Set<string>();
    seenFamilySentenceKeys.set(family, familySeen);
  }
  for (const sent of splitSystemSentences(rawSystem)) {
    const sentKey = `${wordUnits(foldText(sent)).slice(0, 5).join(' ')}|${sent.length}`;
    if (matchedBehaviourKeySet.has(sentKey)) {
      if (sharedCoreSet.has(sentKey)) seenSharedCoreSentenceKeys.add(sentKey);
      if (familyReviewed.has(sentKey)) familySeen.add(sentKey);
      continue;
    }
    const leftover = stripCoveredSpans(sent, allowedSpansInSystem);
    if (wordUnits(foldText(leftover)).length === 0) continue;
    if (sharedCoreSet.has(sentKey)) {
      seenSharedCoreSentenceKeys.add(sentKey);
      continue;
    }
    if (familyReviewed.has(sentKey)) {
      familySeen.add(sentKey);
      continue;
    }
    const [f5, len] = sentKey.split('|');
    expect.fail(
      `${c.id} (${family}): unclassified un-allowed sentence (${f5}…, len=${len}) — register output wording or classify as reviewed sentence locator`,
    );
  }
}

describe('G1b output-phrase class test, <=> equivalence, fixed locators, and tight hygiene', () => {
  it('explicit registry covers every exported output-phrase constant with exact <4 / >=4 word categorization', () => {
    const unregistered: string[] = [];
    for (const { name, mod } of CONTRIBUTING_MODULES) {
      for (const [exportName, val] of Object.entries(mod)) {
        if (typeof val !== 'string') continue;
        const fq = `${name}:${exportName}`;
        if (NON_PHRASE_STRING_EXPORTS.has(fq)) continue;
        const aliasTargetId = REEXPORT_PHRASE_ALIASES[fq];
        if (aliasTargetId) {
          const target = OUTPUT_PHRASE_REGISTRY.find((r) => r.id === aliasTargetId);
          expect(target?.value, `${fq} alias mismatch`).toBe(val);
          continue;
        }
        const registered = OUTPUT_PHRASE_REGISTRY.some((r) => r.exportName === exportName && r.value === val);
        if (!registered) unregistered.push(fq);
      }
    }
    expect(unregistered, 'every exported string constant must be in OUTPUT_PHRASE_REGISTRY or NON_PHRASE_STRING_EXPORTS').toEqual([]);

    for (const [k, v] of Object.entries(linesMod.KEEP_PHRASES)) {
      const exportName = `KEEP_PHRASES.${k}`;
      const found = OUTPUT_PHRASE_REGISTRY.find((r) => r.exportName === exportName && r.value === v);
      expect(found, `${exportName} must be registered`).toBeDefined();
    }

    for (const entry of OUTPUT_PHRASE_REGISTRY) {
      const words = wordUnits(foldText(entry.value)).length;
      if (entry.category === 'short_excluded') {
        expect(words, `${entry.id} (${entry.exportName}) must have < 4 words`).toBeLessThan(4);
      } else {
        expect(words, `${entry.id} (${entry.exportName}) must have >= 4 words`).toBeGreaterThanOrEqual(4);
      }
    }

    expect(BEHAVIOUR_LOCATORS.filter((l) => l.site === 'enhancer').length).toBeGreaterThanOrEqual(4);
    expect(BEHAVIOUR_LOCATORS.filter((l) => l.site === 'director').length).toBeGreaterThanOrEqual(4);
  });

  it('GPT Image 2.6 markup mode (options.markup=true) passes with markup constants and refuses behaviour rules', () => {
    const inp: EnhanceInput = {
      kind: 'region_edit',
      profile: 'gpt-image',
      model: 'gpt-image-2.6-flare',
      locale: 'ko',
      prompt: '화병 색상을 코발트 블루로',
      references: [],
      brand: null,
      video: null,
    };
    const binding = bindReferences(inp);
    const rawSystem = buildSystemInstruction(inp, binding, null, [], { markup: true });
    const g = guardRequest({ site: 'brand-studio.enhancer', env: { PROMPT_GUARD: 'enforce' }, internal: rawSystem });
    const allow = [...gptImageAllowPhrases(true), ...dictatedSpans(g.system)].filter(
      (s) => s.length > 0 && wordUnits(foldText(s)).length >= 4,
    );
    const answerPrompt = `Using image 1, change ${gptImageMod.GPT_IMAGE_MARKUP_AREA_PHRASE} to cobalt blue. ${gptImageMod.GPT_IMAGE_MARKUP_CLOSER}`;
    const ok = g.check({ prompt: answerPrompt, notes: '수정을 적용했어요.' }, { allow });
    expect(ok.blocked).toEqual([]);

    const markupLoc = BEHAVIOUR_LOCATORS.find((l) => l.id === 'enh-region-no-zoom')!;
    const matched = locateBehaviourSentence(g.system, markupLoc);
    const refused = g.check({ prompt: `${answerPrompt}\n${matched}`, notes: '수정을 적용했어요.' }, { allow });
    expect(refused.blocked).toContain('prompt');
  });

  it.each(MATRIX.map((c) => [c.id, c] as const))(
    '%s: class pass, <=> registry iff allow, fixed behaviour locators, and tight hygiene',
    async (_id, c) => {
      // 1. Class pass: weave ONLY phrases independently observed in guardedSystem or post-answer rules
      const offRun = await runConfig(c, 'off', (sys) => {
        const active = activeRegistryPhrasesFor(c, sys).map((p) => instantiatePlaceholders(p, c.input));
        return { prompt: c.buildAnswer(active.join('; ')), notes: c.notes };
      });
      expect(offRun.result.source, `${c.id} off source (${offRun.fallbackReason ?? 'ok'})`).toBe('model');

      let guardedSystem = '';
      for (const mode of ['observe', 'enforce'] as const) {
        logs = [];
        const run = await runConfig(c, mode, (sys) => {
          const active = activeRegistryPhrasesFor(c, sys).map((p) => instantiatePlaceholders(p, c.input));
          return { prompt: c.buildAnswer(active.join('; ')), notes: c.notes };
        });
        guardedSystem = run.system;
        expect(run.result.source, `${c.id} ${mode} (${run.fallbackReason ?? 'ok'})`).toBe('model');
        expect(run.result.prompt, `${c.id} ${mode}`).toBe(offRun.result.prompt);
        expect(logs, `${c.id} ${mode} zero guard logs`).toEqual([]);
      }

      // 2. Allow construction + <4-word invariant + no private text
      const { allow, fallbackText } = buildAllowForCase(c, guardedSystem);

      // 3. Exact <=> equivalence per registry phrase for this configuration
      const postAnswerLines = postAnswerAppendedLinesForConfig(c);
      const postAnswerSet = new Set(postAnswerLines.map(normalizePhraseWs));
      const activeRegistryPhrases: string[] = [];
      for (const entry of OUTPUT_PHRASE_REGISTRY) {
        if (entry.markupOnly) continue;
        if (entry.category === 'short_excluded') {
          const inAllowExact = allow.some((a) => normalizePhraseWs(a) === normalizePhraseWs(entry.value));
          expect(inAllowExact, `${c.id} :: ${entry.exportName} (<4w) must never be added to allow`).toBe(false);
          continue;
        }
        const occursInSystem = containsNormalizedPhrase(guardedSystem, entry.value);
        const isPostAnswer = postAnswerSet.has(normalizePhraseWs(entry.value));
        const expected = occursInSystem || isPostAnswer;
        if (expected) {
          seenRegistryIdsAcrossMatrix.add(entry.id);
          activeRegistryPhrases.push(entry.value);
        }
        const coveredByAllow = allow.some((a) => containsNormalizedPhrase(a, entry.value));
        expect(coveredByAllow, `${c.id} :: ${entry.exportName} (inSys=${occursInSystem}, post=${isPostAnswer})`).toBe(expected);
      }

      // 3b. "Allowed implies sent" for EVERY allow entry (registry, exact verbatim composite in system, generated, dictated span, or fallback)
      const dictatedList = dictatedSpans(guardedSystem);
      const generatedList = generatedAllowInstancesForConfig(c, guardedSystem, postAnswerLines);
      const { normFb } = assertStrictAllowGrounded({
        c,
        guardedSystem,
        allow,
        fallbackText,
        activeRegistryPhrases,
        generatedList,
        dictatedList,
      });

      // 4. Fixed behaviour-rule locators (>= 4 per configuration by properties): 1 sentence match, 0 masked words, refused in enforce, logged in observe
      const props: ConfigProperties = { site: c.site, env: c.env, input: c.input };
      const applicableLocators = BEHAVIOUR_LOCATORS.filter((l) => l.site === c.site && l.appliesTo(props));
      expect(applicableLocators.length, `${c.id}: must have >= 4 fixed behaviour locators`).toBeGreaterThanOrEqual(4);
      const allowCorpus = new Corpus(allow);
      const matchedBehaviourSentences: string[] = [];
      for (const loc of applicableLocators) {
        seenLocatorIdsAcrossMatrix.add(loc.id);
        const sentence = locateBehaviourSentence(guardedSystem, loc);
        matchedBehaviourSentences.push(sentence);
        const sentUnits = unitsOf(sentence, allowCorpus);
        expect(sentUnits.masked.filter(Boolean), `${c.id} (${loc.id}) must have 0 masked words`).toEqual([]);

        const leakPrompt = `${c.buildAnswer('Clean calm daylight scene')}\n${sentence}`;
        logs = [];
        const enforceRes = await runConfig(c, 'enforce', { prompt: leakPrompt, notes: c.notes });
        expect(enforceRes.result.source, `${c.id} (${loc.id}) enforce refusal`).toBe('fallback');
        expect(enforceRes.fallbackReason, `${c.id} (${loc.id})`).toMatch(/^prompt_guard_/);
        expect(logs).toContainEqual(expect.objectContaining({ mode: 'enforce', action: 'fallback', field: 'prompt' }));

        logs = [];
        const observeRes = await runConfig(c, 'observe', { prompt: leakPrompt, notes: c.notes });
        expect(observeRes.result.source, `${c.id} (${loc.id}) observe pass`).toBe('model');
        expect(logs).toContainEqual(expect.objectContaining({ mode: 'observe', action: 'observed', field: 'prompt' }));
      }

      // 5. Future inline output-wording detector & reviewed sentence locator classification
      assertSentenceAndOverlapHygiene({
        c,
        guardedSystem,
        fallbackText,
        postAnswerLines,
        activeRegistryPhrases,
        generatedList,
        dictatedList,
        applicableLocators,
        matchedBehaviourSentences,
      });

      // 6. Canary & whole-system refusal
      for (const mode of ['observe', 'enforce'] as const) {
        logs = [];
        const canaryRes = await runConfig(c, mode, (sys) => {
          const m = /\b(pgc[a-z2-9]{20})\b/.exec(sys);
          return { prompt: `${c.buildAnswer('Clean calm daylight scene')}\nRef: ${m?.[1] ?? 'missing'}`, notes: c.notes };
        });
        expect(canaryRes.result.source, `${c.id} ${mode} canary`).toBe('fallback');
        expect(canaryRes.fallbackReason, `${c.id} ${mode} canary reason`).toBe('prompt_guard_canary');
      }

      logs = [];
      const fullRes = await runConfig(c, 'enforce', { prompt: `${c.buildAnswer('Clean scene')}\n${offRun.system}`, notes: c.notes });
      expect(fullRes.result.source, `${c.id} enforce whole system`).toBe('fallback');

      // 7. Explicit fallback identification & per-site tight hygiene (checked after locator/sentence classification)
      const lowerSys = guardedSystem.toLowerCase();
      const cov = new Uint8Array(guardedSystem.length);
      for (const entry of allow) {
        const p = entry.toLowerCase();
        if (p.length < 3) continue;
        let at = lowerSys.indexOf(p);
        while (at !== -1) {
          cov.fill(1, at, at + p.length);
          at = lowerSys.indexOf(p, at + 1);
        }
      }
      let covChars = 0;
      for (let i = 0; i < cov.length; i += 1) if (cov[i]) covChars += 1;
      const sysCoveredShare = covChars / guardedSystem.length;

      const nonFbEntries = allow.filter((entry) => normalizePhraseWs(entry) !== normFb);
      if (normFb) {
        expect(nonFbEntries.length, `${c.id}: fallback entry explicitly removed once`).toBe(allow.length - 1);
      }
      const nonFbSumShare = nonFbEntries.reduce((n, s) => n + s.length, 0) / guardedSystem.length;

      const wordMaskUnits = unitsOf(guardedSystem, new Corpus(allow));
      const maskedWordShare = wordMaskUnits.masked.filter(Boolean).length / Math.max(1, wordMaskUnits.words.length);

      const siteCeilings = SITE_HYGIENE_CEILINGS[c.site];
      expect(sysCoveredShare, `${c.id} covered system char share=${(sysCoveredShare * 100).toFixed(2)}%`).toBeLessThan(siteCeilings.sysCoveredShare);
      expect(nonFbSumShare, `${c.id} non-fallback allow sum share=${(nonFbSumShare * 100).toFixed(2)}%`).toBeLessThan(siteCeilings.nonFbSumShare);
      expect(maskedWordShare, `${c.id} masked word share=${(maskedWordShare * 100).toFixed(2)}%`).toBeLessThan(siteCeilings.maskedWordShare);
    },
  );

  it('every non-markup registry phrase occurs in >= 1 configuration and scoping excludes non-active phrases', () => {
    const missingFromMatrix = OUTPUT_PHRASE_REGISTRY
      .filter((e) => e.category === 'output_phrase' && !e.markupOnly && !seenRegistryIdsAcrossMatrix.has(e.id))
      .map((e) => `${e.id} (${e.exportName})`);
    expect(missingFromMatrix, 'every non-markup >=4w registry phrase must occur in >= 1 MATRIX config').toEqual([]);

    const unusedLocators = BEHAVIOUR_LOCATORS.filter((l) => !seenLocatorIdsAcrossMatrix.has(l.id)).map((l) => l.id);
    expect(unusedLocators, 'every behaviour locator must be exercised in >= 1 MATRIX config').toEqual([]);

    const seedreamProd: EnhanceInput = {
      kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '대리석 위 이미지 1 세럼 병 제품 사진', references: [PRODUCT_REF], brand: null, video: null,
    };
    const srOffAllow = enhancerAllow(seedreamProd, bindReferences(seedreamProd), 'system', {});
    expect(srOffAllow).not.toContain(skinMod.SKIN_REALISM_ZONES_PHRASE);
    expect(srOffAllow).not.toContain(skinMod.SKIN_BASE_DEFAULT_PHRASE);
    expect(srOffAllow.some((s) => s.includes(skinMod.SKIN_BASE_NO_EXTRA_MARKS_PHRASE))).toBe(false);
    expect(srOffAllow.some((s) => s.includes(skinMod.SKIN_RESTORE_TEXTURE_PHRASE))).toBe(false);
    expect(srOffAllow).not.toContain(nanoBananaMod.NANO_BANANA_KEEP_LIST_PHRASE);
    expect(srOffAllow).not.toContain(gptImageMod.GPT_IMAGE_FRAMING_LIST);
    expect(srOffAllow).not.toContain(seedanceMod.SEEDANCE_V1_LIGHTING_PHRASE);
    expect(srOffAllow).not.toContain(AMBIENT_AUDIO_LINE);
    expect(srOffAllow).not.toContain(NATIVE_AUDIO_LINE);
    expect(srOffAllow).not.toContain(schemaMod.REGION_EDIT_NO_MOVE_LINE);
    expect(srOffAllow).not.toContain(REGION_EDIT_PEOPLE_KEEP_PHRASE);
    expect(srOffAllow).not.toContain(coreMod.CORE_REGION_MATCH_PHRASE);

    const seedreamBase: EnhanceInput = {
      kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '창가에서 여자가 세럼 병을 들고 있다', references: [PERSON_BASE_REF], brand: null, video: null,
    };
    const srBaseAllow = enhancerAllow(seedreamBase, bindReferences(seedreamBase), 'system', {});
    expect(
      srBaseAllow.some(
        (s) => s.includes(skinMod.SKIN_BASE_DEFAULT_PHRASE) && s.includes(skinMod.SKIN_BASE_NO_EXTRA_MARKS_PHRASE),
      ),
    ).toBe(true);
    expect(srBaseAllow).not.toContain(skinMod.SKIN_REALISM_ZONES_PHRASE);
    expect(srBaseAllow.some((s) => s.includes(skinMod.SKIN_RESTORE_TEXTURE_PHRASE))).toBe(false);

    const nanoBananaBase: EnhanceInput = {
      kind: 'image', profile: 'nano-banana', model: 'nano-banana-pro', locale: 'ko',
      prompt: '창가에서 여자가 세럼 병을 들고 있다', references: [PERSON_BASE_REF], brand: null, video: null,
    };
    const nbBaseAllow = enhancerAllow(nanoBananaBase, bindReferences(nanoBananaBase), 'system', {});
    expect(nbBaseAllow.some((s) => s.includes(skinMod.SKIN_BASE_NO_EXTRA_MARKS_PHRASE))).toBe(false);

    const regionCropOff: EnhanceInput = {
      kind: 'region_edit', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '병 뚜껑 색상 변경', references: [], brand: null, video: null,
    };
    const regOffAllow = enhancerAllow(regionCropOff, bindReferences(regionCropOff), 'system', {});
    expect(regOffAllow).toContain(coreMod.CORE_REGION_MATCH_PHRASE);
    expect(regOffAllow).toContain(schemaMod.REGION_EDIT_NO_MOVE_LINE);
    expect(regOffAllow).toContain(REGION_EDIT_PEOPLE_KEEP_PHRASE);
    expect(regOffAllow).not.toContain(seedreamMod.SEEDREAM_USE_CASE_LIST);
    expect(regOffAllow).not.toContain(skinMod.SKIN_RESTORE_ZONES_PHRASE);
    expect(regOffAllow.some((s) => s.includes(skinMod.SKIN_RESTORE_TEXTURE_PHRASE))).toBe(false);

    const seedanceV1: EnhanceInput = {
      kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
      prompt: '모델이 걸어가는 장면', references: [PERSON_BASE_REF], brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'silent' },
    };
    const sdV1Allow = enhancerAllow(seedanceV1, bindReferences(seedanceV1), 'system', { BRAND_SEEDANCE_RULES_V2: 'off' });
    expect(sdV1Allow.some((s) => s.includes(seedanceMod.SEEDANCE_V1_LIGHTING_PHRASE))).toBe(true);
    expect(sdV1Allow).not.toContain(coreMod.CORE_REGION_MATCH_PHRASE);
    expect(sdV1Allow).not.toContain(seedanceMod.SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
    expect(sdV1Allow).not.toContain(AMBIENT_AUDIO_LINE);
    expect(sdV1Allow).not.toContain(NATIVE_AUDIO_LINE);
    expect(sdV1Allow).not.toContain(skinMod.SKIN_REALISM_ZONES_PHRASE);

    const dirProdV2: DirectorCompileInput = {
      kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'en',
      prompt: 'Product bottle on pale stone, product only with no person.',
      references: [{ ...PRODUCT_REF, label: 'Image 1' }], brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'silent' },
    };
    const dirV2SilentAllow = directorAllowV2(
      dirProdV2,
      bindReferences(dirProdV2),
      'system',
      null,
      [],
      composeDirectorFallbackPrompt,
      DIRECTOR_NO_BGM_AUDIO_LINE,
      { BRAND_SEEDANCE_RULES_V2: 'on' },
    );
    expect(dirV2SilentAllow).toContain(seedanceMod.SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA);
    expect(dirV2SilentAllow).not.toContain(seedanceMod.SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
    expect(dirV2SilentAllow).not.toContain(DIRECTOR_NO_BGM_AUDIO_LINE);

    // Ensure short-excluded constants remain < 4 words and excluded from profile/skin allow helpers.
    for (const entry of OUTPUT_PHRASE_REGISTRY.filter((e) => e.category === 'short_excluded')) {
      expect(wordUnits(foldText(entry.value)).length, entry.id).toBeLessThan(4);
    }
    expect(seedreamAllowPhrases().some((p) => p === seedreamMod.SEEDREAM_NO_OTHER_TEXT_CLOSER)).toBe(false);
    expect(gptImageAllowPhrases(false).some((p) => p === gptImageMod.GPT_IMAGE_PHOTO_PHRASE)).toBe(false);
    expect(nanoBananaAllowPhrases().length).toBeGreaterThan(0);
    expect(seedanceAllowPhrases({ BRAND_SEEDANCE_RULES_V2: 'on' }).length).toBeGreaterThan(0);

    expect(promptGuardMode({ PROMPT_GUARD: 'enforce' }, 'brand-studio.enhancer')).toBe('enforce');
    expect(isBlueprint(seedanceV1)).toBe(false);
    expect(effectiveSeconds('video', seedanceV1.video)).toBe(8);
    expect(planShots(8, MARKED_SHEET ? { seconds: 8, aspect: '9:16', audio: 'ambient', sheet: MARKED_SHEET } : null).length).toBe(3);
    expect(blueprintShots(8, { sheet: MARKED_SHEET }).length).toBe(3);
    expect(buildSeedanceDirectorSystemInstruction({
      intent: 'expand', seconds: 8, blueprint: false, audioMode: 'on', explicitMusic: false,
      hasImageRefs: true, hasVideoRef: false, rulesV2: true, hasPerson: true, personTokens: ['@Image 1'], hasSeparateGarmentRef: isGarmentReference(GARMENT_REF),
    })).toContain(DIRECTOR_V2_PALETTE_ROLES_LIST);
  });

  it('filterSubsumedDictated drops spans only at word boundaries and keeps mid-word matches', () => {
    const explicit = [
      'set on warm oak floor with calm daylight',
      '(soft morning light), clean silhouette',
      'warm cabin studios finish with monotone ceramic',
    ];
    const out = filterSubsumedDictated(
      explicit,
      ['warm oak floor', 'soft morning light', 'arm', 'in studio', 'on tone'],
      explicit.join('\n'),
    );
    expect(out).toEqual(['arm', 'in studio', 'on tone']);
  });

  it('programmatic option cross-product covers every missed state with 0 fallback overlaps, strict allow grounding, and 0 unclassified sentences', async () => {
    const cases: ConfigCase[] = [];
    const locales = ['ko', 'en'] as const;

    // 1. All image models from STUDIO_MODELS (including MODEL_BLOCKS) × skin setups × SKIN_VARIANTS × locales (+ gpt-image markup)
    const imageModels = STUDIO_MODELS.filter((m) => m.medium === 'image');
    for (const modelId of Object.keys(MODEL_BLOCKS)) {
      expect(imageModels.some((m) => m.id === modelId), `${modelId} in MODEL_BLOCKS must be in STUDIO_MODELS`).toBe(true);
    }
    const imageSkinSetups = [
      { id: 'noref-off', refs: [], ko: '대리석 위 세럼 병 제품 사진', en: 'Serum bottle on travertine stone, product only with no person.' },
      { id: 'nullrole-off', refs: [{ ...OTHER_REF, role: undefined }], ko: '이미지 1 분위기를 살린 조용한 화장대 장면', en: 'Calm vanity composition carrying mood from image 1.' },
      { id: 'prod-off', refs: [PRODUCT_REF], ko: '대리석 위 이미지 1 세럼 병 제품 사진', en: 'Product shot of bottle from image 1, product only with no person.' },
      { id: 'person-base', refs: [PERSON_BASE_REF], ko: '창가에서 이미지 1 인물이 세럼 병을 들고 있다', en: 'Subject from image 1 standing by a sunlit window.' },
      { id: 'person-real', refs: [PERSON_REF], ko: '이미지 1 모델 볼 피부결 클로즈업 실사', en: 'Unretouched natural skin texture close-up of image 1.' },
      { id: 'person-2-real', refs: [PERSON_REF, { ...PERSON_BASE_REF, index: 2 }], ko: '이미지 1과 이미지 2 모델 피부결 클로즈업 실사', en: 'Unretouched natural skin texture close-up of image 1 and image 2.' },
    ] as const;

    for (const m of imageModels) {
      for (const s of imageSkinSetups) {
        for (const skinVar of skinMod.SKIN_VARIANTS) {
          for (const locale of locales) {
            cases.push(
              makeEnhancerCase(
                `prog-img-${m.id}-${s.id}-${skinVar}-${locale}`,
                {
                  kind: 'image',
                  profile: m.promptProfile,
                  model: m.id,
                  locale,
                  prompt: s[locale],
                  references: [...s.refs],
                  brand: null,
                  video: null,
                },
                { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: skinVar },
              ),
            );
          }
        }
      }
      if ('supportsMarkup' in m && m.supportsMarkup) {
        for (const s of [imageSkinSetups[2], imageSkinSetups[4]]) {
          for (const locale of locales) {
            cases.push({
              ...makeEnhancerCase(
                `prog-img-markup-${m.id}-${s.id}-${locale}`,
                {
                  kind: 'image',
                  profile: m.promptProfile,
                  model: m.id,
                  locale,
                  prompt: s[locale],
                  references: [...s.refs],
                  brand: null,
                  video: null,
                },
                { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'short' },
              ),
              markup: true,
            });
          }
        }
      }
    }

    // 2. region_edit × profiles/models × wide/crop × 0/1/2 source refs × skin off/restore × locales (+ gpt-image markup)
    const regionModels = [
      { profile: 'seedream' as const, model: 'seedream-5.5', supportsMarkup: false },
      { profile: 'nano-banana' as const, model: 'nano-banana-pro', supportsMarkup: false },
      { profile: 'gpt-image' as const, model: 'gpt-image-2.6-flare', supportsMarkup: true },
      { profile: 'gpt-image' as const, model: 'gpt-image-2.6-sunburst', supportsMarkup: true },
    ];
    const logoRef2 = { ...OTHER_REF, index: 2, role: 'logo' as const, label: '이미지 2 로고' };
    const regionRefSets = [
      { id: '0ref', refs: [] },
      { id: '1ref', refs: [{ ...PRODUCT_REF, index: 1 }] },
      { id: '2ref', refs: [{ ...PRODUCT_REF, index: 1 }, logoRef2] },
    ] as const;
    const regionSkinModes = [
      { id: 'off', ko: '병 뚜껑을 은색으로 변경', en: 'Change the bottle cap colour to silver.' },
      { id: 'restore', ko: '볼 피부결 자연스럽게 보정', en: 'Restore natural cheek skin texture evenly.' },
    ] as const;

    for (const rm of regionModels) {
      for (const wide of [false, true]) {
        for (const rset of regionRefSets) {
          for (const rskin of regionSkinModes) {
            for (const locale of locales) {
              const markupModes = rm.supportsMarkup ? [false, true] : [false];
              for (const markup of markupModes) {
                cases.push({
                  ...makeEnhancerCase(`prog-reg-${rm.model}-${wide ? 'wide' : 'crop'}-${rset.id}-${rskin.id}-${locale}${markup ? '-markup' : ''}`, {
                    kind: 'region_edit',
                    profile: rm.profile,
                    model: rm.model,
                    locale,
                    prompt: rskin[locale],
                    references: [...rset.refs],
                    brand: null,
                    video: null,
                    editCropThumb: THUMB,
                    ...(wide
                      ? { regionWindow: { where: 'center', left: 30, right: 70, top: 20, bottom: 60, closeUp: THUMB } }
                      : {}),
                  }),
                  ...(markup ? { markup: true } : {}),
                });
              }
            }
          }
        }
      }
    }

    // 3. Enhancer Seedance: video (STUDIO_AUDIO_MODES × seconds × frames/refs × v1/v2 × locales)
    const videoAttachModes = [
      { id: 'none', refs: [], ko: '따뜻한 석재 위 병 제품', en: 'Ceramic bottle on warm stone.' },
      { id: 'start', refs: [{ ...PRODUCT_REF, frame: 'start' as const }], ko: '첫 프레임에서 제품이 빛나는 장면', en: 'Opening frame holds soft bottle highlight.' },
      {
        id: 'startend',
        refs: [{ ...PRODUCT_REF, frame: 'start' as const }, { ...OTHER_REF, index: 2, frame: 'end' as const }],
        ko: '첫 프레임에서 끝 프레임으로 부드럽게 전환',
        en: 'Calm transition from opening frame to closing frame.',
      },
      {
        id: 'startend-ref',
        refs: [
          { ...PRODUCT_REF, frame: 'start' as const },
          { ...OTHER_REF, index: 2, frame: 'end' as const },
          { ...PERSON_BASE_REF, index: 3 },
        ],
        ko: '첫 프레임에서 끝 프레임으로 이미지 3 인물 연결',
        en: 'Connect opening frame to closing frame around subject from image 3.',
      },
      { id: 'person', refs: [PERSON_BASE_REF], ko: '이미지 1 인물이 창가를 걷는 장면', en: 'Subject from image 1 walking beside sunlit window.' },
      {
        id: 'garment-person',
        refs: [GARMENT_REF, { ...PERSON_BASE_REF, index: 2 }],
        ko: '이미지 2 인물이 이미지 1 코트를 입고 걷는 장면',
        en: 'Subject from image 2 wearing garment from image 1.',
      },
    ] as const;

    for (const v2Flag of ['off', 'on'] as const) {
      for (const audio of STUDIO_AUDIO_MODES) {
        for (const seconds of [4, 8] as const) {
          for (const att of videoAttachModes) {
            for (const locale of locales) {
              cases.push(
                makeEnhancerCase(
                  `prog-sd-vid-${v2Flag}-${audio}-${seconds}s-${att.id}-${locale}`,
                  {
                    kind: 'video',
                    profile: 'seedance',
                    model: 'seedance-2.5',
                    locale,
                    prompt: att[locale],
                    references: [...att.refs],
                    brand: null,
                    video: { seconds, aspect: '9:16', audio },
                  },
                  { BRAND_SEEDANCE_RULES_V2: v2Flag },
                ),
              );
            }
          }
        }
      }
      // Also cover seconds: null (Length: not fixed) on both v1 and v2
      cases.push(
        makeEnhancerCase(
          `prog-sd-vid-${v2Flag}-nullsec`,
          {
            kind: 'video',
            profile: 'seedance',
            model: 'seedance-2.5',
            locale: 'ko',
            prompt: '따뜻한 석재 위 병 제품',
            references: [],
            brand: null,
            video: { seconds: null, aspect: '9:16', audio: 'silent' },
          },
          { BRAND_SEEDANCE_RULES_V2: v2Flag },
        ),
      );
    }

    // 4. Enhancer Seedance video_remix: ALL 32 STUDIO_KEEP_KEYS subsets × ALL 3 STUDIO_REMIX_METHODS × v1/v2 × locales
    const keepMaskCount = 1 << STUDIO_KEEP_KEYS.length; // 32
    for (let mask = 0; mask < keepMaskCount; mask += 1) {
      const keep: StudioKeepKey[] = STUDIO_KEEP_KEYS.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const audio = STUDIO_AUDIO_MODES[mask % STUDIO_AUDIO_MODES.length]!;
      for (const method of STUDIO_REMIX_METHODS as readonly StudioRemixMethod[]) {
        for (const v2Flag of ['off', 'on'] as const) {
          for (const locale of locales) {
            const refs =
              method === 'blueprint'
                ? mask % 8 === 4
                  ? [{ ...PRODUCT_REF, frame: 'start' as const }]
                  : mask % 2 === 1
                    ? [PERSON_BASE_REF]
                    : mask % 4 === 2
                      ? [PRODUCT_REF]
                      : []
                : mask % 2 === 1
                  ? [{ index: 1, kind: 'video' as const, label: '영상 1' }, { ...PERSON_BASE_REF, index: 2 }]
                  : [{ index: 1, kind: 'video' as const, label: '영상 1' }];
            cases.push(
              makeEnhancerCase(
                `prog-sd-remix-${method}-m${mask}-${v2Flag}-${locale}`,
                {
                  kind: 'video_remix',
                  profile: 'seedance',
                  model: 'seedance-2.5',
                  locale,
                  prompt:
                    locale === 'ko'
                      ? method === 'blueprint'
                        ? '설계도 구도대로 제품과 장면을 새 테이크로'
                        : '영상 1의 병 색상을 코발트 블루로 변경'
                      : method === 'blueprint'
                        ? 'New take following blueprint structure and timing.'
                        : 'Adjust bottle tone while keeping overall motion.',
                  references: refs,
                  brand: null,
                  video: {
                    seconds: 8,
                    aspect: '9:16',
                    audio,
                    method,
                    keep,
                    change: mask <= 1 ? '' : 'Change bottle surface tone to matte cobalt.',
                    sheet: MARKED_SHEET,
                  },
                },
                { BRAND_SEEDANCE_RULES_V2: v2Flag },
              ),
            );
          }
        }
      }
    }

    // 5. Enhancer Seedance revision: ALL STUDIO_REVISE_MODES × v1/v2 × STUDIO_AUDIO_MODES × locales × revision payloads
    const revPayloads = ['plain', 'marks-materials', 'clarified', 'sheet'] as const;
    for (const mode of STUDIO_REVISE_MODES) {
      for (const v2Flag of ['off', 'on'] as const) {
        for (const audio of STUDIO_AUDIO_MODES) {
          for (const payloadKind of revPayloads) {
            for (const locale of locales) {
              const isEdit = mode === 'edit';
              const refs = isEdit
                ? payloadKind === 'clarified'
                  ? [{ index: 1, kind: 'video' as const, label: '영상 1' }, { ...PERSON_BASE_REF, index: 2 }]
                  : [{ index: 1, kind: 'video' as const, label: '영상 1' }]
                : [PERSON_BASE_REF];
              cases.push(
                makeEnhancerCase(
                  `prog-sd-rev-${mode}-${v2Flag}-${audio}-${payloadKind}-${locale}`,
                  {
                    kind: isEdit ? 'video_remix' : 'video',
                    profile: 'seedance',
                    model: 'seedance-2.5',
                    locale,
                    prompt:
                      locale === 'ko'
                        ? '병의 유리 반사를 부드럽게 조정'
                        : 'Soften the glass reflection gently.',
                    references: refs,
                    brand: null,
                    video: {
                      seconds: isEdit ? null : 6,
                      aspect: '9:16',
                      audio,
                      ...(isEdit ? { method: 'edit' as const, keep: [], change: '', sheet: null } : {}),
                    },
                    revision: {
                      mode,
                      version: payloadKind === 'plain' ? 3 : 2,
                      madeWith: 'A glass serum bottle on pale stone.\nAudio: room tone.',
                      history: payloadKind === 'plain' ? [] : ['Dim the top window edge slightly.'],
                      ...(payloadKind === 'marks-materials'
                        ? {
                            marks: [{ n: 1, time: 1.5, what: 'glass shoulder', x: 0.45, y: 0.35 }],
                            materials: [{ n: 1, kind: 'video' as const, notes: 'Calm gentle camera settle.' }],
                          }
                        : {}),
                      ...(payloadKind === 'clarified'
                        ? { clarified: { question: 'Warm or cool tone?', answer: 'Keep pale warm morning stone tone.' } }
                        : {}),
                      ...(payloadKind === 'sheet'
                        ? {
                            sheet: { change: ['Reduce glare on shoulder'], keep: ['Label geometry'], exclude: ['Lens flare'] },
                            seconds: isEdit ? null : 6,
                          }
                        : {}),
                    },
                  },
                  { BRAND_SEEDANCE_RULES_V2: v2Flag },
                ),
              );
            }
          }
        }
      }
    }

    // 6. Director v1 & v2 × intent × audio modes × explicitMusic × ref setups × genres
    const directorAudioModes: readonly DirectorAudioMode[] = ['on', 'sfx', 'off', 'native', 'ambient', 'silent'];
    const directorRefSetups = [
      { id: 'prod-noref', refs: [], kind: 'video' as const, sheet: null as typeof MARKED_SHEET | null, expand: 'Product bottle on stone, no person.', slot: 'A matte ceramic serum bottle rests alone on pale limestone in soft morning room atmosphere without any people around it, product only with no person.' },
      { id: 'prod-ref', refs: [{ ...PRODUCT_REF, label: 'Image 1' }], kind: 'video' as const, sheet: null, expand: 'Image 1 bottle on stone, no person.', slot: 'Place the frosted glass bottle from Image 1 on honed limestone inside a calm daylight room without any people present, product only with no person.' },
      { id: 'person-at-1', refs: [PERSON_BASE_REF], kind: 'video' as const, sheet: null, expand: '이미지 1 인물이 창가를 천천히 걷는 장면', slot: '이미지 1 인물이 아침 햇빛이 비추는 밝은 석재 복도를 천천히 지나가며 창가 선반 옆에서 멈추어 고개를 부드럽게 돌리는 조용한 순간을 차분하게 이어서 담아 준다.' },
      { id: 'garment-person-2', refs: [GARMENT_REF, { ...PERSON_BASE_REF, index: 2 }], kind: 'video' as const, sheet: null, expand: '이미지 2 인물이 이미지 1 코트를 입고 걷는 장면', slot: '이미지 2 인물이 이미지 1 코트를 자연스럽게 걸치고 밝은 실내 복도를 천천히 걸어가다 창가 테이블 옆에서 잠시 멈추어 서는 차분한 장면의 흐름을 그대로 담는다.' },
      { id: 'two-persons', refs: [PERSON_BASE_REF, { ...PERSON_REF, index: 2 }], kind: 'video' as const, sheet: null, expand: '이미지 1과 이미지 2가 창가에서 대화하는 장면', slot: '이미지 1 인물과 이미지 2 인물이 조용한 창가 석재 테이블 앞에 나란히 서서 서로를 바라보며 자연스럽게 미소 짓고 가볍게 손을 움직이는 차분한 오후 장면이다.' },
      { id: 'video-ref', refs: [{ index: 1, kind: 'video' as const, label: '영상 1' }, { ...PERSON_BASE_REF, index: 2 }], kind: 'video_remix' as const, sheet: MARKED_SHEET, expand: '영상 1 움직임을 따르는 이미지 2 장면', slot: '영상 1의 부드러운 움직임과 전체 구도를 그대로 이어받으면서 이미지 2 인물이 창가 선반 옆에서 천천히 고개를 돌리고 조용히 손끝을 움직이는 장면을 만든다.' },
      { id: 'blueprint', refs: [PRODUCT_REF], kind: 'video_remix' as const, method: 'blueprint' as const, sheet: MARKED_SHEET, expand: '설계도대로 이미지 1 병, no person.', slot: '설계도 흐름과 컷 구성을 차분하게 따라가며 이미지 1 유리병의 윤곽과 라벨 비율을 또렷하고 단정하게 보여 주는 제품 단독 구성 product only with no person.' },
    ] as const;

    for (const v2Flag of ['off', 'on'] as const) {
      for (const intent of ['expand', 'slot_fill'] as const) {
        for (const audio of directorAudioModes) {
          for (const rs of directorRefSetups) {
            const promptText = intent === 'expand' ? rs.expand : rs.slot;
            const refs: DirectorCompileInput['references'] = [...rs.refs];
            expect(classifyPromptIntent(promptText, Boolean(rs.sheet || refs.some((r) => r.kind === 'video')), refs.length)).toBe(intent);
            cases.push(
              makeDirectorCase(
                `prog-dir-${v2Flag}-${intent}-${audio}-${rs.id}`,
                {
                  kind: rs.kind,
                  profile: 'seedance',
                  model: 'seedance-2.5',
                  locale: 'ko',
                  prompt: promptText,
                  references: [...rs.refs],
                  brand: null,
                  video: {
                    seconds: 8,
                    aspect: '9:16',
                    audio,
                    ...('method' in rs ? { method: rs.method, keep: ['camera', 'timing'], change: '병 교체' } : rs.kind === 'video_remix' ? { method: 'reference' as const, keep: ['camera', 'timing'], change: '인물 교체' } : {}),
                    ...(rs.sheet ? { sheet: rs.sheet } : {}),
                  },
                },
                { BRAND_SEEDANCE_RULES_V2: v2Flag },
              ),
            );
          }
        }
      }
      // Explicit music & dynamic-action genre coverage
      for (const audio of ['on', 'native', 'ambient'] as const) {
        cases.push(
          makeDirectorCase(
            `prog-dir-music-${v2Flag}-${audio}`,
            {
              kind: 'video',
              profile: 'seedance',
              model: 'seedance-2.5',
              locale: 'en',
              prompt: 'A singer performing an acoustic guitar song beside tall sunlit windows.',
              references: [],
              brand: null,
              video: { seconds: 8, aspect: '9:16', audio },
            },
            { BRAND_SEEDANCE_RULES_V2: v2Flag },
          ),
        );
      }
      if (v2Flag === 'on') {
        cases.push(
          makeDirectorCase(
            'prog-dir-v2-dynamic-genre',
            {
              kind: 'video',
              profile: 'seedance',
              model: 'seedance-2.5',
              locale: 'en',
              prompt: 'An athlete sprinting through rain during an intense neon alley chase.',
              references: [PERSON_BASE_REF],
              brand: null,
              video: { seconds: 8, aspect: '9:16', audio: 'on' },
            },
            { BRAND_SEEDANCE_RULES_V2: 'on' },
          ),
        );
      }
    }

    expect(cases.length).toBeGreaterThanOrEqual(1000);

    const coveredLocators = new Set<string>();
    const coveredModels = new Set<string>();
    const coveredKeepMasks = new Set<number>();
    for (const c of cases) {
      coveredModels.add(c.input.model ?? '');
      if (c.input.kind === 'video_remix' && c.input.video?.keep) {
        let m = 0;
        STUDIO_KEEP_KEYS.forEach((k, bit) => {
          if (c.input.video?.keep?.includes(k)) m |= 1 << bit;
        });
        coveredKeepMasks.add(m);
      }

      let guardedSystem = '';
      if (c.markup) {
        const inp = c.input as EnhanceInput;
        const binding = bindReferences(inp);
        const rawSystem = buildSystemInstruction(inp, binding, null, [], {
          skinVariant: skinVariantOf(inp.model, c.env),
          markup: true,
          shotsInUserTurn: true,
          env: c.env,
        });
        const g = guardRequest({
          site: 'brand-studio.enhancer',
          env: { PROMPT_GUARD: 'enforce', ...c.env },
          internal: rawSystem,
        });
        guardedSystem = g.system;
        const active = activeRegistryPhrasesFor(c, guardedSystem).map((p) => instantiatePlaceholders(p, c.input));
        const { allow } = buildAllowForCase(c, guardedSystem);
        const res = g.check({ prompt: c.buildAnswer(active.join('; ')), notes: c.notes }, { allow });
        expect(res.blocked, `${c.id} markup enforce check`).toEqual([]);
      } else {
        logs = [];
        const run = await runConfig(c, 'enforce', (sys) => {
          const active = activeRegistryPhrasesFor(c, sys).map((p) => instantiatePlaceholders(p, c.input));
          return { prompt: c.buildAnswer(active.join('; ')), notes: c.notes };
        });
        guardedSystem = run.system;
        expect(run.result.source, `${c.id} enforce (${run.fallbackReason ?? 'ok'})`).toBe('model');
        expect(logs, `${c.id} enforce zero guard logs`).toEqual([]);
      }

      const { allow, fallbackText } = buildAllowForCase(c, guardedSystem);
      const postAnswerLines = postAnswerAppendedLinesForConfig(c);
      const activeRegistryPhrases = activeRegistryPhrasesFor(c, guardedSystem);
      const dictatedList = dictatedSpans(guardedSystem);
      const generatedList = generatedAllowInstancesForConfig(c, guardedSystem, postAnswerLines);

      assertStrictAllowGrounded({
        c,
        guardedSystem,
        allow,
        fallbackText,
        activeRegistryPhrases,
        generatedList,
        dictatedList,
      });

      const props: ConfigProperties = { site: c.site, env: c.env, input: c.input };
      const applicableLocators = BEHAVIOUR_LOCATORS.filter((l) => l.site === c.site && l.appliesTo(props));
      expect(applicableLocators.length, `${c.id}: >=4 locators`).toBeGreaterThanOrEqual(4);
      const allowCorpus = new Corpus(allow);
      const matchedBehaviourSentences: string[] = [];
      for (const loc of applicableLocators) {
        coveredLocators.add(loc.id);
        const sentence = locateBehaviourSentence(guardedSystem, loc);
        matchedBehaviourSentences.push(sentence);
        expect(unitsOf(sentence, allowCorpus).masked.filter(Boolean), `${c.id} (${loc.id}) 0 masked words`).toEqual([]);
      }

      assertSentenceAndOverlapHygiene({
        c,
        guardedSystem,
        fallbackText,
        postAnswerLines,
        activeRegistryPhrases,
        generatedList,
        dictatedList,
        applicableLocators,
        matchedBehaviourSentences,
      });
    }

    for (const m of STUDIO_MODELS) {
      expect(coveredModels.has(m.id), `STUDIO_MODELS member ${m.id} must be covered`).toBe(true);
    }
    expect(coveredKeepMasks.size, 'all 32 keep subsets must be covered').toBe(32);
    expect(BEHAVIOUR_LOCATORS.filter((l) => !coveredLocators.has(l.id))).toEqual([]);

    const unseenSharedCore = SHARED_ENHANCER_CORE_SENTENCE_LOCATORS.filter(
      (l) => !seenSharedCoreSentenceKeys.has(`${l.first5Words}|${l.length}`),
    );
    expect(unseenSharedCore, 'every shared enhancer core reviewed sentence locator must occur across MATRIX + programmatic configs').toEqual([]);
    const unseenByFamily: Record<string, typeof REVIEWED_SENTENCE_LOCATORS[keyof typeof REVIEWED_SENTENCE_LOCATORS]> = {};
    for (const [family, locators] of Object.entries(REVIEWED_SENTENCE_LOCATORS)) {
      const seen = seenFamilySentenceKeys.get(family) ?? new Set<string>();
      const unseen = locators.filter((l) => !seen.has(`${l.first5Words}|${l.length}`));
      if (unseen.length > 0) unseenByFamily[family] = unseen;
    }
    expect(unseenByFamily, 'every reviewed sentence locator per family must occur across MATRIX + programmatic configs').toEqual({});
    // 1,206 configurations: about 2 minutes on a CI runner (122 s measured on 2026-11-27, where 90 s timed out).
  }, 360_000);
});
