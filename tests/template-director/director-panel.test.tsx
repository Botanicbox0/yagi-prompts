import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TemplateDirectorPanel,
  formatReferenceFileSpec,
  upsertSummaryChips
} from '@/components/twings/template-director-panel';
import {
  diagnosePhotoSuitability,
  type PhotoInspectionVerdict
} from '@/lib/template-director/schema';

const sampleOcclusionVerdict: PhotoInspectionVerdict = {
  status: 'needs_cleanup',
  issues: ['prop_occlusion', 'hand_occlusion'],
  faceWidthRatio: 0.36,
  extractedHairDescription: 'long straight dark-brown hair with light bangs',
  userMessageKo: '볼 옆에 화장품 병과 손이 일부 찍혀 있어요. TWINGS가 자연스럽게 정리해서 진행할까요?',
  userMessageEn: 'A hand and cosmetic bottle partially sit near the cheek. Would you like TWINGS to clean them up?',
  recommendedCleanup: {
    mode: 'inpaint_occlusion',
    engine: 'nano-banana-2.1',
    fallbackEngine: 'seedream-5.0-pro',
    requiresDualCandidateSelection: true,
    candidateEngines: ['seedream-5.0-pro', 'nano-banana-2.1'],
    candidatePromptsEn: {
      'seedream-5.0-pro': 'Reference Image 1 provides the young Korean female subject...',
      'nano-banana-2.1': 'IDENTITY LOCK: Keep the exact facial identity...'
    },
    editPromptEn: 'Keep the person in Image 1 100% identical and remove the bottle and hand.'
  }
};

const sampleLowResVerdict: PhotoInspectionVerdict = {
  status: 'needs_cleanup',
  issues: ['low_resolution'],
  faceWidthRatio: 0.38,
  extractedHairDescription: 'chin-length bob',
  userMessageKo: '사진 해상도가 다소 낮아 흐릿해 보일 수 있어요. 광학 선명도 복원으로 선명하게 다듬을까요?',
  userMessageEn: 'The photo resolution is low. Restore optical sharpness?',
  recommendedCleanup: {
    mode: 'restore_detail',
    engine: 'seedvr2-local',
    fallbackEngine: null,
    requiresDualCandidateSelection: false,
    candidateEngines: [],
    candidatePromptsEn: null,
    editPromptEn: null
  }
};

const sampleRetouchVerdict: PhotoInspectionVerdict = {
  status: 'needs_cleanup',
  issues: ['over_retouched_contour', 'heavy_filter'],
  faceWidthRatio: 0.37,
  extractedHairDescription: 'long wavy dark-brown hair',
  userMessageKo:
    '사진에 뷰티 보정(턱선·입술·피부 블러)이 들어가 있어 영상에서 움직일 때 다소 인위적으로 보일 수 있어요. TWINGS가 자연스러운 카메라 렌즈 비율과 실제 피부 결로 정돈해서 제작할까요?',
  userMessageEn:
    'Heavy beauty-app retouching on the jawline or lips may look unnatural in motion. Normalize with TWINGS?',
  recommendedCleanup: {
    mode: 'normalize_retouch',
    engine: 'nano-banana-2.1',
    fallbackEngine: 'seedream-5.0-pro',
    requiresDualCandidateSelection: true,
    candidateEngines: ['seedream-5.0-pro', 'nano-banana-2.1'],
    candidatePromptsEn: {
      'seedream-5.0-pro': 'Reference Image 1 provides the young Korean female subject...',
      'nano-banana-2.1': 'IDENTITY LOCK: Keep the exact facial identity...'
    },
    editPromptEn: 'Normalize 2D beauty-app liquify distortions back to natural 85mm camera lens anatomy.'
  }
};

describe('TemplateDirectorPanel UI/UX (4-Pass SOTA Verification)', () => {
  it('Pass 1: renders collapsed progressive-disclosure toggle by default and shows Dual-Candidate Likeness Picker (Seedream 5.0 Pro + Nano Banana 2.1) when occlusion or beauty retouching is detected', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel locale="ko" photoInspection={sampleOcclusionVerdict} />
    );

    expect(html).toContain('data-template-director-panel');
    expect(html).toContain('data-director-expanded="false"');
    expect(html).toContain('data-photo-inspection-banner="needs_cleanup"');
    expect(html).toContain('data-photo-cleanup-mode="inpaint_occlusion"');
    expect(html).toContain('data-photo-dual-candidates');
    expect(html).toContain('data-identity-candidate="seedream-5.0-pro"');
    expect(html).toContain('data-identity-candidate="nano-banana-2.1"');
    expect(html).toContain('후보 A · 부드러운 자연 인상 (Seedream 5.0 Pro)');
    expect(html).toContain('후보 B · 선명한 윤곽 · 가림 정돈 (Nano Banana 2.1)');
    expect(html).toContain('TWINGS가 가려진 부분 정리해서 진행 (+2 크레딧)');
    expect(html).toContain('원본 사진 그대로 쓰기');
    expect(html).toContain('FACE RATIO 36%');
  });

  it('Pass 2: distinguishes free local SeedVR2 optical restoration from paid dual-candidate cleanup and strictly adheres to TWINGS Blue palette (no YAGI red)', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        photoInspection={sampleLowResVerdict}
        initialExpanded={true}
      />
    );

    expect(html).toContain('data-photo-cleanup-mode="restore_detail"');
    expect(html).not.toContain('data-photo-dual-candidates');
    expect(html).toContain('TWINGS 광학 선명도 복원 적용 (무료)');
    expect(html).toContain('#3875C5');
    // Must never contain forbidden YAGI v1.2 red (#ED1E1E) or Tailwind red utility classes
    expect(html.toLowerCase()).not.toContain('#ed1e1e');
    expect(html).not.toContain('bg-red-');
    expect(html).not.toContain('text-red-');
  });

  it('Pass 3: renders Template Baseline Disclosure Card (showing default outfit, makeup, hair, expression + locked elements), Predictive Revision Presets, and recessed tactile reference wells', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        templateId="2026-11-01-90s-interview-batch"
        initialExpanded={true}
        initialChips={[
          { slot: 'outfit', labelKo: '의상', summaryKo: '크림 트위드 자켓' },
          { slot: 'prop', labelKo: '소품', summaryKo: '유리 향수병' }
        ]}
        initialAssistantMessage="의상과 소품 변경을 장면에 반영했습니다."
      />
    );

    // Template Baseline Disclosure Card + Live Customized vs Default State Diff (Pass 2)
    expect(html).toContain('data-template-baseline-card="90s-apgujeong-interview"');
    expect(html).toContain('90년대 압구정 인터뷰 템플릿 · 기본 설정 안내');
    expect(html).toContain('data-baseline-slot="outfit"');
    expect(html).toContain('data-baseline-slot-state="customized"');
    expect(html).toContain('data-baseline-customized-badge="outfit"');
    expect(html).toContain('data-baseline-active-override="outfit"');
    expect(html).toContain('→ 크림 트위드 자켓');
    expect(html).toContain('data-baseline-revert="outfit"');
    expect(html).toContain('data-baseline-slot="makeup"');
    expect(html).toContain('data-baseline-slot="hair"');
    expect(html).toContain('data-baseline-slot="shot_action"');
    expect(html).toContain('data-template-locked-elements');
    expect(html).toContain('94년 레트로 딥 플럼 버건디 매트 립 &amp; 세미 스모키 음영');

    // Predictive Revision Presets grounded in 33+ real creator deliveries
    expect(html).toContain('data-director-predictive-presets');
    expect(html).toContain('data-predictive-preset="makeup-daily-clean"');
    expect(html).toContain('진한 화장 빼고 내 평소 데일리 메이크업 유지');
    expect(html).toContain('data-predictive-preset="makeup-no-pink-blush"');
    expect(html).toContain('data-predictive-preset="outfit-actress-black-dress"');
    expect(html).toContain('data-predictive-preset="framing-bust-breathing-room"');
    expect(html).toContain('data-direct-upload-mode="true"');
    expect(html).toContain('직접 이미지 업로드 · AI가 임의로 변형하지 않고');

    // Reference wells & active summary chips
    expect(html).toContain('data-director-slot="outfit"');
    expect(html).toContain('@Image 2 · 룩 레퍼런스');
    expect(html).toContain('data-director-slot="prop"');
    expect(html).toContain('@Image 3 · 소품 레퍼런스');
    expect(html).toContain('data-director-chip-count');
    expect(html).toContain('크림 트위드 자켓');
    expect(html).toContain('유리 향수병');
    expect(html).toContain('data-director-char-count');
    expect(html).toContain('0/320');
    expect(html).toContain('focus-visible:outline-[#3875C5]');
  });

  it('Pass 4: deduplicates summary chips by slot (including makeup) while preserving distinct shot_action beats', () => {
    const initial = [
      { slot: 'outfit' as const, labelKo: '의상', summaryKo: '블랙 코트' },
      { slot: 'makeup' as const, labelKo: '메이크업', summaryKo: '버건디 매트 립' },
      { slot: 'shot_action' as const, labelKo: '컷 1', summaryKo: '창밖 응시' }
    ];
    const incoming = [
      { slot: 'outfit' as const, labelKo: '의상', summaryKo: '실크 셔츠로 교체' },
      { slot: 'makeup' as const, labelKo: '메이크업', summaryKo: '내 평소 데일리 메이크업' },
      { slot: 'shot_action' as const, labelKo: '컷 2', summaryKo: '카메라 보며 미소' }
    ];

    const merged = upsertSummaryChips(initial, incoming);
    expect(merged).toEqual([
      { slot: 'outfit', labelKo: '의상', summaryKo: '실크 셔츠로 교체' },
      { slot: 'makeup', labelKo: '메이크업', summaryKo: '내 평소 데일리 메이크업' },
      { slot: 'shot_action', labelKo: '컷 1', summaryKo: '창밖 응시' },
      { slot: 'shot_action', labelKo: '컷 2', summaryKo: '카메라 보며 미소' }
    ]);
  });

  it('renders over-retouched beauty-filter normalization advisory (normalize_retouch) with Dual-Candidate Likeness Picker, radiogroup semantics, best-match badge, and original comparison toggle', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        photoInspection={sampleRetouchVerdict}
        originalPhotoUrl="/selfie-original.jpg"
        candidatesLoading={true}
        identityCandidates={[
          { engine: 'seedream-5.0-pro', titleKo: 'A', titleEn: 'A', subtitleKo: '', subtitleEn: '', previewUrl: null, similarityScore: 0.96 },
          { engine: 'nano-banana-2.1', titleKo: 'B', titleEn: 'B', subtitleKo: '', subtitleEn: '', previewUrl: null, similarityScore: 0.91 }
        ]}
      />
    );

    expect(html).toContain('data-photo-cleanup-mode="normalize_retouch"');
    expect(html).toContain('data-photo-reupload-recommendation="beauty_retouch"');
    expect(html).toContain('data-prefer-direct-upload="true"');
    expect(html).toContain('data-photo-reupload-cta');
    expect(html).toContain('다른 정면 사진 직접 다시 올리기 (추천 · AI 얼굴 변형 없음)');
    expect(html).toContain('data-photo-dual-candidates');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-candidate-compare-toggle');
    expect(html).toContain('원본 셀카 대조하기');
    expect(html).toContain('data-candidate-recommended="true"');
    expect(html).toContain('가장 닮은 추천');
    expect(html).toContain('data-candidate-skeleton="seedream-5.0-pro"');
    expect(html).toContain('TWINGS가 자연스러운 카메라 비율·피부 결로 정돈해서 진행 (+2 크레딧)');
    expect(html).toContain('원본 사진 그대로 쓰기');
  });

  it('Pass 3: formats reference file size and MIME extension into tabular spec strings', () => {
    const kbFile = new File([new Uint8Array(145408)], 'look.png', { type: 'image/png' });
    const mbFile = new File([new Uint8Array(1572864)], 'jacket.jpeg', { type: 'image/jpeg' });
    expect(formatReferenceFileSpec(kbFile)).toBe('142 KB · PNG');
    expect(formatReferenceFileSpec(mbFile)).toBe('1.5 MB · JPG');
  });

  it('diagnoses photo suitability and always recommends direct photo re-upload over AI face transformation', () => {
    const clean = diagnosePhotoSuitability([], 0.36);
    expect(clean.isSuitable).toBe(true);
    expect(clean.recommendDirectReupload).toBe(false);
    expect(clean.aiFaceTransformRecommendedByDefault).toBe(false);

    const occluded = diagnosePhotoSuitability(['hand_occlusion'], 0.36);
    expect(occluded.isSuitable).toBe(false);
    expect(occluded.recommendDirectReupload).toBe(true);
    expect(occluded.aiFaceTransformRecommendedByDefault).toBe(false);
    expect(occluded.issueCategory).toBe('occlusion');
    expect(occluded.whyUnsuitableKo).toContain('가림이 감지되었어요');

    const retouched = diagnosePhotoSuitability(['over_retouched_contour'], 0.36);
    expect(retouched.recommendDirectReupload).toBe(true);
    expect(retouched.issueCategory).toBe('beauty_retouch');

    const badFraming = diagnosePhotoSuitability([], 0.16);
    expect(badFraming.recommendDirectReupload).toBe(true);
    expect(badFraming.issueCategory).toBe('angle_or_framing');

    const wideSleeve = diagnosePhotoSuitability(['wide_sleeve_silhouette_risk'], 0.36);
    expect(wideSleeve.recommendDirectReupload).toBe(true);
    expect(wideSleeve.issueCategory).toBe('angle_or_framing');
    expect(wideSleeve.whyUnsuitableKo).toContain('소매');
  });

  it('renders 3-tier video resolution selector (480p Draft · 720p Standard · 1080p Masterpiece) and No-BGM natural SFX notice on video templates', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        templateId="01a195e5-0613-7055-be3d-b5819473596f"
        videoResolutionSpec={{ runtimeSeconds: 10, aspect: '9:16' }}
        initialResolution="480p"
        initialExpanded={true}
      />
    );

    expect(html).toContain('data-video-resolution-tiers');
    expect(html).toContain('data-selected-resolution="480p"');
    expect(html).toContain('data-selected-resolution-credits="154"');
    expect(html).toContain('data-resolution-tier-option="480p"');
    expect(html).toContain('data-resolution-tier-option="720p"');
    expect(html).toContain('data-resolution-tier-option="1080p"');
    expect(html).toContain('data-personal-no-bgm-notice');
    expect(html).toContain('배경음악(BGM) 없이 현장 효과음과 자연스러운 사운드만 담아 제작됩니다.');
    expect(html).toContain('data-predictive-preset="silhouette-slim-arms-collarbone"');
    expect(html).toContain('data-predictive-preset="hair-updo-lowbun-sync"');
    expect(html).toContain('data-predictive-preset="skin-zero-mole-matte"');
  });
});
