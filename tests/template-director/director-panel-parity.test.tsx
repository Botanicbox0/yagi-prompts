import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';

/**
 * docs/PERSONAL-STUDIO.md §3.1 — with `TWINGS_PERSONAL_EDIT_SHEET` off the page hands the panel no `editSheet`
 * copy, and the panel must render exactly what it rendered before the edit sheet existed. The snapshots were
 * written from the panel as it was on main (`eeab5a23`) before the sheet path was added; a diff here means the
 * flag-off markup moved.
 */
describe('TemplateDirectorPanel without editSheet (flag off) keeps its markup', () => {
  it('collapsed, Korean, no customizations', () => {
    const html = renderToStaticMarkup(<TemplateDirectorPanel locale="ko" />);
    expect(html).not.toContain('data-edit-sheet');
    expect(html).toMatchSnapshot();
  });

  it('expanded with chips, a template and a video spec', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        templateId="2026-11-01-90s-interview-batch"
        videoResolutionSpec={{ runtimeSeconds: 10, aspect: '9:16' }}
        initialExpanded={true}
        initialChips={[
          { slot: 'outfit', labelKo: '의상', summaryKo: '크림 트위드 자켓' },
          { slot: 'shot_action', labelKo: '연출', summaryKo: '마지막 컷에서 미소' }
        ]}
        initialAssistantMessage="의상 변경을 장면에 반영했습니다."
      />
    );
    expect(html).toContain('data-director-summary-chips');
    expect(html).not.toContain('data-edit-sheet');
    expect(html).toMatchSnapshot();
  });

  it('English, image set', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="en"
        medium="image"
        imageSetSpec={{ totalFrames: 5 }}
        initialChips={[{ slot: 'prop', labelKo: '소품', summaryKo: '유리 향수병' }]}
      />
    );
    expect(html).toContain('data-director-summary-chips');
    expect(html).not.toContain('data-edit-sheet');
    expect(html).toMatchSnapshot();
  });
});
