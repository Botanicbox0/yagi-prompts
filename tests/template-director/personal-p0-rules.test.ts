import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKIN_MATTE_CONTRACT_A10 } from '@/lib/brands/briefs/compiler';
import {
  ANATOMICAL_DE_FILTER_CONTRACT,
  applyDeterministicDirectorSpec,
  auditPersonalPrompt,
  compileDirectorPrompt,
  compileDirectorPromptDetailed,
  compileModelSpecificIdentityPrompt,
  createFlashTemplateDirector,
  DEFAULT_SUBJECT_DESCRIPTOR_EN,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  MORPHIC_MODIFICATION_PLAYBOOK,
  PERSONAL_SKIN_CONTRACT_COUPLE_EN,
  PERSONAL_SKIN_CONTRACT_EN,
  rawOpticalIdentityMasterSchema,
  rawPhotoInspectionSchema,
  routePhotoCleanup,
  runHeuristicDirectorTurn,
  sanitizeRewrittenPrompt,
  sanitizeSubjectDescriptorEn,
  unwrapServerOnlyPrompt,
  USER_CUSTOMIZATION_HEADER_EN,
  verifyRewrittenPrompt,
  type DirectorRewriteInput,
  type ModelSpecificImageEngine,
} from '@/lib/template-director';

/**
 * docs/PERSONAL-STUDIO.md §4 — the six compiler rules fixed before any new personal-studio work (P0).
 * Every test here failed on origin/main dfa5296a.
 */

const BASE = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity and hairstyle.

Timeline:
[Shot 1 - Sidewalk Arrival, 0.0-3.5s]:
- @Image 1 steps onto the curb in three-quarter profile. Hard cut.
[Shot 2 - Stair Ascent, 3.5-11.0s, single unbroken take]:
- @Image 1 walks up the stone entrance stairs in one continuous take.

[Exclusions]
No watermarks.`;

const CONFIG = {
  apiKey: 'fake-gemini-key',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: GEMINI_DIRECTOR_DEFAULT_MODEL,
};

function geminiJson(payload: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const GOOD_REWRITE = {
  rewrittenPrompt: `${BASE}\n\nWardrobe: a black leather jacket in every shot.`,
  preservedCameraAndLighting: true,
  preservedAudioRule: true,
  preservedIdentityStrictLock: true,
};

function stage2Body(fetchMock: { mock: { calls: unknown[][] } }, call = 0): {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ parts: Array<{ text: string }> }>;
} {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P0-1 personal skin contract replaces the brand a10 contract', () => {
  it('appends the personal contract, never "visible pores", for a person', () => {
    const out = sanitizeRewrittenPrompt(BASE, true);
    expect(out).toContain(PERSONAL_SKIN_CONTRACT_EN);
    expect(out).not.toMatch(/visible pores/i);
    expect(out).not.toContain(SKIN_MATTE_CONTRACT_A10);
  });

  it('removes an a10 contract already stored in an older prompt and appends the personal one once', () => {
    const out = sanitizeRewrittenPrompt(`${BASE}\n\n${SKIN_MATTE_CONTRACT_A10}`, true);
    expect(out).not.toContain('Natural matte skin texture with visible pores');
    expect(out).not.toMatch(/visible pores/i);
    expect(out.split(PERSONAL_SKIN_CONTRACT_EN)).toHaveLength(2);
    // Idempotent: a second pass does not stack a second contract.
    const twice = sanitizeRewrittenPrompt(out, true);
    expect(twice.split(PERSONAL_SKIN_CONTRACT_EN)).toHaveLength(2);
  });

  it('rewrites stray "visible pores" wording and never outputs "porcelain"', () => {
    const out = sanitizeRewrittenPrompt(
      `${BASE}\nReal skin at pore level: visible pores across the cheeks, fair porcelain skin, Porcelain glow.`,
      true,
    );
    expect(out).not.toMatch(/visible pores/i);
    expect(out).not.toMatch(/porcelain/i);
    expect(verifyRewrittenPrompt(out).ok).toBe(true);
  });

  it('uses the two-person variant for a couple and no skin contract for a pet', () => {
    const couple = sanitizeRewrittenPrompt(BASE, true, 'couple');
    expect(couple).toContain(PERSONAL_SKIN_CONTRACT_COUPLE_EN);
    expect(couple).not.toContain(PERSONAL_SKIN_CONTRACT_EN);

    const pet = sanitizeRewrittenPrompt('A dog runs along the beach at dawn chasing a red ball.', false, 'pet');
    expect(pet).not.toContain(PERSONAL_SKIN_CONTRACT_EN);
    expect(pet).not.toMatch(/skin texture/i);
  });

  it('applyDeterministicDirectorSpec uses the personal contract for images too', () => {
    const image = applyDeterministicDirectorSpec({
      basePrompt: 'A portrait of @Image 1 at a night market.',
      medium: 'image',
      directorSpec: { userMessage: '블랙 가죽 자켓', audioMode: 'ambient' },
    });
    expect(image).toContain(PERSONAL_SKIN_CONTRACT_EN);
    expect(image).not.toMatch(/visible pores/i);

    const petImage = applyDeterministicDirectorSpec({
      basePrompt: 'A dog portrait on a sofa.',
      medium: 'image',
      cast: 'pet',
      directorSpec: { userMessage: '빨간 목줄', audioMode: 'ambient' },
    });
    expect(petImage).not.toContain(PERSONAL_SKIN_CONTRACT_EN);
  });

  it('Stage-2 doctrine item 6 carries the personal contract and forbids adding pores or blemishes', async () => {
    const fetchMock = vi.fn(async () => geminiJson(GOOD_REWRITE));
    const director = createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    await director.rewritePrompt({
      basePrompt: BASE,
      structuredIntent: { hairOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
      referenceSlots: [{ index: 1, slotName: 'selfie', role: 'person' }],
    });
    const doctrine = stage2Body(fetchMock).systemInstruction.parts[0]!.text;
    expect(doctrine).toContain(PERSONAL_SKIN_CONTRACT_EN);
    expect(doctrine).toContain('never add pores, freckles, moles, blemishes or aging texture that are not in the photo');
    expect(doctrine).not.toMatch(/visible pores/i);
  });
});

describe('P0-2 shot boundaries keep the edit the template wrote', () => {
  it('doctrine item 5 no longer forces hard cuts', async () => {
    const fetchMock = vi.fn(async () => geminiJson(GOOD_REWRITE));
    const director = createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    await director.rewritePrompt({
      basePrompt: BASE,
      structuredIntent: { hairOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
      referenceSlots: [{ index: 1, slotName: 'selfie', role: 'person' }],
    });
    const doctrine = stage2Body(fetchMock).systemInstruction.parts[0]!.text;
    expect(doctrine).not.toContain('instantaneous editorial hard cut');
    expect(doctrine).toContain(
      "Preserve every shot boundary's edit exactly as written in basePrompt (hard cut, match cut, continuous take, camera move); never turn a continuous take into cuts and never add cuts.",
    );
    // The rest of item 5 stays.
    expect(doctrine).toContain('5. Candid Micro-Acting & Lower-Face Lock: Keep lip motion calm and understated');
  });
});

describe('P0-3 no assumed gender or ethnicity in identity prompts', () => {
  const engines: ModelSpecificImageEngine[] = ['seedream-5.5', 'nano-banana-2.1', 'gpt-image-2.5-sunburst'];
  const spec = {
    extractedIdentityLockEn: 'almond eyes and a straight nose bridge',
    extractedHairLockEn: 'short black hair with a side part',
    rawSurgicalPromptEn: 'remove the earphone cord',
  };

  it('defaults to "the person" and they/their in every engine branch', () => {
    for (const engine of engines) {
      const prompt = compileModelSpecificIdentityPrompt(engine, spec);
      expect(prompt, engine).not.toMatch(/\b(?:korean|female|woman|she|her|youthful)\b/i);
      expect(prompt, engine).toContain('the person');
    }
    const seedream = compileModelSpecificIdentityPrompt('seedream-5.5', spec);
    expect(seedream).toContain("Reference Image 1 provides the subject's exact facial identity");
    expect(seedream).toContain('the exact same person from Reference Image 1');
    expect(seedream).toContain('so they remain unmistakably the same person');
    expect(seedream).toContain('keeping their original hairstyle');
  });

  it('uses the photo-check descriptor in all three branches', () => {
    for (const engine of engines) {
      const prompt = compileModelSpecificIdentityPrompt(engine, { ...spec, subjectDescriptorEn: 'a man in his thirties' });
      expect(prompt, engine).toContain('a man in his thirties');
    }
  });

  it('sanitizes the descriptor and falls back to "the person"', () => {
    expect(DEFAULT_SUBJECT_DESCRIPTOR_EN).toBe('the person');
    expect(sanitizeSubjectDescriptorEn('a man in his thirties')).toBe('a man in his thirties');
    expect(sanitizeSubjectDescriptorEn("a woman in her 40s, smiling")).toBe('a woman in her 40s smiling');
    expect(sanitizeSubjectDescriptorEn('a young Korean woman')).toBe('the person');
    expect(sanitizeSubjectDescriptorEn('an East Asian man')).toBe('the person');
    expect(sanitizeSubjectDescriptorEn('  ')).toBe('the person');
    expect(sanitizeSubjectDescriptorEn('한국 여성')).toBe('the person');
    expect(sanitizeSubjectDescriptorEn(null)).toBe('the person');
    expect(sanitizeSubjectDescriptorEn('x'.repeat(61))).toBe('the person');
    const injected = compileModelSpecificIdentityPrompt('seedream-5.5', { ...spec, subjectDescriptorEn: 'a Korean woman' });
    expect(injected).not.toMatch(/korean/i);
  });

  it('the anatomical de-filter contract names no ethnicity, youth or face shape', () => {
    expect(ANATOMICAL_DE_FILTER_CONTRACT).not.toMatch(/korean|youthful|oval-egg/i);
    expect(ANATOMICAL_DE_FILTER_CONTRACT).toContain('the skin tone and luminance of Image 1');
    expect(ANATOMICAL_DE_FILTER_CONTRACT).toContain('their natural facial contour');
    expect(ANATOMICAL_DE_FILTER_CONTRACT).toContain('SURGICAL IN-PLACE IDENTITY LOCK');
    expect(ANATOMICAL_DE_FILTER_CONTRACT).toContain('normalizing any 2D beauty-app liquify distortions');
  });

  it('both raw schemas accept an optional descriptor with a safe default', () => {
    const inspection = {
      status: 'ready',
      issues: [],
      faceWidthRatio: 0.35,
      extractedHairDescription: null,
      userMessageKo: '좋은 사진이에요.',
      userMessageEn: 'Looks good.',
      cleanupPromptEn: null,
    };
    expect(rawPhotoInspectionSchema.parse(inspection).subjectDescriptorEn).toBe('the person');
    expect(rawPhotoInspectionSchema.parse({ ...inspection, subjectDescriptorEn: 'a man in his thirties' }).subjectDescriptorEn).toBe(
      'a man in his thirties',
    );
    expect(rawPhotoInspectionSchema.parse({ ...inspection, subjectDescriptorEn: 'y'.repeat(80) }).subjectDescriptorEn).toBe('the person');

    const master = {
      styleAnchorIndex: 0,
      structureAnchorIndex: 0,
      detectedIssues: [],
      requiresMasterSynthesis: false,
      extractedIdentityLockEn: 'almond eyes and a straight nose',
      extractedHairLockEn: 'short black hair with a side part',
      opticalMasterPromptEn: 'Passthrough crop of photo_01.',
    };
    expect(rawOpticalIdentityMasterSchema.parse(master).subjectDescriptorEn).toBe('the person');
    expect(rawOpticalIdentityMasterSchema.parse({ ...master, subjectDescriptorEn: 'an older man' }).subjectDescriptorEn).toBe('an older man');
  });

  it('routePhotoCleanup threads the descriptor into both candidate prompts', () => {
    const route = routePhotoCleanup(['hand_occlusion'], null, null, 'a woman in her forties');
    expect(route.candidatePromptsEn?.['seedream-5.5']).toContain('a woman in her forties');
    expect(route.candidatePromptsEn?.['nano-banana-2.1']).toContain('a woman in her forties');
    const fallback = routePhotoCleanup(['hand_occlusion'], null, null);
    expect(fallback.candidatePromptsEn?.['seedream-5.5']).toContain('the person');
  });

  it('inspectPhoto asks for the descriptor without guessing ethnicity and uses it', async () => {
    const fetchMock = vi.fn(async () =>
      geminiJson({
        status: 'needs_cleanup',
        issues: ['hand_occlusion'],
        faceWidthRatio: 0.36,
        extractedHairDescription: 'short black hair with a side part',
        subjectDescriptorEn: 'a man in his thirties',
        userMessageKo: '손이 얼굴 옆에 있어요.',
        userMessageEn: 'A hand is next to the face.',
        cleanupPromptEn: null,
      }),
    );
    const director = createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    const verdict = await director.inspectPhoto({
      photo: { bytes: new Uint8Array([255, 216, 255]), mime: 'image/jpeg' },
      width: 1500,
      height: 2000,
      role: 'person',
    });
    const system = stage2Body(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toContain('subjectDescriptorEn');
    expect(system).toContain('never guess ethnicity or nationality');
    expect(verdict.recommendedCleanup.candidatePromptsEn?.['seedream-5.5']).toContain('a man in his thirties');
  });

  it('synthesizeOpticalIdentityMaster asks for the descriptor and uses it', async () => {
    const fetchMock = vi.fn(async () =>
      geminiJson({
        strategy: 'surgical_inplace_edit',
        styleAnchorIndex: 0,
        structureAnchorIndex: 0,
        detectedIssues: ['prop_occlusion'],
        requiresMasterSynthesis: true,
        subjectDescriptorEn: 'a man in his thirties',
        extractedIdentityLockEn: 'almond eyes and a straight nose bridge',
        extractedHairLockEn: 'short black hair with a side part',
        opticalMasterPromptEn: 'Remove the paper cup from the frame.',
      }),
    );
    const director = createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    const plan = await director.synthesizeOpticalIdentityMaster({
      photos: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }],
      creatorNoteKo: '컵만 지워 주세요',
    });
    const system = stage2Body(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toContain('subjectDescriptorEn');
    expect(system).toContain('never guess ethnicity or nationality');
    expect(system).not.toMatch(/korean/i);
    expect(unwrapServerOnlyPrompt(plan.opticalMasterPromptEn)).toContain('a man in his thirties');
    expect(unwrapServerOnlyPrompt(plan.fallbackMasterPromptEn)).toContain('a man in his thirties');
  });

  it('the slender-arm compiler rule no longer says "actress"', () => {
    const rule = MORPHIC_MODIFICATION_PLAYBOOK.find((p) => p.id === 'silhouette_slim_arm_lock')!;
    expect(rule.compilerRuleEn).not.toMatch(/actress/i);
    expect(rule.compilerRuleEn).toContain('graceful physique');
  });
});

describe('P0-4 the compile path is reported, retried once, and keeps the user note out of shot 1', () => {
  const NOTE = '모든 컷에서 스카프 빼고 블랙 가죽 자켓 입혀줘';
  const input = {
    basePrompt: BASE,
    medium: 'video' as const,
    directorSpec: { userMessage: NOTE, audioMode: 'ambient' as const },
  };

  it('reports unchanged and deterministic paths', async () => {
    const unchanged = await compileDirectorPromptDetailed({ basePrompt: BASE, medium: 'video' }, { env: {} });
    expect(unchanged).toEqual({ prompt: BASE, path: 'unchanged' });

    const noKey = await compileDirectorPromptDetailed(input, { env: {} });
    expect(noKey.path).toBe('deterministic');

    const fetchMock = vi.fn();
    const image = await compileDirectorPromptDetailed(
      { ...input, medium: 'image' },
      { env: { GEMINI_API_KEY: 'k' }, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(image.path).toBe('deterministic');
    expect(fetchMock).not.toHaveBeenCalled();

    // compileDirectorPrompt keeps its string signature.
    await expect(compileDirectorPrompt(input, { env: {} })).resolves.toBe(noKey.prompt);
  });

  it('sends the raw note as userNoteRaw, not as an invented shot 1 edit', async () => {
    const fetchMock = vi.fn(async () => geminiJson(GOOD_REWRITE));
    const result = await compileDirectorPromptDetailed(input, {
      env: { GEMINI_API_KEY: 'k' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.path).toBe('rewrite');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = stage2Body(fetchMock);
    const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as {
      userNoteRaw: string | null;
      structuredIntent: DirectorRewriteInput['structuredIntent'];
    };
    expect(payload.userNoteRaw).toBe(NOTE);
    expect(payload.structuredIntent.shotEdits).toEqual([]);
    const doctrine = body.systemInstruction.parts[0]!.text;
    expect(doctrine).toContain('may be in Korean or another language');
    expect(doctrine).toContain('[Exclusions]');
    expect(doctrine).toMatch(/never copy (?:their |the note's )?non-English text into the prompt/i);
  });

  it('retries once, then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('busy', { status: 503 }) : geminiJson(GOOD_REWRITE);
    });
    const result = await compileDirectorPromptDetailed(input, {
      env: { GEMINI_API_KEY: 'k' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.path).toBe('rewrite');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('after two failures falls back, reports it, and logs one line without the prompt or the note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('down', { status: 500 }));
    const result = await compileDirectorPromptDetailed(input, {
      env: { GEMINI_API_KEY: 'k' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.path).toBe('deterministic_fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]!.map(String).join(' ');
    expect(line).toContain('[template-director]');
    expect(line).toContain('gemini_director_http_500');
    expect(line).not.toContain(NOTE);
    expect(line).not.toContain('Sidewalk Arrival');
    expect(result.prompt).toContain(USER_CUSTOMIZATION_HEADER_EN);
  });

  it('never logs a model-output snippet from a JSON parse error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sidewalk Arrival secret prompt text not json' }] } }] }),
          { status: 200 },
        ),
    );
    const result = await compileDirectorPromptDetailed(input, {
      env: { GEMINI_API_KEY: 'k' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.path).toBe('deterministic_fallback');
    const line = warn.mock.calls[0]!.map(String).join(' ');
    expect(line).not.toContain('Sidewalk');
    expect(line).not.toContain('secret');
  });

  it('runHeuristicDirectorTurn stops inventing a shot 1 edit and keeps the Korean chips', () => {
    const turn = runHeuristicDirectorTurn({
      templateId: 't',
      templateSummaryKo: '요약',
      editableSlots: ['outfit', 'shot_action'],
      userMessage: '블랙 가죽 자켓으로 바꿔줘',
    });
    expect(turn.structuredIntent?.shotEdits).toEqual([]);
    expect(turn.summaryChips.some((c) => c.slot === 'outfit' && c.summaryKo.includes('블랙 가죽 자켓'))).toBe(true);
  });

  it('the deterministic path puts customization under one header that states precedence', () => {
    const noteOnly = applyDeterministicDirectorSpec(input);
    expect(USER_CUSTOMIZATION_HEADER_EN).toBe(
      'User customization (applies to every shot it concerns; where it conflicts with the wardrobe, prop, makeup or hair wording above, this customization wins):',
    );
    expect(noteOnly.split(USER_CUSTOMIZATION_HEADER_EN)).toHaveLength(2);
    expect(noteOnly).toContain(NOTE);
    expect(noteOnly).not.toMatch(/Shot 1:/);

    const withIntent = applyDeterministicDirectorSpec({
      ...input,
      directorSpec: {
        audioMode: 'ambient',
        structuredIntent: {
          hairOverrideEn: null,
          makeupOverrideEn: null,
          outfitOverrideEn: 'a black leather biker jacket',
          propOverrideEn: null,
          shotEdits: [{ shotIndex: 2, actionEn: 'a brief wave instead of signing' }],
          strictExclusionsEn: [],
        },
      },
    });
    const block = withIntent.slice(withIntent.indexOf(USER_CUSTOMIZATION_HEADER_EN));
    expect(block).toContain('a black leather biker jacket');
    expect(block).toContain('Shot 2: a brief wave instead of signing');
    expect(withIntent.split(USER_CUSTOMIZATION_HEADER_EN)).toHaveLength(2);
  });
});

describe('P0-5 banned buzzwords are removed without breaking the sentence', () => {
  it('consumes the adjoining hyphen and tidies what is left', () => {
    const out = sanitizeRewrittenPrompt(
      `${BASE}\nA Hollywood-CGI appearance, porcelain-ivory skin, and a vibrant red coat (8K) , lit with cinematic lighting .`,
      false,
    );
    expect(out).toContain('Hollywood appearance');
    expect(out).toContain('ivory skin');
    expect(out).toContain('a red coat');
    expect(out).not.toMatch(/\w- /);
    expect(out).not.toMatch(/ -\w/);
    expect(out).not.toMatch(/ {2}/);
    expect(out).not.toMatch(/ [,.;:!?)]/);
    expect(out).not.toContain('()');
    expect(verifyRewrittenPrompt(out).ok).toBe(true);
  });
});

describe('P0-6 equipment and film-stock brand names are scrubbed', () => {
  it('rewrites film stocks and lens brands into plain description', () => {
    const out = sanitizeRewrittenPrompt(`${BASE}\nShot on Kodak Vision3 500T with Panavision lenses.`, false);
    expect(out).toContain('Shot on 35mm motion-picture film stock with cinema lenses.');
    expect(auditPersonalPrompt(out)).toEqual([]);
  });

  it('finds brand hits before and none after sanitizing', () => {
    const raw = `${BASE}
Filmed on an ARRI Alexa 35 with Zeiss Master Prime lenses and Cooke S4/i primes.
Graded like Kodak 2383 print film, Portra 400 tones, a Sony FX3 camera, Canon K35 glass,
Leica Summilux-C lenses, Hasselblad colour, Profoto B10 strobes, Fujifilm Eterna 500T, a RED Digital Cinema look,
Nikon and Broncolor and Panasonic and Phase One.`;
    const before = auditPersonalPrompt(raw);
    for (const brand of ['kodak', 'zeiss', 'cooke', 'arri', 'sony', 'canon', 'leica', 'hasselblad', 'profoto', 'fujifilm', 'red digital', 'nikon', 'broncolor', 'panasonic', 'phase one']) {
      expect(before, brand).toContain(brand);
    }
    const out = sanitizeRewrittenPrompt(raw, false);
    expect(auditPersonalPrompt(out)).toEqual([]);
    expect(out).toContain('35mm motion-picture film stock');
    expect(out).not.toMatch(/ {2}/);
    expect(verifyRewrittenPrompt(out).ok).toBe(true);
  });

  it('leaves ordinary words alone', () => {
    const raw = `${BASE}\nShe holds a vintage red digital camera prop; this is her canon event; phase one of the walk.`;
    const out = sanitizeRewrittenPrompt(raw, false);
    expect(out).toContain('a vintage red digital camera prop');
    expect(out).toContain('canon event');
    expect(out).toContain('phase one of the walk');
    expect(auditPersonalPrompt(raw)).toEqual([]);
  });
});
