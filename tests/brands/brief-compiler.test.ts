import { describe, expect, it } from 'vitest';
import {
  COMPILER_GRAMMAR_IDS,
  ImageAnalysisSchema,
  SKIN_MATTE_CONTRACT_A10,
  ShotSpecSchema,
  approveBrief,
  compilePrompt,
  createDraftBrief,
  measurementToShotSpec,
  promoteBriefToFinal,
  reviseDraftBrief,
  routeShotEngine,
  stripPrivateMeasurementFields,
  type ImageAnalysis,
  type ShotSpec
} from '@/lib/brands/briefs';
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

    // GPT Image with a person is blocked
    const gptWithPerson = compilePrompt(badSpec, IDENTITY, undefined, {
      target: 'gpt-image-2.5-flare'
    });
    expect(gptWithPerson.lint.map((i) => i.rule)).toContain('gpt_image_person_disallowed');
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
