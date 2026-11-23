import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioApp } from '@/components/brand-studio/studio-app';
import { StudioAllowanceNotice } from '@/components/brand-studio/studio-allowance-notice';
import { SoundStudio } from '@/components/brand-studio/sound/sound-studio';
import { VideoStudioWorkspace } from '@/components/brand-studio/video/workspace';
import { WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG, allowance, asset, copyFor, studioState } from '@/tests/brand-studio/ui/fixtures';

describe('closed & exhausted allowance states across all 4 studios', () => {
  it('Image Studio: shows closed banner + 단일 이용 신청 CTA when closed, and exhausted inline notice with reset date & 추가 크레딧 요청 when exhausted (zero KRW)', () => {
    const dict = getDictionary('ko');
    const copy = copyFor('ko');

    const closedHtml = renderToStaticMarkup(
      <StudioApp
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        copy={copy}
        libraryCopy={dict.studioLibrary}
        layersCopy={dict.studioLayers}
        mode="image"
        initialState={studioState({
          allowance: allowance({ capKrw: 0, usedKrw: 0 }),
          assets: [asset(1)],
        })}
      />,
    );
    expect(closedHtml).toContain('data-studio-allowance-closed');
    expect(closedHtml).toContain('이용 신청');
    expect(closedHtml.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(closedHtml).not.toMatch(/₩|KRW|\d+원/);

    const exhaustedHtml = renderToStaticMarkup(
      <StudioApp
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        copy={copy}
        libraryCopy={dict.studioLibrary}
        layersCopy={dict.studioLayers}
        mode="image"
        initialState={studioState({
          allowance: allowance({ capKrw: 50_000, usedKrw: 50_000 }),
          assets: [asset(1)],
        })}
      />,
    );
    expect(exhaustedHtml).toContain('data-studio-allowance-notice="exhausted"');
    expect(exhaustedHtml).toContain('추가 크레딧 요청');
    expect(exhaustedHtml).toContain('2026-12-01');
    expect(exhaustedHtml).not.toMatch(/₩|KRW|\d+원/);
  });

  it('Video Studio: renders closed & exhausted states with credit reset date and no KRW', () => {
    const dict = getDictionary('ko');
    const closedVideoHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialState={studioState({
          allowance: allowance({ capKrw: 0, usedKrw: 0 }),
          assets: [asset(1)],
        })}
      />,
    );
    expect(closedVideoHtml).toContain('data-studio-allowance-closed');
    expect(closedVideoHtml).toContain('이용 신청');
    expect(closedVideoHtml).not.toMatch(/₩|KRW|\d+원/);

    const exhaustedVideoHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialState={studioState({
          allowance: allowance({ capKrw: 50_000, usedKrw: 50_000 }),
          assets: [asset(1)],
        })}
      />,
    );
    expect(exhaustedVideoHtml).toContain('data-studio-allowance-notice="exhausted"');
    expect(exhaustedVideoHtml).toContain('추가 크레딧 요청');
    expect(exhaustedVideoHtml).toContain('2026-12-01');
    expect(exhaustedVideoHtml).not.toMatch(/₩|KRW|\d+원/);
  });

  it('Sound Studio: renders closed notice + 이용 신청 CTA and exhausted notice + 추가 크레딧 요청 CTA with zero KRW', () => {
    const dict = getDictionary('ko');
    const baseProps = {
      organizationId: ORG,
      locale: 'ko' as const,
      copy: dict.studioSound,
      creditsCopy: dict.brandStudio.credits,
      initialTab: 'music' as const,
      initialTracks: [],
      initialJobs: [],
      maxMode: false,
      canCreate: true,
      audioMaxMb: 20,
      hrefs: {
        page: `/brand/studio/sound?organizationId=${ORG}`,
        compose: `/brand/studio/compose?organizationId=${ORG}`,
        video: `/brand/studio/video?organizationId=${ORG}`,
      },
    };

    const closedSoundHtml = renderToStaticMarkup(
      <SoundStudio
        {...baseProps}
        initialAllowance={allowance({ capKrw: 0, usedKrw: 0 })}
      />,
    );
    expect(closedSoundHtml).toContain('data-studio-allowance-notice="closed"');
    expect(closedSoundHtml).toContain('이용 신청');
    expect(closedSoundHtml).not.toMatch(/₩|KRW|\d+원/);
    // F13: MusicComposer stays visible when capKrw <= 0 so customers can explore presets/brief alongside closed notice.
    expect(closedSoundHtml).toContain('data-sound-composer');

    const exhaustedSoundHtml = renderToStaticMarkup(
      <SoundStudio
        {...baseProps}
        initialAllowance={allowance({ capKrw: 50_000, usedKrw: 50_000 })}
      />,
    );
    expect(exhaustedSoundHtml).toContain('data-studio-allowance-notice="exhausted"');
    expect(exhaustedSoundHtml).toContain('추가 크레딧 요청');
    expect(exhaustedSoundHtml).toContain('2026-12-01');
    expect(exhaustedSoundHtml).not.toMatch(/₩|KRW|\d+원/);
  });

  it('Workflows Studio: renders closed notice + 이용 신청 CTA and exhausted notice + 추가 크레딧 요청 CTA with zero KRW', () => {
    const dict = getDictionary('ko');
    const baseProps = {
      organizationId: ORG,
      locale: 'ko' as const,
      canCreate: true,
      copy: dict.studioWorkflows,
      imageStudioHref: `/brand/studio?organizationId=${ORG}`,
      videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
      assetsHref: `/brand/library?organizationId=${ORG}`,
      initialStarters: [],
      initialWorkflows: [],
      initialPlaybooks: [],
      initialRecentRuns: [],
      initialImageAssets: [],
      initialVideoAssets: [],
      initialImageOutputs: [],
      initialMcpTokens: [],
    };

    const closedWfHtml = renderToStaticMarkup(
      <WorkflowsHub
        {...baseProps}
        initialAllowance={allowance({ capKrw: 0, usedKrw: 0 })}
      />,
    );
    expect(closedWfHtml).toContain('data-studio-allowance-notice="closed"');
    expect(closedWfHtml).toContain('이용 신청');
    expect(closedWfHtml).not.toMatch(/₩|KRW|\d+원/);

    const exhaustedWfHtml = renderToStaticMarkup(
      <WorkflowsHub
        {...baseProps}
        initialAllowance={allowance({ capKrw: 50_000, usedKrw: 50_000 })}
      />,
    );
    expect(exhaustedWfHtml).toContain('data-studio-allowance-notice="exhausted"');
    expect(exhaustedWfHtml).toContain('추가 크레딧 요청');
    expect(exhaustedWfHtml).toContain('2026-12-01');
    expect(exhaustedWfHtml).not.toMatch(/₩|KRW|\d+원/);
  });

  it('StudioAllowanceNotice displays exact needed vs left credits when provided', () => {
    const html = renderToStaticMarkup(
      <StudioAllowanceNotice
        kind="exhausted"
        organizationId={ORG}
        locale="ko"
        neededCredits={40}
        remainingCredits={12}
        resetsOn="2026-12-01"
        surface="studio_image"
      />,
    );
    expect(html).toContain('필요 40');
    expect(html).toContain('남음 12');
    expect(html).toContain('2026-12-01');
    expect(html).toContain('추가 크레딧 요청');
    expect(html).not.toMatch(/원|₩|KRW/);
  });

  it('F9: Dock keeps non-allowance validation message visible when remaining <= 0 and clears allowance error on new message', async () => {
    const { Dock } = await import('@/components/brand-studio/dock');
    const { initialDraft } = await import('@/components/brand-studio/dock-model');
    const copy = copyFor('ko');
    const dict = getDictionary('ko');

    const html = renderToStaticMarkup(
      <Dock
        organizationId={ORG}
        organizationName="아틀리에 모네"
        mode="image"
        draft={initialDraft('image')}
        tray={[]}
        labels={[]}
        copy={copy}
        locale="ko"
        billingCopy={dict.brandBilling.customer}
        allowance={allowance({ capKrw: 50_000, usedKrw: 50_000 })}
        credits={15}
        busy={false}
        message="지원하지 않는 파일입니다"
        errorCode={null}
        film={null}
        uploading={[]}
        onDraft={() => {}}
        onTrayUpdate={() => {}}
        onTrayRemove={() => {}}
        onSubmit={() => {}}
        onDropSource={() => {}}
        onFiles={() => {}}
        onBrowse={() => {}}
        onEnhance={() => {}}
        onUndoEnhance={() => {}}
      />,
    );
    expect(html).toContain('data-studio-allowance-notice="exhausted"');
    expect(html).toContain('지원하지 않는 파일입니다');
  });

  it('Round 2 (2): REAL useDock hook retains allowance_exhausted across atomic setFeedback updates when credits > 0, then clears on unrelated setMessage', async () => {
    const { useDock } = await import('@/components/brand-studio/use-dock');
    const { Dock } = await import('@/components/brand-studio/dock');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { vi } = await import('vitest');
    const dict = getDictionary('ko');
    const copy = copyFor('ko');

    const createJob = vi.fn(async () => ({ ok: false as const, code: 'allowance_exhausted' as const }));
    const studioMock = {
      films: {},
      createJob,
      createGroup: vi.fn(async () => ({ ok: false as const, code: 'allowance_exhausted' as const })),
      enhancePrompt: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    } as unknown as Parameters<typeof useDock>[0]['studio'];

    const exposeRef: { current: ReturnType<typeof useDock> | null } = { current: null };
    function RealDockHarness() {
      const dock = useDock({
        studio: studioMock,
        copy,
        organizationId: ORG,
        initialMedium: 'image',
      });
      exposeRef.current = dock;
      return (
        <Dock
          organizationId={ORG}
          organizationName="아틀리에 모네"
          mode="image"
          draft={dock.draft}
          tray={dock.tray}
          labels={[]}
          copy={copy}
          locale="ko"
          billingCopy={dict.brandBilling.customer}
          allowance={allowance({ capKrw: 50_000, usedKrw: 45_000 })}
          credits={15}
          busy={dock.busy}
          message={dock.message}
          errorCode={dock.errorCode}
          notice={dock.notice}
          film={null}
          uploading={[]}
          onDraft={dock.setDraft}
          onTrayUpdate={dock.update}
          onTrayRemove={dock.remove}
          onSubmit={() => {
            void dock.submit();
          }}
          onDropSource={() => {}}
          onFiles={() => {}}
          onBrowse={() => {}}
          onEnhance={dock.enhanceNow}
          onUndoEnhance={dock.undoEnhance}
        />
      );
    }

    const dom = await mountDom(<RealDockHarness />);
    try {
      await dom.setValue('textarea', '향수병 제품 스튜디오 컷');
      await dom.submit('form');
      expect(createJob).toHaveBeenCalledTimes(1);
      expect(exposeRef.current?.errorCode).toBe('allowance_exhausted');
      expect(dom.query('[data-studio-allowance-notice="exhausted"]')).toBeTruthy();
      expect(dom.container.textContent).toContain('추가 크레딧 요청');
      expect(dom.query('[data-studio-dock-message]')).toBeNull();

      // Later unrelated validation message clears the allowance notice atomically
      const { act } = await import('react');
      await act(async () => {
        exposeRef.current?.setMessage('지원하지 않는 파일 형식입니다');
      });
      expect(exposeRef.current?.errorCode).toBeNull();
      expect(dom.query('[data-studio-allowance-notice="exhausted"]')).toBeNull();
      expect(dom.query('[data-studio-dock-message]')?.textContent).toContain('지원하지 않는 파일 형식입니다');
    } finally {
      await dom.unmount();
    }
  });

  it('F9 & F11: Interactive SoundStudio music.design allowance_closed -> renders StudioAllowanceNotice, and clicking CTA opens BillingRequestDialog', async () => {
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { vi } = await import('vitest');
    const dict = getDictionary('ko');

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.operation === 'music.design') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ ok: false, code: 'allowance_closed' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const dom = await mountDom(
      <SoundStudio
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        copy={dict.studioSound}
        creditsCopy={dict.brandStudio.credits}
        billingCopy={dict.brandBilling.customer}
        initialTab="music"
        initialTracks={[]}
        initialJobs={[]}
        maxMode={false}
        canCreate
        audioMaxMb={20}
        initialAllowance={allowance({ capKrw: 50_000, usedKrw: 10_000 })}
        hrefs={{
          page: `/brand/studio/sound?organizationId=${ORG}`,
          compose: `/brand/studio/compose?organizationId=${ORG}`,
          video: `/brand/studio/video?organizationId=${ORG}`,
        }}
      />,
    );

    try {
      await dom.setValue('[data-sound-prompt]', '미니멀 피아노 런웨이 테마');
      if (dom.query('[data-sound-architect]')?.getAttribute('aria-checked') !== 'true') {
        await dom.click('[data-sound-architect]');
      }
      const designBtn = dom.query('[data-sound-design-now]');
      expect(designBtn).toBeTruthy();
      await dom.click(designBtn!);

      expect(dom.query('[data-studio-allowance-notice="closed"]')).toBeTruthy();
      expect(dom.query('[data-sound-composer-error]')?.textContent ?? '').toBe('');

      const cta = dom.query('[data-studio-allowance-cta]');
      expect(cta).toBeTruthy();
      await dom.click(cta!);
      expect(dom.query('[role="dialog"]')).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
      await dom.unmount();
    }
  });

  it('F9 & F11: Interactive SequenceRail & VideoComposer & ClosedAllowanceBanner handle allowance errors and open request dialog', async () => {
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { vi } = await import('vitest');
    const { SequenceRail } = await import('@/components/brand-studio/video/sequence-rail');
    const { ClosedAllowanceBanner } = await import('@/components/brand-studio/closed-allowance-banner');
    const dict = getDictionary('ko');

    // 1) ClosedAllowanceBanner click -> opens dialog
    const bannerDom = await mountDom(
      <ClosedAllowanceBanner
        organizationId={ORG}
        organizationName="아틀리에 모네"
        dockCopy={dict.brandStudio.dock}
        billingCopy={dict.brandBilling.customer}
        locale="ko"
        surface="studio_image"
      />,
    );
    try {
      expect(bannerDom.query('[role="dialog"]')).toBeNull();
      await bannerDom.click('[data-studio-closed-request]');
      expect(bannerDom.query('[role="dialog"]')).toBeTruthy();
    } finally {
      await bannerDom.unmount();
    }

    // 2) SequenceRail upscale/sfx/music allowance_exhausted -> renders StudioAllowanceNotice
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({
        ok: false,
        code: 'allowance_exhausted',
        allowance: allowance({ capKrw: 50_000, usedKrw: 50_000 }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { emptyComposerProject } = await import('@/lib/brand-studio/compose');
    const railProject = {
      ...emptyComposerProject('9:16'),
      clips: [
        {
          id: 'clip-1',
          label: 'Clip 1',
          sourceKind: 'asset' as const,
          assetId: 'asset-1',
          srcUrl: 'https://cdn.example/clip.mp4',
          durationSec: 5,
          trimStartSec: 0,
          trimEndSec: 5,
          volume: 1,
          muted: false,
        },
      ],
    };
    const railDom = await mountDom(
      <SequenceRail
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        canEdit
        project={railProject}
        railHeight="full"
        selectedClipId="clip-1"
        inspectorTab="upscale"
        audioAssets={[]}
        allowance={allowance({ capKrw: 50_000, usedKrw: 49_000 })}
        billingCopy={dict.brandBilling.customer}
        railCopy={dict.studioVideo.workspace.rail}
        floatingCopy={dict.studioVideo.workspace.floatingBar}
        onHeightChange={() => {}}
        onSelectClip={() => {}}
        onInspectorTabChange={() => {}}
        onProjectChange={() => {}}
        onAttachClipToDock={() => {}}
        onLocalVideoFiles={() => {}}
        onNotice={() => {}}
      />,
    );

    try {
      await railDom.click('[data-inspector-run-upscale]');
      expect(railDom.query('[data-studio-allowance-notice="exhausted"]')).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
      await railDom.unmount();
    }

    // 3) VideoComposer upscale allowance_exhausted -> renders StudioAllowanceNotice
    const { VideoComposer } = await import('@/components/brand-studio/compose/video-composer');
    vi.stubGlobal('fetch', fetchMock);
    const composeDom = await mountDom(
      <VideoComposer
        organizationId={ORG}
        organizationName="아틀리에 모네"
        locale="ko"
        canCreate
        copy={dict.studioCompose}
        billingCopy={dict.brandBilling.customer}
        videoStudioHref={`/brand/studio/video?organizationId=${ORG}`}
        initialAllowance={allowance({ capKrw: 50_000, usedKrw: 49_000 })}
        initialAssets={[]}
        initialVideoOutputs={[]}
        initialToolTab="upscale"
        initialProject={railProject}
      />,
    );
    try {
      await composeDom.click('[data-compose-upscale-submit]');
      expect(composeDom.query('[data-studio-allowance-notice="exhausted"]')).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
      await composeDom.unmount();
    }
  });

  it('F9: ReviseForm and ReviseTalk render StudioAllowanceNotice instead of raw text for allowance errors', async () => {
    const { ReviseFormView } = await import('@/components/brand-studio/revise-form');
    const { TalkView } = await import('@/components/brand-studio/revise-talk');
    const { initialReviseState } = await import('@/components/brand-studio/revise-flow');
    const { initialTalkState } = await import('@/components/brand-studio/revise-talk-flow');
    const dict = getDictionary('ko');

    const formHtml = renderToStaticMarkup(
      <ReviseFormView
        state={{ ...initialReviseState(), note: 'allowance_exhausted' }}
        version={2}
        recent={[]}
        uploading={false}
        copy={dict.brandStudio}
        locale="ko"
        organizationId={ORG}
        organizationName="아틀리에 모네"
        billingCopy={dict.brandBilling.customer}
        allowance={allowance({ capKrw: 50_000, usedKrw: 50_000 })}
        onPick={() => {}}
        onPrompt={() => {}}
        onReferences={() => {}}
        onFiles={() => {}}
        resolve={() => null}
        onAccept={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(formHtml).toContain('data-studio-allowance-notice="exhausted"');

    const talkHtml = renderToStaticMarkup(
      <TalkView
        state={{ ...initialTalkState(2), note: 'allowance_closed' }}
        copy={dict.brandStudio}
        locale="ko"
        organizationId={ORG}
        organizationName="아틀리에 모네"
        billingCopy={dict.brandBilling.customer}
        allowance={allowance({ capKrw: 0, usedKrw: 0 })}
        draftClip={false}
        editStudioHref="/brand/studio/compose"
        uploading={false}
        marking={false}
        markable={false}
        onDraft={() => {}}
        onSend={() => {}}
        onChoose={() => {}}
        onResend={() => {}}
        onRemove={() => {}}
        onMake={() => {}}
        onStartOver={() => {}}
        onFiles={() => {}}
        onRemoveAttachment={() => {}}
        onMarkMode={() => {}}
      />,
    );
    expect(talkHtml).toContain('data-studio-allowance-notice="closed"');
  });
});
