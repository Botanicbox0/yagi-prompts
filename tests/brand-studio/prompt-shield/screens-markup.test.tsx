import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dock, type DockProps } from '@/components/brand-studio/dock';
import { initialDraft, withMedium } from '@/components/brand-studio/dock-model';
import { PromptPictureFrame, type ShieldedDockDesign } from '@/components/brand-studio/prompt-pictures';
import { Viewer, type ViewerActions } from '@/components/brand-studio/viewer';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { allowance, copyFor, id, job, output } from '../ui/fixtures';

const SENTINEL = 'Quillwort sentinel 7Q: the violet heron folds a brass map twice';
const noop = () => {};
const actions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
};

function renderViewer(run: StudioJobView, locale: 'ko' | 'en' = 'ko') {
  const out = run.outputs[0] ?? output(1, { kind: 'video' });
  return renderToStaticMarkup(
    <Viewer
      items={[{ type: 'output', output: out, job: { ...run, outputs: [out] } }]}
      index={0}
      copy={copyFor(locale)}
      locale={locale}
      organizationId={id(0xa0)}
      canCreate
      canGenerate
      busy={null}
      notice={null}
      parentOf={() => null}
      onIndex={noop}
      onClose={noop}
      actions={actions}
    />,
  );
}

function renderDock(patch: Partial<DockProps> = {}, locale: 'ko' | 'en' = 'ko') {
  const copy = copyFor(locale);
  return renderToStaticMarkup(
    <Dock
      mode="video"
      organizationId={id(0xa0)}
      draft={{ ...withMedium(initialDraft('image'), 'video'), prompt: '병이 천천히 돈다' }}
      tray={[]}
      labels={[]}
      copy={copy}
      locale={locale}
      allowance={allowance()}
      credits={15}
      busy={false}
      message={null}
      film={null}
      uploading={[]}
      onDraft={noop}
      onTrayUpdate={noop}
      onTrayRemove={noop}
      onSubmit={noop}
      onDropSource={noop}
      onFiles={noop}
      onBrowse={noop}
      onEnhance={noop}
      onUndoEnhance={noop}
      {...patch}
    />,
  );
}

describe('shielded viewer prompt block markup', () => {
  it('renders a 1-page shielded video run with picture frame, data-no-copy, no pager, and no prompt text', () => {
    const run = job(1, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 천천히 돈다',
      finalPrompt: SENTINEL,
      sent: { shielded: true, pages: 1, version: 'ver_1page' },
      architect: true,
      outputs: [output(1, { kind: 'video' })],
    });
    const html = renderViewer(run);
    expect(html).not.toContain(SENTINEL);
    expect(html).toContain('data-prompt-picture=""');
    expect(html).toContain('data-prompt-picture-frame=""');
    expect(html).toContain('data-no-copy=""');
    expect(html).not.toContain('data-prompt-picture-pager');
    expect(html).not.toContain('data-copy-sent');
    expect(html).toContain('data-copy-typed');
    expect(html).toContain('data-copy-prompt');
    expect(html).toContain('병이 천천히 돈다');
  });

  it('renders a 3-page shielded video run with pager buttons and 1 / 3 indicator, and no prompt text', () => {
    const copy = copyFor('ko');
    const run = job(2, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '코발트 향수병',
      finalPrompt: SENTINEL,
      sent: { shielded: true, pages: 3, version: 'ver_3pages' },
      architect: true,
      outputs: [output(2, { kind: 'video' })],
    });
    const html = renderViewer(run);
    expect(html).not.toContain(SENTINEL);
    expect(html).toContain('data-prompt-picture-pager=""');
    expect(html).toContain(`aria-label="${copy.viewer.pagerPrev}" disabled=""`);
    expect(html).toContain(`aria-label="${copy.viewer.pagerNext}"`);
    expect(html).toContain('data-prompt-picture-page="">1 / 3</span>');
  });

  it('renders notEnhanced when sent is null on an unenhanced video run', () => {
    const copy = copyFor('ko');
    const run = job(3, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 돈다',
      finalPrompt: null,
      sent: null,
      architect: false,
      outputs: [output(3, { kind: 'video' })],
    });
    const html = renderViewer(run);
    expect(html).toContain(copy.viewer.notEnhanced);
    expect(html).not.toContain('data-prompt-picture');
    expect(html).not.toContain('data-no-copy');
  });

  it('renders loaded PromptPictureFrame with object URL src, page-only alt, draggable=false, and error/busy states', () => {
    const ko = copyFor('ko');
    const en = copyFor('en');
    const readyKo = renderToStaticMarkup(
      <PromptPictureFrame page={2} total={3} status="ready" url="blob:https://example.test/page-2" copy={ko} onPrev={noop} onNext={noop} />,
    );
    expect(readyKo).toContain('src="blob:https://example.test/page-2"');
    expect(readyKo).toContain('alt="보낸 프롬프트 2/3쪽"');
    expect(readyKo).toContain('draggable="false"');
    expect(readyKo).toContain('data-no-copy=""');
    expect(readyKo).not.toContain(SENTINEL);

    const readyEn = renderToStaticMarkup(
      <PromptPictureFrame page={2} total={3} status="ready" url="blob:https://example.test/page-2" copy={en} onPrev={noop} onNext={noop} />,
    );
    expect(readyEn).toContain('alt="Sent prompt 2/3"');

    const failed = renderToStaticMarkup(
      <PromptPictureFrame page={1} total={1} status="failed" url={null} copy={ko} onRetry={noop} />,
    );
    expect(failed).toContain(ko.viewer.pictureFailed);
    expect(failed).toContain(ko.viewer.pictureRetry);
    expect(failed).toContain('data-prompt-picture-retry=""');

    const busy = renderToStaticMarkup(
      <PromptPictureFrame page={1} total={1} status="busy" url={null} copy={ko} onRetry={noop} />,
    );
    expect(busy).toContain(ko.viewer.pictureBusy);
    expect(busy).not.toContain('data-prompt-picture-retry');
  });
});

describe('shielded dock designed & reuse panel markup', () => {
  it('renders the compact designed panel after 지금 설계하기 while keeping typed words in the textarea', () => {
    const copy = copyFor('ko');
    const design: ShieldedDockDesign = {
      kind: 'token',
      token: 'tok-abc',
      pages: 2,
      typed: '병이 천천히 돈다',
      model: 'seedance-2.5',
    };
    const html = renderDock({ enhanced: design });
    expect(html).toContain('data-studio-designed-panel=""');
    expect(html).toContain('data-designed-source="token"');
    expect(html).toContain(copy.dock.designedHint);
    expect(html).toContain('data-prompt-picture-pager=""');
    expect(html).toContain('1 / 2');
    expect(html).toContain('data-studio-undo-enhance="true"');
    expect(html).not.toContain('data-studio-enhance-now');
    expect(html).toContain('>병이 천천히 돈다</textarea>');
    expect(html).not.toContain(SENTINEL);
  });

  it('renders the compact panel for a reused reviewed video run', () => {
    const copy = copyFor('ko');
    const design: ShieldedDockDesign = {
      kind: 'fromJob',
      jobId: job(5).id,
      pages: 3,
      version: 'ver-reused',
      typed: '병이 천천히 돈다',
      model: 'seedance-2.5',
    };
    const html = renderDock({ enhanced: design });
    expect(html).toContain('data-studio-designed-panel=""');
    expect(html).toContain('data-designed-source="fromJob"');
    expect(html).toContain(copy.dock.designedHint);
    expect(html).toContain('1 / 3');
    expect(html).toContain('data-studio-undo-enhance="true"');
    expect(html).toContain('>병이 천천히 돈다</textarea>');
  });
});
