import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TemplateDirectorPanel,
  upsertSummaryChips
} from '@/components/twings/template-director-panel';
import type { PhotoInspectionVerdict } from '@/lib/template-director/schema';

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
    editPromptEn: null
  }
};

describe('TemplateDirectorPanel UI/UX (4-Pass SOTA Verification)', () => {
  it('Pass 1: renders collapsed progressive-disclosure toggle by default and shows occlusion cleanup advisory when needed', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel locale="ko" photoInspection={sampleOcclusionVerdict} />
    );

    expect(html).toContain('data-template-director-panel');
    expect(html).toContain('data-director-expanded="false"');
    expect(html).toContain('data-photo-inspection-banner="needs_cleanup"');
    expect(html).toContain('data-photo-cleanup-mode="inpaint_occlusion"');
    expect(html).toContain('TWINGS가 가려진 부분 정리해서 진행 (+2 크레딧)');
    expect(html).toContain('원본 사진 그대로 쓰기');
    expect(html).toContain('FACE RATIO 36%');
  });

  it('Pass 2: distinguishes free local SeedVR2 optical restoration from paid occlusion cleanup and strictly adheres to TWINGS Blue palette (no YAGI red)', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        photoInspection={sampleLowResVerdict}
        initialExpanded={true}
      />
    );

    expect(html).toContain('data-photo-cleanup-mode="restore_detail"');
    expect(html).toContain('TWINGS 광학 선명도 복원 적용 (무료)');
    expect(html).toContain('#3875C5');
    // Must never contain forbidden YAGI v1.2 red (#ED1E1E) or Tailwind red utility classes
    expect(html.toLowerCase()).not.toContain('#ed1e1e');
    expect(html).not.toContain('bg-red-');
    expect(html).not.toContain('text-red-');
  });

  it('Pass 3: renders recessed tactile reference wells (@Image 2 Outfit, @Image 3 Prop), quick preset pills, and active summary chips with accessible hit targets', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        initialExpanded={true}
        initialChips={[
          { slot: 'outfit', labelKo: '의상', summaryKo: '크림 트위드 자켓' },
          { slot: 'prop', labelKo: '소품', summaryKo: '유리 향수병' }
        ]}
        initialAssistantMessage="의상과 소품 변경을 장면에 반영했습니다."
      />
    );

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

  it('Pass 4: deduplicates summary chips by slot while preserving distinct shot_action beats', () => {
    const initial = [
      { slot: 'outfit' as const, labelKo: '의상', summaryKo: '블랙 코트' },
      { slot: 'shot_action' as const, labelKo: '컷 1', summaryKo: '창밖 응시' }
    ];
    const incoming = [
      { slot: 'outfit' as const, labelKo: '의상', summaryKo: '실크 셔츠로 교체' },
      { slot: 'shot_action' as const, labelKo: '컷 2', summaryKo: '카메라 보며 미소' }
    ];

    const merged = upsertSummaryChips(initial, incoming);
    expect(merged).toEqual([
      { slot: 'outfit', labelKo: '의상', summaryKo: '실크 셔츠로 교체' },
      { slot: 'shot_action', labelKo: '컷 1', summaryKo: '창밖 응시' },
      { slot: 'shot_action', labelKo: '컷 2', summaryKo: '카메라 보며 미소' }
    ]);
  });
});
