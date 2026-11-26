import { describe, expect, it } from 'vitest';
import {
  BANNED_AI_BUZZWORDS,
  COMPILER_GRAMMAR_IDS,
  ImageAnalysisSchema,
  PreserveChangeMatrixSchema,
  SKIN_MATTE_CONTRACT_A10,
  SKIN_VIDEO_CONTRACT_SEEDANCE,
  ShotSpecSchema,
  VIDEO_REVERSE_PRESETS,
  approveBrief,
  compilePrompt,
  compileVideoReverseAdaptation,
  createDraftBrief,
  measurementToShotSpec,
  promoteBriefToFinal,
  reviseDraftBrief,
  routeShotEngine,
  stripPrivateMeasurementFields,
  type ImageAnalysis,
  type ShotSpec
} from '@/lib/brands/briefs';
import { SEEDANCE_25_PROMPT_CHARS } from '@/lib/engines/prompt-limits';
import { markConfirmedBrandIdentity, twingsDefaultIdentity } from '@/lib/brands/identity/schema';

const IDENTITY = markConfirmedBrandIdentity(twingsDefaultIdentity());

function sampleAnalysis(): ImageAnalysis {
  return ImageAnalysisSchema.parse({
    metadata: {
      width: 1440,
      height: 1800,
      format: 'JPEG',
      mode: 'RGB',
      exif: { Make: 'PrivateExifCamera', SerialNumber: '12345' },
      info_keys: ['exif', 'icc_profile'],
      aspect_ratio: {
        exact_integer: '4:5',
        decimal: 0.8,
        nearest_standard: '4:5',
        deviation_pct: 0
      },
      sha256: 'a'.repeat(64),
      source_path: 'D:/private/reference/shot01.jpg',
      embedded_text: 'confidential note'
    },
    tonal_summary: {
      key_classification: 'balanced',
      mean_luminance: 128,
      std_contrast: 48,
      dynamic_range_p99_p01: 210,
      percentiles: {
        p01: 12,
        p05_black_floor: 22,
        p50_median: 124,
        p95_white_shoulder: 232,
        p99: 244
      },
      zone_shares_pct: {
        dark_below_64: 24,
        mid_64_to_191: 58,
        bright_above_191: 18
      },
      tonal_hex: {
        lifted_black_p05: '#161b22',
        shadow_15pct: '#243447',
        midtone_50pct: '#6c87a6',
        highlight_15pct: '#f3f7fa'
      }
    },
    color_summary: {
      temperature_tendency: 'cool cyan/slate',
      tint_tendency: 'neutral',
      lab_a_green_magenta_shift: -1.4,
      lab_b_blue_yellow_shift: -8.2,
      midtone_lab_a_shift: -0.9,
      midtone_lab_b_shift: -6.5,
      mean_saturation_pct: 22,
      p90_saturation_pct: 38,
      dominant_palette: [
        { hex: '#3875c5', rgb: [56, 117, 197], share_pct: 34, luminance: 112 },
        { hex: '#d0dbe7', rgb: [208, 219, 231], share_pct: 28, luminance: 218 },
        { hex: '#16233f', rgb: [22, 35, 63], share_pct: 22, luminance: 36 },
        // Out-of-band red swatch that should be filtered out when paletteOnly=true
        { hex: '#ed1e1e', rgb: [237, 30, 30], share_pct: 16, luminance: 88 }
      ]
    },
    optics_and_texture: {
      optics_classification: 'shallow editorial',
      global_sharpness_laplacian: 142.5,
      center_sharpness: 210.4,
      periphery_sharpness: 84.1,
      center_to_periphery_dof_ratio: 2.5,
      bloom_halation_index: 1.2,
      grain_micro_sigma: 1.4,
      quadrant_luminance: {
        top_left: 168,
        top_right: 118,
        bottom_left: 144,
        bottom_right: 102
      }
    }
  });
}

describe('extract_image.py measurement -> ShotSpec (knowhow-corpus.md §3.1–3.3)', () => {
  it('strips W1 private metadata (sha256, source_path, exif, embedded_text) and maps 40+ metrics into ShotSpec', () => {
    const raw = sampleAnalysis();
    const stripped = stripPrivateMeasurementFields(raw);
    expect(stripped.metadata.sha256).toBeUndefined();
    expect(stripped.metadata.source_path).toBeUndefined();
    expect(stripped.metadata.exif).toBeUndefined();
    expect(stripped.metadata.embedded_text).toBeUndefined();

    const spec = measurementToShotSpec(raw, {
      brief: '겨울 아침 창가 빛 아래에 놓인 프렌치 블루 세럼 보틀',
      identity: IDENTITY,
      product: {
        name: 'TWINGS Hydro Serum 50ml',
        vessel_geometry: 'cylindrical thick glass bottle, 1:2.4 width-to-height ratio',
        label_lock: 'TWINGS HYDRO SERUM in crisp white sans-serif centered at 48% height',
        material_finish: 'frosted cobalt glass with brushed silver dropper cap'
      }
    });

    expect(spec.camera.focal_mm).toBe(85);
    expect(spec.camera.aperture).toBe('f/2.8');
    expect(spec.light.key.side).toBe('camera-left');
    expect(spec.light.key.height).toBe('slightly above eye-level');
    expect(spec.light.colour_k).toBe(6200);
    expect(spec.tone.lifted_black_hex).toBe('#161b22');
    expect(spec.tone.highlight_hex).toBe('#f3f7fa');
    // Out-of-band red #ed1e1e was filtered out by `paletteOnly` + ownedHue [195, 225]
    expect(spec.palette.hex_values).not.toContain('#ed1e1e');
    expect(spec.palette.hex_values).toContain('#3875c5');
    // Embedded analysis reference is sanitized
    const measured = spec.references[0]?.measured as { metadata?: Record<string, unknown> };
    expect(measured?.metadata?.source_path).toBeUndefined();
    expect(measured?.metadata?.sha256).toBeUndefined();
  });
});

describe('routing table & 7 model prompt grammars (knowhow-corpus.md §2.1–2.4)', () => {
  const baseSpec: ShotSpec = measurementToShotSpec(sampleAnalysis(), {
    brief: '쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업',
    identity: IDENTITY,
    references: [
      {
        asset_id: 'ast_product_01',
        role: 'product',
        controls: ['vessel-silhouette', 'label-typography', 'cap-finish'],
        ignore: ['studio-stand', 'background-reflection']
      }
    ],
    product: {
      name: 'TWINGS Hydro Serum 50ml',
      vessel_geometry: 'cylindrical thick glass bottle',
      label_lock: 'TWINGS HYDRO SERUM',
      material_finish: 'frosted blue glass with silver dropper'
    }
  });

  it('routes all 8 cut kinds to their benchmarked primary engines', () => {
    expect(routeShotEngine({ ...baseSpec, cutKind: 'editorial_full_body' }).engineId).toBe(
      'text2image_soul_v2'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'reference_exact_product' }).engineId).toBe(
      'seedream-5.5'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'logo_mark_preserve' }).engineId).toBe(
      'nano-banana-pro'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'person_portrait' }).engineId).toBe(
      'nano-banana-pro'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'typography_layout' }).engineId).toBe(
      'ideogram-4.5'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'seedance_start_frame' }).engineId).toBe(
      'soul_cinematic'
    );
    expect(routeShotEngine({ ...baseSpec, cutKind: 'short_film_clip' }).engineId).toBe(
      'seedance-2.5'
    );
  });

  it('compiles all 7 model grammars with zero lint errors on valid specs', () => {
    expect(COMPILER_GRAMMAR_IDS).toHaveLength(7);

    // 1. GPT Image 2.5 (faceless product shot)
    const gpt = compilePrompt(baseSpec, IDENTITY, undefined, { target: 'gpt-image-2.5-flare' });
    expect(gpt.params.grammar).toBe('gpt-image-2.5');
    expect(gpt.params.variant).toBe('sunburst');
    expect(gpt.prompt).toContain('[1. MEDIUM & CROP]');
    expect(gpt.prompt).toContain('[2. REFERENCE AUTHORITY]');
    expect(gpt.lint).toEqual([]);

    // 2. Nano Banana Pro (ALL-CAPS LOCK sections)
    const nb = compilePrompt(baseSpec, IDENTITY, undefined, {
      target: 'nano-banana-pro',
      finalResolution: '4k'
    });
    expect(nb.params.grammar).toBe('nano-banana-pro');
    expect(nb.params.resolution).toBe('4k');
    expect(nb.prompt).toContain('IDENTITY LOCK:');
    expect(nb.prompt).toContain('COMPOSITION LOCK:');
    expect(nb.prompt).toContain('CAMERA & OPTICS:');
    expect(nb.lint).toEqual([]);

    // 3. Seedream 5.5 (4-part prose +person a10 contract)
    const personSpec = ShotSpecSchema.parse({
      ...baseSpec,
      references: [
        {
          asset_id: 'ast_creator_face',
          role: 'identity',
          consented: true,
          controls: ['face', 'skin', 'hair'],
          ignore: ['outfit', 'background']
        }
      ],
      subject: {
        kind: 'consented_creator',
        cast_id: 'cast_01',
        age_band: '20s',
        hair: 'sleek low bun',
        pose: {
          torso_deg: 25,
          head_tilt: 'slight left',
          gaze: 'off-axis camera-left',
          hands: 'holding serum bottle at collarbone height'
        }
      }
    });
    const seedream = compilePrompt(personSpec, IDENTITY, undefined, {
      target: 'seedream-5.5'
    });
    expect(seedream.params.grammar).toBe('seedream-5.5');
    expect(seedream.prompt).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(seedream.lint).toEqual([]);

    // People may be made with GPT Image (founder 2026-11-19; the old ban was about GPT Image 2.0 lookbooks):
    // a person shot on GPT Image compiles with its people skin contract and no lint error.
    const gptPerson = compilePrompt(personSpec, IDENTITY, undefined, { target: 'gpt-image-2.5-flare' });
    expect(gptPerson.params.grammar).toBe('gpt-image-2.5');
    expect(gptPerson.prompt).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(gptPerson.lint).toEqual([]);

    // 4. FLUX Kontext (camera-first 5-block positive prose)
    const flux = compilePrompt(personSpec, IDENTITY, undefined, { target: 'flux-kontext' });
    expect(flux.params.grammar).toBe('flux-kontext');
    expect(flux.prompt).toContain(
      'Maintain the exact facial identity and bone structure of Image 1'
    );
    expect(flux.lint).toEqual([]);

    // 5. Soul 2.0 (editorial look without image references)
    const soulSpec = ShotSpecSchema.parse({
      ...baseSpec,
      cutKind: 'editorial_full_body',
      references: []
    });
    const soul = compilePrompt(soulSpec, IDENTITY, undefined, { target: 'text2image_soul_v2' });
    expect(soul.params.grammar).toBe('soul-2.0');
    expect(soul.params.quality).toBe('2k');
    expect(soul.prompt).toContain('Editorial direction:');
    expect(soul.lint).toEqual([]);

    // 6. Ideogram / Recraft (3-part layout + exact quoted typography)
    const ideo = compilePrompt(baseSpec, IDENTITY, undefined, { target: 'ideogram-4.5' });
    expect(ideo.params.grammar).toBe('ideogram-recraft');
    expect(ideo.params.magicPrompt).toBe('off');
    expect(ideo.prompt).toContain('"TWINGS HYDRO SERUM"');
    expect(ideo.lint).toEqual([]);

    // 7. Seedance 2.5 & Kling Omni (timeline + @Image 1 / <<<image_1>>> + No-BGM guard)
    const filmSpec = ShotSpecSchema.parse({
      ...baseSpec,
      cutKind: 'short_film_clip',
      deliverable: { medium: 'short film', aspect: '9:16', use: 'reel' },
      duration_s: 5,
      timeline: [
        {
          shot: 1,
          start: 0,
          end: 0.6,
          edit: 'hard cut',
          focal_mm: 85,
          camera: 'locked macro frame on dropper tip',
          action: 'Single serum drop forms at the glass tip.',
          audio: { sfx: 'subtle glass droplet resonance', no_bgm: true }
        },
        {
          shot: 2,
          start: 0.6,
          end: 5.0,
          edit: 'continuous',
          focal_mm: 50,
          camera: 'slow orbital arc camera-left to center',
          action: 'Light band sweeps across the frosted bottle label.',
          audio: {
            dialogue: {
              speaker: 'Mina',
              language: 'Korean',
              tone: 'quietly',
              line: '차가운 아침 빛 그대로.'
            },
            no_bgm: true
          }
        }
      ]
    });
    const seedance = compilePrompt(filmSpec, IDENTITY, undefined, {
      target: 'seedance-2.5',
      stage: 'draft'
    });
    expect(seedance.params.grammar).toBe('seedance-2.5');
    expect(seedance.params.resolution).toBe('480p');
    expect(seedance.params.draft).toBe(true);
    expect(seedance.params.generateAudio).toBe(false);
    expect(seedance.prompt).toContain('Begin already in motion.');
    expect(seedance.prompt).toContain('@Image 1 anchors product');
    expect(seedance.prompt).toContain('[Shot 1 — 0.0–0.6s] (hard cut) 85mm');
    expect(seedance.prompt).toContain('Mina (Korean, quietly): {차가운 아침 빛 그대로.}');
    expect(seedance.lint).toEqual([]);

    const kling = compilePrompt(filmSpec, IDENTITY, undefined, {
      target: 'kling-omni',
      stage: 'final',
      finalResolution: '1080p'
    });
    expect(kling.prompt).toContain('<<<image_1>>> anchors product');
    expect(kling.params.resolution).toBe('1080p');
    expect(kling.params.draft).toBe(false);
  });

  it('catches hardline violations in lintCompiledPrompt', () => {
    const badSpec = ShotSpecSchema.parse({
      ...baseSpec,
      brief:
        'Shot on Canon and Profoto with hyperrealistic 8K cinematic lighting, pink makeup, and 무료 크레딧',
      references: [
        {
          asset_id: 'ast_unconsented_face',
          role: 'identity',
          consented: false,
          controls: ['face'],
          ignore: ['background']
        },
        {
          asset_id: 'ast_scene_conflict',
          role: 'scene',
          controls: ['background'],
          ignore: ['subject']
        }
      ],
      palette: {
        world: 'blue',
        hex_values: ['#3875c5', '#ed1e1e'],
        warm_notes: ['skin']
      },
      duration_s: 5,
      timeline: [
        {
          shot: 1,
          start: 0,
          end: 0.4,
          edit: 'continuous',
          focal_mm: 85,
          camera: 'continuous push-in toward bottle',
          action: 'Opens on bottle.'
        },
        {
          shot: 2,
          start: 1.0,
          end: 4.0,
          edit: 'hard cut',
          focal_mm: 50,
          camera: 'static',
          action: 'Gap before shot 2 and ends before 5.0s.'
        }
      ]
    });

    const nbResult = compilePrompt(badSpec, IDENTITY, { bannedPhrases: ['금지문구'] }, {
      target: 'nano-banana-pro'
    });
    const rules = new Set(nbResult.lint.map((i) => i.rule));
    expect(rules.has('equipment_brand')).toBe(true);
    expect(rules.has('ai_buzzword')).toBe(true);
    expect(rules.has('pink_makeup')).toBe(true);
    expect(rules.has('brand_forbidden_term')).toBe(true);
    expect(rules.has('unconsented_face_reference')).toBe(true);
    expect(rules.has('nb_pro_mixed_references')).toBe(true);
    expect(rules.has('palette_out_of_world')).toBe(true);
    expect(rules.has('timeline_gap_or_overlap')).toBe(true);
    expect(rules.has('subsecond_continuous_push_in')).toBe(true);

    // GPT Image with a person is no longer a lint error of its own (the other hardlines still apply).
    const gptWithPerson = compilePrompt(badSpec, IDENTITY, undefined, {
      target: 'gpt-image-2.5-flare'
    });
    const gptRules = gptWithPerson.lint.map((i) => i.rule as string);
    expect(gptRules).not.toContain('gpt_image_person_disallowed');
    expect(gptRules).toContain('equipment_brand');
  });
});

describe('people briefs on GPT Image (founder 2026-11-19)', () => {
  const peopleSpec = ShotSpecSchema.parse({
    ...measurementToShotSpec(sampleAnalysis(), {
      brief: '세럼을 든 크리에이터 상반신 화보',
      identity: IDENTITY,
      cutKind: 'person_portrait',
      references: [
        { asset_id: 'ast_creator_face', role: 'identity', consented: true, controls: ['face', 'skin', 'hair'], ignore: ['outfit', 'background'] }
      ]
    }),
    subject: { kind: 'consented_creator', cast_id: 'cast_01', age_band: '20s', hair: 'sleek low bun', pose: { torso_deg: 25, head_tilt: 'slight left', gaze: 'off-axis camera-left', hands: 'holding serum bottle at collarbone height' } }
  });

  it('approves and finishes a people brief aimed at GPT Image; the default route is unchanged', () => {
    // No target: the routing table decides, and it never picked GPT Image for people (before or after).
    expect(routeShotEngine(peopleSpec).engineId).toBe('nano-banana-pro');
    expect(routeShotEngine({ ...peopleSpec, cutKind: 'editorial_full_body' }).engineId).toBe('text2image_soul_v2');
    const draft = createDraftBrief({ organizationId: '11111111-1111-4111-8111-111111111111', spec: peopleSpec, identity: IDENTITY, target: 'gpt-image-2.5-flare' });
    expect(draft.compiled.params.engineId).toBe('gpt-image-2.5-flare');
    expect(draft.compiled.lint.filter((issue) => issue.severity === 'error')).toEqual([]);
    const approved = approveBrief(draft, { approvedBy: 'pd-user-1', aestheticGatePassed: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const finalized = promoteBriefToFinal(approved.data, IDENTITY);
    expect(finalized.ok).toBe(true);
  });
});

describe('draft (480p) -> approve -> final state machine & baseline+delta gate', () => {
  const filmSpec = ShotSpecSchema.parse({
    ...measurementToShotSpec(sampleAnalysis(), {
      brief: '프렌치 블루 세럼 5초 모션 클립',
      identity: IDENTITY,
      cutKind: 'short_film_clip',
      deliverable: { medium: 'short film', aspect: '9:16', use: 'reel' }
    }),
    duration_s: 5
  });

  it('enforces single-axis baseline+delta revisions, aesthetic gate, lint check, and 480p -> 1080p promotion', () => {
    const draft = createDraftBrief({
      organizationId: '11111111-1111-4111-8111-111111111111',
      spec: filmSpec,
      identity: IDENTITY,
      maxRounds: 2
    });
    expect(draft.stage).toBe('draft');
    expect(draft.round).toBe(1);
    expect(draft.compiled.params.resolution).toBe('480p');
    expect(draft.compiled.params.draft).toBe(true);

    // Changing two axes (camera AND light) in one round is rejected by baseline+delta
    const twoAxes = reviseDraftBrief(
      draft,
      {
        ...draft.spec,
        camera: { ...draft.spec.camera, focal_mm: 50 },
        light: { ...draft.spec.light, colour_k: 4800 }
      },
      IDENTITY
    );
    expect(twoAxes.ok).toBe(false);
    if (!twoAxes.ok) {
      expect(twoAxes.code).toBe('too_many_changed_axes');
      expect(twoAxes.axes).toEqual(['camera', 'light']);
    }

    // Changing exactly one axis (camera) succeeds and increments round to 2
    const r2 = reviseDraftBrief(
      draft,
      {
        ...draft.spec,
        camera: { ...draft.spec.camera, focal_mm: 50 }
      },
      IDENTITY
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.round).toBe(2);
    expect(r2.data.lastChangedAxis).toBe('camera');

    // Exceeding maxRounds (2) is rejected
    const r3 = reviseDraftBrief(
      r2.data,
      {
        ...r2.data.spec,
        light: { ...r2.data.spec.light, colour_k: 5200 }
      },
      IDENTITY
    );
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.code).toBe('round_limit_exceeded');

    // Promoting directly from draft to final without approval is rejected
    const prematureFinal = promoteBriefToFinal(r2.data, IDENTITY);
    expect(prematureFinal.ok).toBe(false);
    if (!prematureFinal.ok) expect(prematureFinal.code).toBe('must_approve_before_final');

    // Approving without aesthetic gate is rejected
    const noGate = approveBrief(r2.data, {
      approvedBy: 'pd-user-1',
      aestheticGatePassed: false
    });
    expect(noGate.ok).toBe(false);
    if (!noGate.ok) expect(noGate.code).toBe('aesthetic_gate_required');

    // Approving with aesthetic gate locks the spec hash
    const approved = approveBrief(r2.data, {
      approvedBy: 'pd-user-1',
      aestheticGatePassed: true
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.data.stage).toBe('approved');
    expect(approved.data.lockedSpecHash).toBeTruthy();

    // Tampering with spec after approval is caught before final render
    const tampered = promoteBriefToFinal(
      {
        ...approved.data,
        spec: { ...approved.data.spec, brief: '몰래 바꾼 지시문' }
      },
      IDENTITY
    );
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.code).toBe('spec_modified_after_approval');

    // Promoting the locked approved brief upgrades params to 1080p, draft=false
    const finalized = promoteBriefToFinal(approved.data, IDENTITY, undefined, {
      finalResolution: '1080p'
    });
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(finalized.data.stage).toBe('final');
    expect(finalized.data.compiled.params.resolution).toBe('1080p');
    expect(finalized.data.compiled.params.draft).toBe(false);
    expect(finalized.data.compiled.params.bitrateMode).toBe('high');
  });
});

describe('Seedance 2.5 video skin split, glossy guard & 15,000-char limit (SB-1)', () => {
  const CANONICAL_VIDEO_SKIN_FORMULA =
    'looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush';

  const PRE_CHANGE_STILL_SNAPSHOTS = {
    gpt_base:
      '[1. MEDIUM & CROP] product still (4:5) for feed — 쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업.\n\n[2. REFERENCE AUTHORITY] Image 1 (product): lend vessel-silhouette, label-typography, cap-finish; ignore studio-stand, background-reflection.\n\n[3. POSE & WARDROBE] Hero product TWINGS Hydro Serum 50ml with cylindrical thick glass bottle, TWINGS HYDRO SERUM, and frosted blue glass with silver dropper.\n\n[4. SPACE & LAYERS] Foreground: clean unobstructed foreground plane. Midground: primary subject anchored on clean studio plane. Background: architectural matte paper backdrop with soft tonal gradient on seamless matte paper.\n\n[5. LIGHT, PALETTE & OPTICS] Lighting: large strip softbox from camera-left at slightly above eye-level (close), creating controlled directional highlight roll-off without clipping; fill via white bounce card camera-right, one stop under at 6200K. Tonal anchors (balanced): lifted black #161b22, shadow #243447, midtone #6c87a6, highlight #f3f7fa, saturation 22%, shadow share 53%. Palette (blue world): #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b (warm notes reserved for skin, lips). Optics: 85mm lens at 3.2m, f/2.8, camera height shoulder, tilt 0 deg, subject width 32% with 15% frame margin, halation 0.3, fine film grain sigma 1.4. Frame remains clean and free of text, free of watermark, free of logo, free of beauty-filter smoothing, free of visible blush, free of 무료 크레딧, free of 무제한 생성, free of AI 생성 표시, free of 혁신적인, free of 압도적인, free of 완벽한 AI, free of 마법 같은.',
    gpt_person:
      '[1. MEDIUM & CROP] product still (4:5) for feed — 쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업.\n\n[2. REFERENCE AUTHORITY] Image 1 (identity): lend face, skin, hair; ignore outfit, background.\n\n[3. POSE & WARDROBE] Subject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height. Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\n\n[4. SPACE & LAYERS] Foreground: clean unobstructed foreground plane. Midground: primary subject anchored on clean studio plane. Background: architectural matte paper backdrop with soft tonal gradient on seamless matte paper.\n\n[5. LIGHT, PALETTE & OPTICS] Lighting: large strip softbox from camera-left at slightly above eye-level (close), creating controlled directional highlight roll-off without clipping; fill via white bounce card camera-right, one stop under at 6200K. Tonal anchors (balanced): lifted black #161b22, shadow #243447, midtone #6c87a6, highlight #f3f7fa, saturation 22%, shadow share 53%. Palette (blue world): #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b (warm notes reserved for skin, lips). Optics: 85mm lens at 3.2m, f/2.8, camera height shoulder, tilt 0 deg, subject width 32% with 15% frame margin, halation 0.3, fine film grain sigma 1.4. Frame remains clean and free of text, free of watermark, free of logo, free of beauty-filter smoothing, free of visible blush, free of 무료 크레딧, free of 무제한 생성, free of AI 생성 표시, free of 혁신적인, free of 압도적인, free of 완벽한 AI, free of 마법 같은.',
    nb_pro_base:
      'IDENTITY LOCK: Faceless product/scene composition — no person in frame.\nCOMPOSITION LOCK: Framing at 85mm, distance 3.2m, subject width 32%, minimum 15% clean margin.\nPOSE LOCK: Hero product TWINGS Hydro Serum 50ml with cylindrical thick glass bottle, TWINGS HYDRO SERUM, and frosted blue glass with silver dropper.\nOUTFIT & PROPS: Product lock: TWINGS Hydro Serum 50ml (cylindrical thick glass bottle; TWINGS HYDRO SERUM; frosted blue glass with silver dropper). Image 1 (product): lend vessel-silhouette, label-typography, cap-finish; ignore studio-stand, background-reflection.\nSETTING: Foreground clean unobstructed foreground plane; midground primary subject anchored on clean studio plane; background architectural matte paper backdrop with soft tonal gradient (seamless matte paper).\nCOLOR GRADE & LIGHT: large strip softbox camera-left (slightly above eye-level), white bounce card camera-right, one stop under, 6200K. Tonal hex anchors #161b22 / #243447 / #6c87a6 / #f3f7fa. Palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b.\nCAMERA & OPTICS: 85mm, f/2.8, DOF ratio 2.5, halation 0.3, grain sigma 1.4.\nNEGATIVE: text, watermark, logo, beauty-filter smoothing, visible blush, 무료 크레딧, 무제한 생성, AI 생성 표시, 혁신적인, 압도적인, 완벽한 AI, 마법 같은.',
    nb_pro_person:
      'IDENTITY LOCK: Preserve the exact facial geometry, bone structure, eye spacing, and natural skin tone of Image 1 (ast_creator_face). Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\nCOMPOSITION LOCK: Framing at 85mm, distance 3.2m, subject width 32%, minimum 15% clean margin.\nPOSE LOCK: Subject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height.\nOUTFIT & PROPS: Product lock: TWINGS Hydro Serum 50ml (cylindrical thick glass bottle; TWINGS HYDRO SERUM; frosted blue glass with silver dropper).\nSETTING: Foreground clean unobstructed foreground plane; midground primary subject anchored on clean studio plane; background architectural matte paper backdrop with soft tonal gradient (seamless matte paper).\nCOLOR GRADE & LIGHT: large strip softbox camera-left (slightly above eye-level), white bounce card camera-right, one stop under, 6200K. Tonal hex anchors #161b22 / #243447 / #6c87a6 / #f3f7fa. Palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b.\nCAMERA & OPTICS: 85mm, f/2.8, DOF ratio 2.5, halation 0.3, grain sigma 1.4.\nNEGATIVE: text, watermark, logo, beauty-filter smoothing, visible blush, 무료 크레딧, 무제한 생성, AI 생성 표시, 혁신적인, 압도적인, 완벽한 AI, 마법 같은.',
    nb_21_person:
      'IDENTITY LOCK: Preserve the exact facial geometry, bone structure, eye spacing, and natural skin tone of Image 1 (ast_creator_face). Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\nCOMPOSITION LOCK: Framing at 85mm, distance 3.2m, subject width 32%, minimum 15% clean margin.\nPOSE LOCK: Subject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height.\nOUTFIT & PROPS: Product lock: TWINGS Hydro Serum 50ml (cylindrical thick glass bottle; TWINGS HYDRO SERUM; frosted blue glass with silver dropper).\nSETTING: Foreground clean unobstructed foreground plane; midground primary subject anchored on clean studio plane; background architectural matte paper backdrop with soft tonal gradient (seamless matte paper).\nCOLOR GRADE & LIGHT: large strip softbox camera-left (slightly above eye-level), white bounce card camera-right, one stop under, 6200K. Tonal hex anchors #161b22 / #243447 / #6c87a6 / #f3f7fa. Palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b.\nCAMERA & OPTICS: 85mm, f/2.8, DOF ratio 2.5, halation 0.3, grain sigma 1.4.\nNEGATIVE: text, watermark, logo, beauty-filter smoothing, visible blush, 무료 크레딧, 무제한 생성, AI 생성 표시, 혁신적인, 압도적인, 완벽한 AI, 마법 같은.',
    seedream_person:
      'Reference preservation rules: Image 1 (identity): lend face, skin, hair; ignore outfit, background.\n\nSubject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height. Environment: clean unobstructed foreground plane leading to primary subject anchored on clean studio plane against architectural matte paper backdrop with soft tonal gradient (seamless matte paper). Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\n\nLighting: large strip softbox from camera-left at slightly above eye-level (close), creating controlled directional highlight roll-off without clipping; fill via white bounce card camera-right, one stop under at 6200K. Tonal anchors (balanced): lifted black #161b22, shadow #243447, midtone #6c87a6, highlight #f3f7fa, saturation 22%, shadow share 53%. Palette (blue world): #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b (warm notes reserved for skin, lips). Optics: 85mm lens at 3.2m, f/2.8, camera height shoulder, tilt 0 deg, subject width 32% with 15% frame margin, halation 0.3, fine film grain sigma 1.4.\n\nDeliverable: product still for feed, clean uncropped frame free of text, watermark, logo, beauty-filter smoothing, visible blush, 무료 크레딧, 무제한 생성, AI 생성 표시, 혁신적인, 압도적인, 완벽한 AI, 마법 같은.',
    flux_person:
      '1. CAMERA & OPTICS: Maintain the exact facial identity and bone structure of Image 1 while placing the subject into the directed studio environment. 85mm focal length, f/2.8, shoulder camera height, 15% clean margin.\n2. SUBJECT & MATERIAL: Subject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height.  Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\n3. SPACE: clean unobstructed foreground plane, primary subject anchored on clean studio plane, architectural matte paper backdrop with soft tonal gradient on seamless matte paper.\n4. LIGHT: large strip softbox from camera-left (slightly above eye-level), white bounce card camera-right, one stop under, 6200K.\n5. COLOUR WORLD: Tonal anchors #161b22, #243447, #6c87a6, #f3f7fa within palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b, clean bare frame with natural optical grain sigma 1.4.',
    soul_base:
      'Editorial direction: 쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업.\n\nSubject & garment architecture: Hero product TWINGS Hydro Serum 50ml with cylindrical thick glass bottle, TWINGS HYDRO SERUM, and frosted blue glass with silver dropper. \n\nAtmosphere & colour world (blue): palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b with lifted black #161b22, midtone #6c87a6, highlight #f3f7fa.\n\nLight & optical finish: large strip softbox from camera-left at 6200K, 85mm lens (f/2.8), native optical halation 0.3 and organic film grain sigma 1.4.',
    soul_person:
      'Editorial direction: 쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업.\n\nSubject & garment architecture: Subject (20s, sleek low bun hair): torso angled 25 deg, head tilt slight left, gaze off-axis camera-left, hands holding serum bottle at collarbone height.  Natural matte skin texture with visible pores and subtle micro-relief. Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. True-to-life undertone with natural lip colour and zero beauty-filter smoothing.\n\nAtmosphere & colour world (blue): palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b with lifted black #161b22, midtone #6c87a6, highlight #f3f7fa.\n\nLight & optical finish: large strip softbox from camera-left at 6200K, 85mm lens (f/2.8), native optical halation 0.3 and organic film grain sigma 1.4.',
    ideogram_base:
      '1. SUMMARY: product still for feed — 쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업.\n2. STYLE & HEX PALETTE: Strict brand palette #3875c5, #d0dbe7, #16233f, #ffffff, #f4f4f5, #09090b with tonal anchors #161b22 and #f3f7fa, clean architectural grid.\n3. COMPOSITION & EXACT TEXT: Center-weighted layout on seamless matte paper (architectural matte paper backdrop with soft tonal gradient) with exact quoted typography "TWINGS HYDRO SERUM" and 15% clear margin.'
  } as const;

  const baseSpec: ShotSpec = measurementToShotSpec(sampleAnalysis(), {
    brief: '쿨 데이라이트 스튜디오의 유리 세럼 보틀 클로즈업',
    identity: IDENTITY,
    references: [
      {
        asset_id: 'ast_product_01',
        role: 'product',
        controls: ['vessel-silhouette', 'label-typography', 'cap-finish'],
        ignore: ['studio-stand', 'background-reflection']
      }
    ],
    product: {
      name: 'TWINGS Hydro Serum 50ml',
      vessel_geometry: 'cylindrical thick glass bottle',
      label_lock: 'TWINGS HYDRO SERUM',
      material_finish: 'frosted blue glass with silver dropper'
    }
  });

  const personSpec = ShotSpecSchema.parse({
    ...baseSpec,
    references: [
      {
        asset_id: 'ast_creator_face',
        role: 'identity',
        consented: true,
        controls: ['face', 'skin', 'hair'],
        ignore: ['outfit', 'background']
      }
    ],
    subject: {
      kind: 'consented_creator',
      cast_id: 'cast_01',
      age_band: '20s',
      hair: 'sleek low bun',
      pose: {
        torso_deg: 25,
        head_tilt: 'slight left',
        gaze: 'off-axis camera-left',
        hands: 'holding serum bottle at collarbone height'
      }
    }
  });

  const soulSpec = ShotSpecSchema.parse({
    ...baseSpec,
    cutKind: 'editorial_full_body',
    references: []
  });

  const personSoulSpec = ShotSpecSchema.parse({
    ...personSpec,
    cutKind: 'editorial_full_body',
    references: []
  });

  const filmSpec = ShotSpecSchema.parse({
    ...baseSpec,
    cutKind: 'short_film_clip',
    deliverable: { medium: 'short film', aspect: '9:16', use: 'reel' },
    duration_s: 5,
    timeline: [
      {
        shot: 1,
        start: 0,
        end: 0.6,
        edit: 'hard cut',
        focal_mm: 85,
        camera: 'locked macro frame on dropper tip',
        action: 'Single serum drop forms at the glass tip.',
        audio: { sfx: 'subtle glass droplet resonance', no_bgm: true }
      },
      {
        shot: 2,
        start: 0.6,
        end: 5.0,
        edit: 'continuous',
        focal_mm: 50,
        camera: 'slow orbital arc camera-left to center',
        action: 'Light band sweeps across the frosted bottle label.',
        audio: {
          dialogue: {
            speaker: 'Mina',
            language: 'Korean',
            tone: 'quietly',
            line: '차가운 아침 빛 그대로.'
          },
          no_bgm: true
        }
      }
    ]
  });

  const personFilmSpec = ShotSpecSchema.parse({
    ...filmSpec,
    references: personSpec.references,
    subject: personSpec.subject
  });

  it('keeps still-image outputs byte-identical to pre-change snapshots and preserves SKIN_MATTE_CONTRACT_A10 on stills', () => {
    const compiledStills = {
      gpt_base: compilePrompt(baseSpec, IDENTITY, undefined, { target: 'gpt-image-2.5-flare' }).prompt,
      gpt_person: compilePrompt(personSpec, IDENTITY, undefined, { target: 'gpt-image-2.5-flare' }).prompt,
      nb_pro_base: compilePrompt(baseSpec, IDENTITY, undefined, { target: 'nano-banana-pro', finalResolution: '4k' }).prompt,
      nb_pro_person: compilePrompt(personSpec, IDENTITY, undefined, { target: 'nano-banana-pro' }).prompt,
      nb_21_person: compilePrompt(personSpec, IDENTITY, undefined, { target: 'nano-banana-2.1' }).prompt,
      seedream_person: compilePrompt(personSpec, IDENTITY, undefined, { target: 'seedream-5.5' }).prompt,
      flux_person: compilePrompt(personSpec, IDENTITY, undefined, { target: 'flux-kontext' }).prompt,
      soul_base: compilePrompt(soulSpec, IDENTITY, undefined, { target: 'text2image_soul_v2' }).prompt,
      soul_person: compilePrompt(personSoulSpec, IDENTITY, undefined, { target: 'text2image_soul_v2' }).prompt,
      ideogram_base: compilePrompt(baseSpec, IDENTITY, undefined, { target: 'ideogram-4.5' }).prompt
    };

    for (const [key, snapshot] of Object.entries(PRE_CHANGE_STILL_SNAPSHOTS)) {
      const actual = compiledStills[key as keyof typeof compiledStills];
      expect(actual, key).toBe(snapshot);
      expect(actual, key).not.toContain(CANONICAL_VIDEO_SKIN_FORMULA);
    }
    expect(compiledStills.gpt_person).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(compiledStills.nb_pro_person).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(compiledStills.nb_21_person).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(compiledStills.seedream_person).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(compiledStills.flux_person).toContain(SKIN_MATTE_CONTRACT_A10);
    expect(compiledStills.soul_person).toContain(SKIN_MATTE_CONTRACT_A10);
  });

  it('inserts the canonical Seedance 2.5 video skin formula exactly once per person video prompt (never per shot)', () => {
    expect(SKIN_VIDEO_CONTRACT_SEEDANCE).toBe(CANONICAL_VIDEO_SKIN_FORMULA);

    // Faceless film: neither still nor video skin contract
    const facelessSeedance = compilePrompt(filmSpec, IDENTITY, undefined, {
      target: 'seedance-2.5',
      stage: 'draft'
    });
    expect(facelessSeedance.prompt).not.toContain(SKIN_VIDEO_CONTRACT_SEEDANCE);
    expect(facelessSeedance.prompt).not.toContain(SKIN_MATTE_CONTRACT_A10);
    expect(facelessSeedance.lint).toEqual([]);

    // Person film on Seedance 2.5 and Kling Omni, plus all Video Reverse presets
    const personResults = [
      compilePrompt(personFilmSpec, IDENTITY, undefined, { target: 'seedance-2.5', stage: 'draft' }),
      compilePrompt(personFilmSpec, IDENTITY, undefined, { target: 'kling-omni', stage: 'final', finalResolution: '1080p' }),
      ...Object.values(VIDEO_REVERSE_PRESETS).map((analysis) => {
        const adapted = compileVideoReverseAdaptation({
          analysis,
          matrix: PreserveChangeMatrixSchema.parse({}),
          identity: IDENTITY
        });
        return compilePrompt(adapted.spec, IDENTITY, undefined, { target: 'seedance-2.5', stage: 'draft' });
      })
    ];

    for (const result of personResults) {
      expect(result.lint).toEqual([]);
      expect(result.prompt.split(SKIN_VIDEO_CONTRACT_SEEDANCE).length - 1).toBe(1);
      expect(result.prompt).not.toContain(SKIN_MATTE_CONTRACT_A10);
      const shotLines = result.prompt.split('\n').filter((line) => line.startsWith('[Shot '));
      for (const shotLine of shotLines) {
        expect(shotLine).not.toContain('underexposed 35mm');
        expect(shotLine).not.toContain('micro-pores');
      }
    }
  });

  it('never emits banned glossy or buzzword tokens in any compiled output and keeps existing lint blocks intact', () => {
    const glossyTokens = ['porcelain', 'glass-skin', 'dewy', 'flawless', 'poreless'] as const;

    const cleanOutputs = [
      compilePrompt(personSpec, IDENTITY, undefined, { target: 'nano-banana-pro' }).prompt,
      compilePrompt(personSpec, IDENTITY, undefined, { target: 'seedream-5.5' }).prompt,
      compilePrompt(personFilmSpec, IDENTITY, undefined, { target: 'seedance-2.5', stage: 'draft' }).prompt,
      ...Object.values(VIDEO_REVERSE_PRESETS).map((analysis) => {
        const adapted = compileVideoReverseAdaptation({
          analysis,
          matrix: PreserveChangeMatrixSchema.parse({}),
          identity: IDENTITY
        });
        return compilePrompt(adapted.spec, IDENTITY, undefined, { target: 'seedance-2.5', stage: 'draft' }).prompt;
      })
    ];

    for (const output of cleanOutputs) {
      const lower = output.toLowerCase();
      for (const token of [...glossyTokens, ...BANNED_AI_BUZZWORDS]) {
        expect(lower).not.toContain(token);
      }
    }

    for (const token of ['porcelain', 'flawless'] as const) {
      const badBriefSpec = ShotSpecSchema.parse({
        ...personFilmSpec,
        brief: `Editorial close-up featuring ${token} complexion`
      });
      const res = compilePrompt(badBriefSpec, IDENTITY, undefined, { target: 'seedance-2.5', stage: 'draft' });
      expect(res.lint.some((issue) => issue.rule === 'ai_buzzword'), token).toBe(true);
    }
  });

  it('keeps compiled Seedance 2.5 video prompts within 15,000 characters for presets and the largest 15-shot fixture', () => {
    for (const [presetId, analysis] of Object.entries(VIDEO_REVERSE_PRESETS)) {
      const adapted = compileVideoReverseAdaptation({
        analysis,
        matrix: PreserveChangeMatrixSchema.parse({}),
        identity: IDENTITY
      });
      const compiled = compilePrompt(adapted.spec, IDENTITY, undefined, {
        target: 'seedance-2.5',
        stage: 'draft'
      });
      expect(compiled.prompt.length, presetId).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
    }

    // Largest fixture: max 15 timeline shots with full action, camera, audio, wardrobe, product, exclusions
    const maxTimeline = Array.from({ length: 15 }, (_, idx) => ({
      shot: idx + 1,
      start: idx,
      end: idx + 1,
      edit: idx === 0 ? ('hard cut' as const) : ('match cut' as const),
      focal_mm: 50,
      camera: 'smooth Steadicam orbital tracking from 18-degree profile toward three-quarter rear framing with foreground parallax',
      action:
        'Subject turns with calm off-axis gaze and softly closed lips while fine stray flyaway hairs move in cool studio air beside the product.',
      audio: {
        sfx: 'crisp wool-silk movement and subtle glass contact on honed travertine plinth',
        dialogue: {
          speaker: 'Model',
          language: 'Korean',
          tone: 'quietly',
          line: '차분한 빛 속에서 흔들리지 않는 실루엣 그대로.'
        },
        no_bgm: true
      }
    }));

    const largestFilmSpec = ShotSpecSchema.parse({
      ...personFilmSpec,
      brief: '가나다라마바사 '.repeat(40).trim().slice(0, 580),
      wardrobe: {
        silhouette: 'asymmetric tailored double-breasted wool coat over structured column skirt',
        fabric: 'matte heavyweight virgin wool and fine poplin shirting',
        construction: 'sharp shoulder seam, concealed placket, clean tailored hem',
        lock: true
      },
      duration_s: 15,
      timeline: maxTimeline
    });

    const largestCompiled = compilePrompt(largestFilmSpec, IDENTITY, undefined, {
      target: 'seedance-2.5',
      stage: 'draft'
    });
    expect(largestCompiled.prompt.length).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
    expect(largestCompiled.prompt.split(SKIN_VIDEO_CONTRACT_SEEDANCE).length - 1).toBe(1);
  });
});
