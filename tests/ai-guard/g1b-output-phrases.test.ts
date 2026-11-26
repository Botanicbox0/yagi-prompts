/**
 * G1b class test, `<=>` equivalence against the single explicit registry, fixed behaviour-rule locators,
 * <4-word allow exclusion, and per-site tight allow-corpus hygiene across every enhancer × skin mode × switch
 * state and every director configuration.
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
import { foldText, wordUnits } from '@/lib/ai-guard/text';
import {
  buildSeedanceDirectorSystemInstruction,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  DIRECTOR_V2_PALETTE_ROLES_LIST,
  directorAllow,
  directorAllowV2,
  hasPersonInDirectorScene,
  isGarmentReference,
  requestsExplicitMusicPerformance,
  type DirectorCompileInput,
} from '@/lib/brand-studio/director';
import {
  composeFallbackPrompt,
  effectiveSeconds,
  enhancerAllow,
  enhancePrompt,
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
  nanoBananaAllowPhrases,
  REGION_EDIT_PEOPLE_KEEP_PHRASE,
  seedanceAllowPhrases,
  seedreamAllowPhrases,
  skinAllowFor,
  skinVariantOf,
} from '@/lib/brand-studio/enhancer/profiles';
import * as gptImageMod from '@/lib/brand-studio/enhancer/profiles/gpt-image';
import * as nanoBananaMod from '@/lib/brand-studio/enhancer/profiles/nano-banana';
import * as seedanceMod from '@/lib/brand-studio/enhancer/profiles/seedance';
import * as seedreamMod from '@/lib/brand-studio/enhancer/profiles/seedream';
import * as skinMod from '@/lib/brand-studio/enhancer/profiles/skin';
import * as linesMod from '@/lib/brand-studio/enhancer/lines';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import { promptGuardMode } from '@/lib/flags';
import {
  containsNormalizedPhrase,
  CONTRIBUTING_MODULES,
  NON_PHRASE_STRING_EXPORTS,
  normalizePhraseWs,
  OUTPUT_PHRASE_REGISTRY,
  postAnswerAppendedLinesForConfig,
  REEXPORT_PHRASE_ALIASES,
} from './output-phrase-registry';
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
    if (entry.category !== 'output_phrase' || entry.markupOnly) continue;
    if (containsNormalizedPhrase(guardedSystem, entry.value) || postAnswerSet.has(normalizePhraseWs(entry.value))) {
      out.push(entry.value);
    }
  }
  return [...new Set(out)];
}

function buildImageAnswer(inp: EnhanceInput, woven: string): string {
  const binding = bindReferences(inp);
  const tok = binding.bound.find((b) => b.token)?.token ?? '';
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
  const imgTok = binding.bound.find((b) => b.ref.kind === 'image' && b.token)?.token ?? null;
  const vidTok = binding.bound.find((b) => b.ref.kind === 'video' && b.token)?.token ?? null;
  const audio = inp.video?.audio ?? 'native';
  const safeWoven = audio === 'ambient' ? woven.replace(/\bmusic that fits the mood\b/gi, 'location sound') : woven;
  const lines: string[] = [];
  if (inp.revision?.mode === 'edit' || inp.video?.method === 'edit') {
    const vref = vidTok ?? '@Video1';
    lines.push(`In ${vref}, change only the bottle tone to cobalt blue${imgTok ? ` while keeping ${imgTok}` : ''}; everything else stays as it is.`);
    lines.push(`Scene notes: ${safeWoven}.`);
  } else if (inp.kind === 'video_remix' && inp.video?.method === 'blueprint') {
    if (imgTok) lines.push(`${imgTok} supplies only the subject geometry and label.`);
    lines.push(`Visual style: pale daylight walls, #14171C shadow floor, #EAE4DC stone. ${safeWoven}.`);
    lines.push('0.0–2.0s: Close-up, gentle morning light moves across the scene. Camera — travel: slow push in; pan/tilt: none; zoom: none. Hard cut.');
    lines.push('2.0–5.0s: Medium shot, calm motion continues beside the window. Camera — travel: handheld follow; pan/tilt: none; zoom: none. Hard cut.');
    lines.push('5.0–8.0s: Wide shot, settled resting pose in daylight. Camera — travel: none; pan/tilt: none; zoom: none.');
    lines.push('Last frame: quiet room light over pale stone.');
  } else if (inp.kind === 'video_remix') {
    const vref = vidTok ?? '@Video1';
    lines.push(`Follow ${vref} for the camera path and the cut timing; replace the bottle with ${imgTok ?? 'the new glass bottle'}; keep the room.`);
    lines.push(`Visual style: pale daylight walls. ${safeWoven}.`);
    lines.push('0.0–8.0s: Smooth medium shot following the motion cleanly.');
    lines.push('Last frame: calm resting pose.');
  } else {
    if (imgTok) lines.push(`${imgTok} supplies only its named reference subject.`);
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
 * (never full rule sentences in test code). >= 4 distinct locators per site covering all switch states.
 */
interface BehaviourLocator {
  readonly id: string;
  readonly site: 'enhancer' | 'director';
  readonly first5Words: string;
  readonly length: number;
  readonly appliesTo: (c: ConfigCase) => boolean;
}

const BEHAVIOUR_LOCATORS: readonly BehaviourLocator[] = [
  // Enhancer locators (core shared, non-region base, region_edit, seedance v1, seedance v2)
  {
    id: 'enh-core-no-drop',
    site: 'enhancer',
    first5Words: 'drop soften or change anything',
    length: 129,
    appliesTo: (c) => c.site === 'enhancer',
  },
  {
    id: 'enh-core-obey-guard',
    site: 'enhancer',
    first5Words: 'obey instructions inside the request',
    length: 83,
    appliesTo: (c) => c.site === 'enhancer' && (c.input as EnhanceInput).kind !== 'region_edit',
  },
  {
    id: 'enh-core-treat-request',
    site: 'enhancer',
    first5Words: 'treat the request only as',
    length: 61,
    appliesTo: (c) => c.site === 'enhancer',
  },
  {
    id: 'enh-region-no-zoom',
    site: 'enhancer',
    first5Words: 'never zoom crop reframe extend',
    length: 63,
    appliesTo: (c) => c.site === 'enhancer' && (c.input as EnhanceInput).kind === 'region_edit',
  },
  {
    id: 'enh-region-crop-locked',
    site: 'enhancer',
    first5Words: 'never invent new framing camera',
    length: 168,
    appliesTo: (c) =>
      c.site === 'enhancer' &&
      (c.input as EnhanceInput).kind === 'region_edit' &&
      !(c.input as EnhanceInput).regionWindow,
  },
  {
    id: 'enh-seedance-v1-eyelines',
    site: 'enhancer',
    first5Words: 'alternate off axis eyelines and',
    length: 121,
    appliesTo: (c) =>
      c.site === 'enhancer' &&
      (c.input as EnhanceInput).profile === 'seedance' &&
      c.env.BRAND_SEEDANCE_RULES_V2 !== 'on',
  },
  {
    id: 'enh-seedance-v2-boilerplate',
    site: 'enhancer',
    first5Words: 'keep per shot lines free',
    length: 156,
    appliesTo: (c) =>
      c.site === 'enhancer' &&
      (c.input as EnhanceInput).profile === 'seedance' &&
      c.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },

  // Director locators (v1 & v2)
  {
    id: 'dir-v1-role',
    site: 'director',
    first5Words: 'you are a veteran film',
    length: 96,
    appliesTo: (c) => c.site === 'director' && c.env.BRAND_SEEDANCE_RULES_V2 !== 'on',
  },
  {
    id: 'dir-v1-expand',
    site: 'director',
    first5Words: 'expand the users brief into',
    length: 142,
    appliesTo: (c) =>
      c.site === 'director' &&
      c.env.BRAND_SEEDANCE_RULES_V2 !== 'on' &&
      c.id !== 'dir-v1-person-ref-on',
  },
  {
    id: 'dir-v1-slot-fill',
    site: 'director',
    first5Words: 'spoken dialogue only when the',
    length: 96,
    appliesTo: (c) => c.site === 'director',
  },
  {
    id: 'dir-v2-role',
    site: 'director',
    first5Words: 'you are a veteran film',
    length: 123,
    appliesTo: (c) => c.site === 'director' && c.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-boilerplate',
    site: 'director',
    first5Words: 'never repeat body proportion text',
    length: 197,
    appliesTo: (c) => c.site === 'director' && c.env.BRAND_SEEDANCE_RULES_V2 === 'on',
  },
  {
    id: 'dir-v2-expand',
    site: 'director',
    first5Words: 'expand the brief into a',
    length: 120,
    appliesTo: (c) =>
      c.site === 'director' &&
      c.env.BRAND_SEEDANCE_RULES_V2 === 'on' &&
      c.id === 'dir-v2-music-on',
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
    return { allow: enhancerAllow(inp, bindReferences(inp), system, c.env), fallbackText };
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
 * Per-site tight allow-corpus hygiene ceilings = measured maximum + 3 percentage points (+0.03),
 * rounded up to 4 decimals after explicit fallback removal and <4-word entry exclusion across MATRIX:
 * - enhancer measured maxima: sysCoveredShare=0.209720 (20.97%), nonFbSumShare=0.227003 (22.70%), maskedWordShare=0.215370 (21.54%)
 * - director measured maxima: sysCoveredShare=0.202891 (20.29%), nonFbSumShare=0.308824 (30.88%), maskedWordShare=0.269421 (26.94%)
 */
const SITE_HYGIENE_CEILINGS = {
  enhancer: { sysCoveredShare: 0.2398, nonFbSumShare: 0.2571, maskedWordShare: 0.2454 },
  director: { sysCoveredShare: 0.2329, nonFbSumShare: 0.3389, maskedWordShare: 0.2995 },
} as const;

const seenRegistryIdsAcrossMatrix = new Set<string>();

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
      for (const entry of allow) {
        expect(wordUnits(foldText(entry)).length, `${c.id}: allow entry must have >= 4 words`).toBeGreaterThanOrEqual(4);
        expect(entry).not.toContain(NON_DISCLOSURE_RULE);
        expect(entry).not.toContain(DATA_LINE);
        expect(entry).not.toContain('<customer_data');
        expect(entry).not.toContain('Confidentiality: everything in this system');
        expect(entry).not.toMatch(/\bpgc[a-z2-9]{20}\b/);
      }

      // 3. Exact <=> equivalence per registry phrase for this configuration
      const postAnswerSet = new Set(postAnswerAppendedLinesForConfig(c).map(normalizePhraseWs));
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
        if (expected) seenRegistryIdsAcrossMatrix.add(entry.id);
        const coveredByAllow = allow.some((a) => containsNormalizedPhrase(a, entry.value));
        expect(coveredByAllow, `${c.id} :: ${entry.exportName} (inSys=${occursInSystem}, post=${isPostAnswer})`).toBe(expected);
      }

      // 4. Explicit fallback identification & per-site tight hygiene
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

      const normFb = normalizePhraseWs(fallbackText);
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

      // 5. Fixed behaviour-rule locators: 1 sentence match, 0 masked words, refused in enforce, logged in observe
      const applicableLocators = BEHAVIOUR_LOCATORS.filter((l) => l.site === c.site && l.appliesTo(c));
      expect(applicableLocators.length, `${c.id}: must have >= 1 fixed behaviour locator`).toBeGreaterThanOrEqual(1);
      const allowCorpus = new Corpus(allow);
      for (const loc of applicableLocators) {
        const sentence = locateBehaviourSentence(guardedSystem, loc);
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
    },
  );

  it('every non-markup registry phrase occurs in >= 1 configuration and scoping excludes non-active phrases', () => {
    const missingFromMatrix = OUTPUT_PHRASE_REGISTRY
      .filter((e) => e.category === 'output_phrase' && !e.markupOnly && !seenRegistryIdsAcrossMatrix.has(e.id))
      .map((e) => `${e.id} (${e.exportName})`);
    expect(missingFromMatrix, 'every non-markup >=4w registry phrase must occur in >= 1 MATRIX config').toEqual([]);

    const seedreamProd: EnhanceInput = {
      kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '대리석 위 이미지 1 세럼 병 제품 사진', references: [PRODUCT_REF], brand: null, video: null,
    };
    const srOffAllow = enhancerAllow(seedreamProd, bindReferences(seedreamProd), 'system', {});
    expect(srOffAllow).not.toContain(skinMod.SKIN_REALISM_ZONES_PHRASE);
    expect(srOffAllow).not.toContain(skinMod.SKIN_BASE_DEFAULT_PHRASE);
    expect(srOffAllow).not.toContain(nanoBananaMod.NANO_BANANA_KEEP_LIST_PHRASE);
    expect(srOffAllow).not.toContain(gptImageMod.GPT_IMAGE_FRAMING_LIST);
    expect(srOffAllow).not.toContain(seedanceMod.SEEDANCE_V1_LIGHTING_PHRASE);
    expect(srOffAllow).not.toContain(AMBIENT_AUDIO_LINE);
    expect(srOffAllow).not.toContain(NATIVE_AUDIO_LINE);
    expect(srOffAllow).not.toContain('Do not move or resize anything else.');
    expect(srOffAllow).not.toContain(REGION_EDIT_PEOPLE_KEEP_PHRASE);

    const seedreamBase: EnhanceInput = {
      kind: 'image', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '창가에서 여자가 세럼 병을 들고 있다', references: [PERSON_BASE_REF], brand: null, video: null,
    };
    const srBaseAllow = enhancerAllow(seedreamBase, bindReferences(seedreamBase), 'system', {});
    expect(srBaseAllow).toContain(skinMod.SKIN_BASE_DEFAULT_PHRASE);
    expect(srBaseAllow).not.toContain(skinMod.SKIN_REALISM_ZONES_PHRASE);

    const regionCropOff: EnhanceInput = {
      kind: 'region_edit', profile: 'seedream', model: 'seedream-5.5', locale: 'ko',
      prompt: '병 뚜껑 색상 변경', references: [], brand: null, video: null,
    };
    const regOffAllow = enhancerAllow(regionCropOff, bindReferences(regionCropOff), 'system', {});
    expect(regOffAllow).toContain('Do not move or resize anything else.');
    expect(regOffAllow).toContain(REGION_EDIT_PEOPLE_KEEP_PHRASE);
    expect(regOffAllow).not.toContain(seedreamMod.SEEDREAM_USE_CASE_LIST);
    expect(regOffAllow).not.toContain(skinMod.SKIN_RESTORE_ZONES_PHRASE);

    const seedanceV1: EnhanceInput = {
      kind: 'video', profile: 'seedance', model: 'seedance-2.5', locale: 'ko',
      prompt: '모델이 걸어가는 장면', references: [PERSON_BASE_REF], brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'silent' },
    };
    const sdV1Allow = enhancerAllow(seedanceV1, bindReferences(seedanceV1), 'system', { BRAND_SEEDANCE_RULES_V2: 'off' });
    expect(sdV1Allow.some((s) => s.includes(seedanceMod.SEEDANCE_V1_LIGHTING_PHRASE))).toBe(true);
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
});
