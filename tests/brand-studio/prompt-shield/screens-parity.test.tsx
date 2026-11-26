import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Dock } from '@/components/brand-studio/dock';
import { buildJob, initialDraft, rerunInput, withMedium } from '@/components/brand-studio/dock-model';
import { trayItemFromAsset, trayLabels } from '@/components/brand-studio/refs';
import { planReuse, type ReuseLookup } from '@/components/brand-studio/reuse-model';
import { useDock } from '@/components/brand-studio/use-dock';
import { Viewer, type ViewerActions } from '@/components/brand-studio/viewer';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom } from '@/tests/brands/_dom-harness';
import { allowance, asset, copyFor, id, job, output } from '../ui/fixtures';

/**
 * Step 0 parity snapshots (captured on the untouched base branch before any screen edits, never regenerated).
 * With today's data shapes (no `sent`, no `architect`), every screen, request and piece of state stays byte-identical.
 */
const snap = (name: string) => `./__snapshots__/screens-closed/${name}`;
const ORG = id(0xa0);
const IDS = { organizationId: ORG, requestId: 'req_parity_0001' };
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

function extractPromptBlock(html: string): string {
  const startToken = '<div class="bs-prompt-block" data-studio-prompt-block="true">';
  const start = html.indexOf(startToken);
  if (start < 0) throw new Error('Prompt block not found in viewer markup');
  let depth = 0;
  let pos = start;
  while (pos < html.length) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      pos = nextClose + 6;
      if (depth === 0) return html.slice(start, pos);
    }
  }
  throw new Error('Unbalanced prompt block in viewer markup');
}

function renderViewerPromptBlock(run: StudioJobView): string {
  const out = run.outputs[0] ?? output(1, { kind: run.kind === 'image' || run.kind === 'region_edit' ? 'image' : 'video' });
  const html = renderToStaticMarkup(
    <Viewer
      items={[{ type: 'output', output: out, job: { ...run, outputs: [out] } }]}
      index={0}
      copy={copyFor('ko')}
      locale="ko"
      organizationId={ORG}
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
  return `${extractPromptBlock(html)}\n`;
}

async function enhanceDockAndSnapshot(medium: 'image' | 'video', promptText: string) {
  const dict = getDictionary('ko');
  const copy = dict.brandStudio;
  const enhancedText = medium === 'image' ? 'Enhanced image sentence for seedream' : 'Enhanced video sentence for seedance';
  const studioMock = {
    films: {},
    createJob: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    createGroup: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    enhancePrompt: vi.fn(async () => ({ ok: true as const, prompt: enhancedText, notes: '', source: 'model' as const })),
  } as unknown as Parameters<typeof useDock>[0]['studio'];

  const ref: { current: ReturnType<typeof useDock> | null } = { current: null };
  function Harness() {
    const dock = useDock({ studio: studioMock, copy, organizationId: ORG, initialMedium: medium, mode: medium });
    ref.current = dock;
    return (
      <Dock
        organizationId={ORG}
        mode={medium}
        draft={dock.draft}
        tray={dock.tray}
        labels={trayLabels(dock.tray, copy)}
        copy={copy}
        locale="ko"
        allowance={allowance()}
        credits={15}
        busy={dock.busy}
        message={dock.message}
        errorCode={dock.errorCode}
        notice={dock.notice}
        film={null}
        uploading={[]}
        enhancing={dock.enhancing}
        enhanced={dock.enhanced}
        onDraft={dock.setDraft}
        onTrayUpdate={dock.update}
        onTrayRemove={dock.remove}
        onSubmit={() => void dock.submit()}
        onDropSource={() => {}}
        onFiles={() => {}}
        onBrowse={() => {}}
        onEnhance={() => void dock.enhanceNow()}
        onUndoEnhance={dock.undoEnhance}
      />
    );
  }

  const dom = await mountDom(<Harness />);
  let captured: {
    draft: ReturnType<typeof useDock>['draft'];
    tray: ReturnType<typeof useDock>['tray'];
    enhanced: ReturnType<typeof useDock>['enhanced'];
    notice: ReturnType<typeof useDock>['notice'];
    message: ReturnType<typeof useDock>['message'];
  };
  try {
    await dom.setValue('textarea', promptText);
    await dom.click('[data-studio-enhance-now]');
    const d = ref.current!;
    captured = { draft: d.draft, tray: d.tray, enhanced: d.enhanced, notice: d.notice, message: d.message };
  } finally {
    await dom.unmount();
  }

  const html = renderToStaticMarkup(
    <Dock
      organizationId={ORG}
      mode={medium}
      draft={captured.draft}
      tray={captured.tray}
      labels={trayLabels(captured.tray, copy)}
      copy={copy}
      locale="ko"
      allowance={allowance()}
      credits={15}
      busy={false}
      message={captured.message}
      notice={captured.notice}
      film={null}
      uploading={[]}
      enhancing={false}
      enhanced={captured.enhanced}
      onDraft={noop}
      onTrayUpdate={noop}
      onTrayRemove={noop}
      onSubmit={noop}
      onDropSource={noop}
      onFiles={noop}
      onBrowse={noop}
      onEnhance={noop}
      onUndoEnhance={noop}
    />,
  );
  return {
    state: `${JSON.stringify({ draft: captured.draft, enhanced: captured.enhanced, notice: captured.notice, message: captured.message }, null, 2)}\n`,
    html: `${html}\n`,
  };
}

describe('Step 0 parity: screens closed (no sent, no architect)', () => {
  it('viewer prompt block snapshots match the base', async () => {
    const imageRun = job(1, { kind: 'image', prompt: '코발트 병', finalPrompt: 'Enhanced prompt 1', outputs: [output(1)] });
    const videoTyped = job(2, { kind: 'video', model: 'seedance-2.5', prompt: '병이 돈다', finalPrompt: null, aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', outputs: [output(2, { kind: 'video' })] });
    const videoDesigned = job(3, { kind: 'video', model: 'seedance-2.5', prompt: '병이 천천히 돈다', finalPrompt: 'Designed video prompt', aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', outputs: [output(3, { kind: 'video' })] });
    const videoReviewed = job(4, { kind: 'video', model: 'seedance-2.5', prompt: '턴테이블 위의 병', finalPrompt: 'Reviewed video prompt', reviewed: true, aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', outputs: [output(4, { kind: 'video' })] });
    const videoRevision = job(5, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '① 더 천천히 돌게',
      finalPrompt: 'Revision video prompt',
      parentOutputId: output(3).id,
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'native',
      revision: { rootJobId: videoDesigned.id, version: 2, baseOutputId: output(3).id, mode: 'reshoot', added: 0 },
      outputs: [output(5, { kind: 'video' })],
    });

    await expect(renderViewerPromptBlock(imageRun)).toMatchFileSnapshot(snap('viewer-image.html'));
    await expect(renderViewerPromptBlock(videoTyped)).toMatchFileSnapshot(snap('viewer-video-typed.html'));
    await expect(renderViewerPromptBlock(videoDesigned)).toMatchFileSnapshot(snap('viewer-video-designed.html'));
    await expect(renderViewerPromptBlock(videoReviewed)).toMatchFileSnapshot(snap('viewer-video-reviewed.html'));
    await expect(renderViewerPromptBlock(videoRevision)).toMatchFileSnapshot(snap('viewer-video-revision.html'));
  });

  it('dock after 지금 설계하기 snapshots match the base', async () => {
    const img = await enhanceDockAndSnapshot('image', '흰 대리석 위 병');
    await expect(img.state).toMatchFileSnapshot(snap('dock-enhance-image.json'));
    await expect(img.html).toMatchFileSnapshot(snap('dock-enhance-image.html'));

    const vid = await enhanceDockAndSnapshot('video', '병이 천천히 돈다');
    await expect(vid.state).toMatchFileSnapshot(snap('dock-enhance-video.json'));
    await expect(vid.html).toMatchFileSnapshot(snap('dock-enhance-video.html'));
  });

  it('requests from buildJob, rerunInput and reuse match the base', async () => {
    const pic = asset(1, { role: 'product', name: 'bottle.png' });
    const picTray = trayItemFromAsset(pic);
    const lookup: ReuseLookup = { asset: (aid) => (aid === pic.id ? pic : null), output: () => null };

    const imgReviewedJob = job(10, {
      kind: 'image',
      model: 'seedream-5.5',
      prompt: '흰 대리석 위 병',
      finalPrompt: 'A cobalt bottle on white marble',
      reviewed: true,
      aspect: '1:1',
      resolution: '2K',
      expected: 1,
      references: [{ assetId: pic.id, role: 'product' }],
    });
    const imgDesignedJob = job(11, { ...imgReviewedJob, reviewed: false });
    const imgReuse = planReuse(imgReviewedJob, { current: initialDraft('image'), lookup, outputName: '결과' });
    const imageRequests = {
      buildPlain: buildJob({ ...initialDraft('image'), prompt: '흰 대리석 위 병' }, [picTray], IDS),
      buildReviewed: buildJob({ ...initialDraft('image'), prompt: 'A cobalt bottle on white marble' }, [picTray], IDS, { ownWords: '흰 대리석 위 병' }),
      rerunDesigned: rerunInput(imgDesignedJob, IDS),
      rerunReviewed: rerunInput(imgReviewedJob, IDS),
      reusePlan: imgReuse,
      reuseBuild: imgReuse.to === 'dock' ? buildJob(imgReuse.draft, imgReuse.tray, IDS, { ownWords: imgReuse.reviewed?.original }) : null,
    };
    await expect(`${JSON.stringify(imageRequests, null, 2)}\n`).toMatchFileSnapshot(snap('requests-image.json'));

    const vidBase = withMedium(initialDraft('image'), 'video');
    const vidTypedJob = job(20, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 돈다',
      finalPrompt: null,
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'native',
      references: [{ assetId: pic.id, frame: 'start' }],
    });
    const vidDesignedJob = job(21, { ...vidTypedJob, finalPrompt: 'Designed video sentence', reviewed: false });
    const vidReviewedJob = job(22, { ...vidTypedJob, finalPrompt: 'Reviewed video sentence', reviewed: true });
    const reuseTyped = planReuse(vidTypedJob, { current: vidBase, lookup, outputName: '결과' });
    const reuseDesigned = planReuse(vidDesignedJob, { current: vidBase, lookup, outputName: '결과' });
    const reuseReviewed = planReuse(vidReviewedJob, { current: vidBase, lookup, outputName: '결과' });
    const videoRequests = {
      buildPlain: buildJob({ ...vidBase, prompt: '병이 돈다' }, [{ ...picTray, frame: 'start' }], IDS),
      buildReviewed: buildJob({ ...vidBase, prompt: 'Reviewed video sentence' }, [{ ...picTray, frame: 'start' }], IDS, { ownWords: '병이 돈다' }),
      rerunTyped: rerunInput(vidTypedJob, IDS),
      rerunDesigned: rerunInput(vidDesignedJob, IDS),
      rerunReviewed: rerunInput(vidReviewedJob, IDS),
      reuseTyped,
      reuseTypedBuild: reuseTyped.to === 'dock' ? buildJob(reuseTyped.draft, reuseTyped.tray, IDS, { ownWords: reuseTyped.reviewed?.original }) : null,
      reuseDesigned,
      reuseDesignedBuild: reuseDesigned.to === 'dock' ? buildJob(reuseDesigned.draft, reuseDesigned.tray, IDS, { ownWords: reuseDesigned.reviewed?.original }) : null,
      reuseReviewed,
      reuseReviewedBuild: reuseReviewed.to === 'dock' ? buildJob(reuseReviewed.draft, reuseReviewed.tray, IDS, { ownWords: reuseReviewed.reviewed?.original }) : null,
    };
    await expect(`${JSON.stringify(videoRequests, null, 2)}\n`).toMatchFileSnapshot(snap('requests-video.json'));
  });
});
