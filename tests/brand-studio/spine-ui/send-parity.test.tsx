import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trayItemFromAsset } from '@/components/brand-studio/refs';
import type { ReviseSupport } from '@/components/brand-studio/revise-form';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import type { StudioJobView, StudioRevisePlan } from '@/lib/brand-studio/contracts';
import { regionEditModels } from '@/lib/brand-studio/models';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { asset, copyFor, id, job, ORG, output, studioState } from '../ui/fixtures';

/**
 * Slice 4b §2 parity snapshots — generated on the untouched branch before any other edit.
 * NEVER regenerate these snapshots: any later failure means a change broke parity without the new `send` prop.
 */

const navState = vi.hoisted(() => ({
  path: '/brand/studio',
  query: '',
  unread: 0,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.query),
}));

vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({
      summary: null,
      counts: { image: 0, video: 0, sound: 0 },
      toasts: [],
      dismiss: () => {},
    }),
    useRoomUnread: () => navState.unread,
  };
});

const bellMocks = vi.hoisted(() => ({
  loadRoomBell: vi.fn(),
  readChannel: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => bellMocks.loadRoomBell(...args),
  brandTransport: (organizationId: string) => ({
    read: (channel: string, at: string) => bellMocks.readChannel(organizationId, channel, at),
  }),
}));

import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import { buildHubEntries, hubActions, type HubActionCopy } from '@/components/brand-studio/asset-hub-model';
import { HubDetail } from '@/components/brand-studio/asset-hub-tile';
import { Viewer, type RegionSupport, type ViewerActions, type ViewerItem, type ViewerProps } from '@/components/brand-studio/viewer';
import { WorkspaceBell } from '@/components/brand-workspace/bell';
import { pickBellCopy, type BellItem, type BellState } from '@/components/brand-workspace/bell/model';
import { BellProvider } from '@/components/brand-workspace/bell/provider';
import { RailNavigation } from '@/components/brand-workspace/rail-nav';
import type { RailWorkspace } from '@/components/brand-workspace/rail-workspace-menu';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CANDIDATES = [ORG] as const;
const SCOPE: BrandWorkspaceScope = {
  choices: [{ id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null }],
  projectOrganizations: {},
};

const KO_DICT = getDictionary('ko');
const EN_DICT = getDictionary('en');
const KO_BELL_COPY = pickBellCopy(KO_DICT);
const EN_BELL_COPY = pickBellCopy(EN_DICT);

const noop = () => {};
const baseActions: ViewerActions = {
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
const withReviewActions: ViewerActions = {
  ...baseActions,
  decorate: noop,
  review: noop,
};

function renderViewer(items: ViewerItem[], patch: Partial<ViewerProps> = {}, locale: 'ko' | 'en' = 'ko'): string {
  return renderToStaticMarkup(
    <Viewer
      items={items}
      index={0}
      copy={copyFor(locale)}
      locale={locale}
      organizationId={ORG}
      canCreate
      canGenerate
      busy={null}
      notice={null}
      parentOf={() => null}
      onIndex={noop}
      onClose={noop}
      actions={withReviewActions}
      {...patch}
    />,
  );
}

function makeBellItem(over: Partial<BellItem> = {}): BellItem {
  return {
    id: 'channel:general',
    kind: 'conversation',
    projectId: null,
    projectTitle: null,
    title: null,
    line: null,
    version: null,
    openNotes: 0,
    unreadCount: 0,
    at: '2026-11-26T04:00:00.000Z',
    unread: false,
    thumbUrl: null,
    href: `/brand/rooms?organizationId=${ORG}&channel=general`,
    ...over,
  };
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface SerialNode {
  nodeType: number;
  tagName?: string;
  attributes?: Record<string, string>;
  disabled?: boolean;
  _data?: string;
  childNodes?: SerialNode[];
}

function serializeFakeDom(node: SerialNode): string {
  if (node.nodeType === 3) return escapeHtml(node._data ?? '');
  if (node.nodeType !== 1 || !node.tagName) {
    return (node.childNodes ?? []).map(serializeFakeDom).join('');
  }
  const tag = node.tagName.toLowerCase();
  const attrs: Record<string, string> = { ...(node.attributes ?? {}) };
  if (node.disabled && !('disabled' in attrs)) attrs.disabled = '';
  const attrStr = Object.keys(attrs)
    .sort()
    .map((k) => ` ${k}="${escapeAttr(attrs[k]!)}"`)
    .join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}/>`;
  const inner = (node.childNodes ?? []).map(serializeFakeDom).join('');
  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

function stubLibrary(): StudioLibrary {
  return {
    ready: true,
    folders: [],
    liked: new Set(),
    likedItems: [],
    folderItems: () => null,
    openFolder: () => {},
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
  };
}

function actionCopy(locale: 'ko' | 'en'): ActionCopyShape {
  const d = getDictionary(locale);
  const h = d.studioLibrary.hub;
  return {
    useImage: h.openInImage,
    decorate: d.brandStudio.gallery.menu.decorate,
    makeVideo: h.openInVideo,
    compose: h.openInCompose,
    reverse: h.reverseVideo,
    share: h.shareReview,
    similar: h.findSimilar,
    edit: d.studioLibrary.uploads.edit,
  };
}
type ActionCopyShape = HubActionCopy;

describe('Slice 4b §2 parity snapshots (without send prop)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    navState.path = '/brand/studio';
    navState.query = `organizationId=${ORG}`;
    navState.unread = 0;
    bellMocks.loadRoomBell.mockReset();
    bellMocks.readChannel.mockReset().mockResolvedValue({ ok: true });
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('matches untouched Viewer snapshots across image/video/sound, owner/editor/viewer, and review/no-review', async () => {
    const imgOut = output(1);
    const imgJob = job(1, { outputs: [imgOut] });
    const imgAsset = asset(1, { name: 'Hero Bottle', role: 'product' });
    const vidOut = output(2, { kind: 'video', seconds: 6, url: 'https://media.example/st/vid-2.mp4' });
    const vidJob = job(2, { kind: 'video', outputs: [vidOut] });
    const sndOut = output(3, { kind: 'audio', width: null, height: null, seconds: 15, thumbUrl: null, url: 'https://media.example/st/snd-3.mp3' });
    const sndJob = job(3, { kind: 'music', outputs: [sndOut] });
    const sndAsset = asset(2, { kind: 'audio', name: 'BGM Master', width: null, height: null, seconds: 24, thumbUrl: null, url: 'https://media.example/st/snd-a.mp3' });

    await expect(renderViewer([{ type: 'output', output: imgOut, job: imgJob }])).toMatchFileSnapshot(
      './__snapshots__/send-viewer-image-owner-review.html',
    );
    await expect(
      renderViewer([{ type: 'output', output: imgOut, job: imgJob }], { actions: { ...baseActions, decorate: noop } }),
    ).toMatchFileSnapshot('./__snapshots__/send-viewer-image-owner-no-review.html');
    await expect(
      renderViewer([{ type: 'asset', asset: imgAsset }], { canCreate: true, canGenerate: false }),
    ).toMatchFileSnapshot('./__snapshots__/send-viewer-image-editor-review.html');
    await expect(
      renderViewer([{ type: 'output', output: imgOut, job: imgJob }], { canCreate: false, canGenerate: false }),
    ).toMatchFileSnapshot('./__snapshots__/send-viewer-image-viewer.html');
    await expect(renderViewer([{ type: 'output', output: vidOut, job: vidJob }])).toMatchFileSnapshot(
      './__snapshots__/send-viewer-video-owner-review.html',
    );
    await expect(
      renderViewer([{ type: 'output', output: vidOut, job: vidJob }], { canCreate: false, canGenerate: false }),
    ).toMatchFileSnapshot('./__snapshots__/send-viewer-video-viewer.html');
    await expect(renderViewer([{ type: 'output', output: sndOut, job: sndJob }])).toMatchFileSnapshot(
      './__snapshots__/send-viewer-sound-owner-review.html',
    );
    await expect(
      renderViewer([{ type: 'asset', asset: sndAsset }], { canCreate: false, canGenerate: false, actions: baseActions }),
    ).toMatchFileSnapshot('./__snapshots__/send-viewer-sound-viewer.html');
    await expect(renderViewer([{ type: 'output', output: imgOut, job: imgJob }], {}, 'en')).toMatchFileSnapshot(
      './__snapshots__/send-viewer-image-owner-en.html',
    );
  });

  it('matches untouched Viewer snapshot for a video clip with revise conversation open (talk mode)', async () => {
    const vidOut = output(20, { kind: 'video', draft: true, seconds: 6, url: 'https://media.example/st/vid-20.mp4' });
    const vidJob = job(20, { kind: 'video', resolution: 'draft', aspect: '9:16', seconds: 6, audio: 'native', outputs: [vidOut] });
    const html = renderViewer([{ type: 'output', output: vidOut, job: vidJob }], {
      revise: {
        organizationId: ORG,
        jobs: [vidJob],
        recent: [],
        resolve: () => null,
        upload: async () => [],
        plan: async () => ({ ok: false, code: 'failed' }),
        create: async () => ({ ok: true, job: vidJob }),
        dialogue: true,
        talk: {
          organizationId: ORG,
          talk: async () => ({ ok: false, code: 'failed' }),
          create: async () => ({ ok: false, code: 'failed' }),
          upload: async () => ({ added: [], failure: null }),
          editStudioHref: (oId) => `/brand/studio/compose?clip=${oId}`,
        },
      },
    });
    await expect(html).toMatchFileSnapshot('./__snapshots__/send-viewer-video-talk.html');
  });

  it('matches untouched Viewer snapshot for a video clip with two-version strip and revise form', async () => {
    const rootJobId = id(0x2101);
    const v1Out = output(31, { kind: 'video', jobId: rootJobId, width: 720, height: 1280, url: 'https://media.example/st/vid-31.mp4' });
    const v1 = job(31, { id: rootJobId, kind: 'video', aspect: '9:16', resolution: '480p', seconds: 5, audio: 'native', estimateKrw: 3000, outputs: [v1Out] });
    const v2Out = output(32, { kind: 'video', jobId: id(0x2032), width: 720, height: 1280, url: 'https://media.example/st/vid-32.mp4' });
    const v2 = job(32, {
      kind: 'video_remix',
      prompt: '병을 더 크게',
      aspect: '9:16',
      resolution: '480p',
      seconds: 5,
      audio: 'native',
      estimateKrw: 3000,
      revision: { rootJobId, version: 2, baseOutputId: v1Out.id, mode: 'edit', added: 0 },
      outputs: [v2Out],
    });
    const planOk: StudioRevisePlan = {
      ok: true,
      version: 3,
      methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: true, estimateKrw: 4500 } },
      recommended: 'edit',
      reason: null,
    };
    const revise: ReviseSupport = {
      organizationId: ORG,
      jobs: [v2, v1],
      recent: [trayItemFromAsset(asset(1))],
      resolve: () => null,
      upload: async () => [],
      plan: async () => planOk,
      create: async () => ({ ok: true, job: v2 }),
    };
    const html = renderViewer([{ type: 'output', output: v2Out, job: v2 }], { revise });
    await expect(html).toMatchFileSnapshot('./__snapshots__/send-viewer-video-versions-revise.html');
  });

  it('matches untouched Viewer snapshot for an image with region edit open', async () => {
    const parent = output(9);
    const parentJob = job(9, { outputs: [parent] });
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const logo = { ...trayItemFromAsset(asset(5, { role: 'logo' })), role: 'logo' as const };
    const region: RegionSupport = {
      models: regionEditModels(),
      defaultModel: 'nano-banana-pro',
      recent: [trayItemFromAsset(asset(7)), trayItemFromAsset(asset(8))],
      resolve: () => null,
      upload: async () => [],
    };
    const html = renderViewer([{ type: 'output', output: parent, job: parentJob }], {
      region,
      regionPreset: { key: `o:${parent.id}`, box, instruction: '이미지 1 로고를 라벨에', references: [logo] },
    });
    await expect(html).toMatchFileSnapshot('./__snapshots__/send-viewer-image-region-edit.html');
  });

  it('matches untouched Viewer snapshot for an image with sibling switcher (run of four)', async () => {
    const group = { id: 'g-1', models: ['nano-banana-pro', 'seedream-5.5', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] };
    const s1 = job(41, { model: 'nano-banana-pro', group, outputs: [output(41, { jobId: id(0x2041) })] });
    const s2 = job(42, { model: 'seedream-5.5', group, outputs: [output(42, { jobId: id(0x2042) })] });
    const s3 = job(43, { model: 'gpt-image-2.6-flare', group, status: 'failed', errorCode: 'provider_rejected', outputs: [] });
    const s4 = job(44, { model: 'gpt-image-2.6-sunburst', group, outputs: [output(44, { jobId: id(0x2044) })] });
    const siblings: StudioJobView[] = [s1, s2, s3, s4];
    const html = renderViewer([{ type: 'output', output: s1.outputs[0]!, job: s1 }], {
      siblingsOf: () => siblings,
      onOpenOutput: noop,
    });
    await expect(html).toMatchFileSnapshot('./__snapshots__/send-viewer-image-sibling-switcher.html');
  });

  it('matches untouched Bell window snapshots across 3a fixture states', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));

    const ssrClosed = renderToStaticMarkup(
      <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={KO_BELL_COPY} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    await expect(ssrClosed).toMatchFileSnapshot('./__snapshots__/send-bell-ssr-ko.html');

    const mountAndRenderBell = async (
      bell: BellState,
      opts: { locale?: 'ko' | 'en'; size?: 'default' | 'compact'; openWindow?: boolean } = {},
    ) => {
      const locale = opts.locale ?? 'ko';
      const copy = locale === 'en' ? EN_BELL_COPY : KO_BELL_COPY;
      bellMocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 0, channels: [], alerts: [], bell });
      if (mounted) await mounted.unmount();
      mounted = await mountDom(
        <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={copy} locale={locale}>
          <WorkspaceBell size={opts.size} />
        </BellProvider>,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      if (opts.openWindow) {
        await mounted.click('[data-bell]');
      }
      return serializeFakeDom(mounted.container as unknown as SerialNode);
    };

    const itemsState: BellState = {
      unread: 3,
      more: true,
      items: [
        makeBellItem({
          id: 'sb:1',
          kind: 'storyboard',
          projectId: PROJECT,
          projectTitle: '봄 향수 론칭',
          title: '스토리보드 2안',
          version: 2,
          unread: true,
          thumbUrl: 'https://cdn.example/sb.webp',
          href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=storyboard&board=1`,
          at: '2026-11-26T04:45:00.000Z',
        }),
        makeBellItem({
          id: 'rv:notes',
          kind: 'review',
          projectId: PROJECT,
          projectTitle: '데님 룩북 26SS',
          title: '컷 3번 시안',
          version: 3,
          openNotes: 2,
          unread: true,
          thumbUrl: null,
          href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=review&review=2`,
          at: '2026-11-26T04:20:00.000Z',
        }),
        makeBellItem({
          id: 'rv:plain',
          kind: 'review',
          projectId: PROJECT,
          projectTitle: '립 컬렉션 필름',
          title: '시안 1안',
          version: 1,
          openNotes: 0,
          unread: true,
          thumbUrl: null,
          href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=review&review=3`,
          at: '2026-11-26T03:00:00.000Z',
        }),
        makeBellItem({
          id: `channel:${PROJECT}`,
          kind: 'conversation',
          projectId: PROJECT,
          projectTitle: '봄 향수 론칭',
          line: '립 컬러는 이 컷이 제일 자연스러워요.',
          unread: true,
          unreadCount: 2,
          thumbUrl: null,
          href: `/brand/rooms?organizationId=${ORG}&channel=${PROJECT}`,
          at: '2026-11-26T02:30:00.000Z',
        }),
        makeBellItem({
          id: 'channel:general',
          kind: 'conversation',
          projectId: null,
          projectTitle: null,
          line: null,
          unread: false,
          unreadCount: 0,
          thumbUrl: null,
          href: `/brand/rooms?organizationId=${ORG}&channel=general`,
          at: '2026-11-25T10:00:00.000Z',
        }),
      ],
    };

    await expect(await mountAndRenderBell(itemsState, { openWindow: true })).toMatchFileSnapshot(
      './__snapshots__/send-bell-window-items-ko.html',
    );
    await expect(
      await mountAndRenderBell({ unread: 0, items: [], more: false }, { locale: 'ko', openWindow: true }),
    ).toMatchFileSnapshot('./__snapshots__/send-bell-window-empty-ko.html');
    await expect(
      await mountAndRenderBell({ unread: 0, items: [], more: false }, { locale: 'en', openWindow: true }),
    ).toMatchFileSnapshot('./__snapshots__/send-bell-window-empty-en.html');
    await expect(
      await mountAndRenderBell({ unread: 120, items: [], more: true }, { locale: 'en', size: 'compact', openWindow: false }),
    ).toMatchFileSnapshot('./__snapshots__/send-bell-closed-99plus-en.html');
  });

  it('matches untouched RailNavigation snapshots in both modes', async () => {
    const b = KO_DICT.brandWorkspace;
    const railWorkspace: RailWorkspace = {
      currentId: ORG,
      emptyLabel: b.identity.none,
      brands: [{ id: ORG, name: 'Lumiere', logoUrl: null, role: b.roles.owner, href: `/brand/home?organizationId=${ORG}`, staff: false }],
      locale: 'ko',
      copy: {
        current: b.identity.current,
        switch: b.identity.switch,
        staffGroup: b.identity.staffGroup,
        language: KO_DICT.nav.localeToggle,
        signOut: b.signOut,
      },
    };
    const renderRail = (path: string, expanded: boolean) => {
      navState.path = path;
      navState.unread = 3;
      return renderToStaticMarkup(
        <RailNavigation
          organizationId={ORG}
          studio
          creators={false}
          sound
          identity={false}
          team
          billing
          settings
          canCreate
          copy={KO_DICT.studioShell}
          locale="ko"
          initialExpanded={expanded}
          scope={(p) => `${p}?organizationId=${ORG}`}
          rooms
          roomsCopy={KO_DICT.roomsShell.nav}
          home={KO_DICT.brandHome.nav.home}
          workspace={railWorkspace}
        />,
      );
    };

    await expect(renderRail('/brand/studio', true)).toMatchFileSnapshot('./__snapshots__/send-rail-make-expanded.html');
    await expect(renderRail('/brand/studio', false)).toMatchFileSnapshot('./__snapshots__/send-rail-make-collapsed.html');
    await expect(renderRail('/brand', true)).toMatchFileSnapshot('./__snapshots__/send-rail-team-expanded.html');
    await expect(renderRail('/brand', false)).toMatchFileSnapshot('./__snapshots__/send-rail-team-collapsed.html');
  });

  it('matches untouched assets page viewer entry (HubDetail + BrandAssetHub)', async () => {
    const imgAsset = asset(1, { name: 'Serum bottle', role: 'product', tags: ['glass', 'spring'] });
    const audOut = output(3, { kind: 'audio', width: null, height: null, seconds: 12, thumbUrl: null, url: 'https://media.example/st/snd-3.mp3' });
    const imgOut = output(1);
    const entries = buildHubEntries(
      [imgAsset],
      [
        job(1, { prompt: 'Glass serum bottle in morning light', outputs: [imgOut] }),
        job(2, { kind: 'music', prompt: 'Clean ambient track', outputs: [audOut] }),
      ],
      KO_DICT.studioLibrary.hub.sourceGenerated,
    );
    const outEntry = entries.find((e) => e.key === `o:${imgOut.id}`)!;
    const assetEntry = entries.find((e) => e.key === `a:${imgAsset.id}`)!;
    const audioEntry = entries.find((e) => e.key === `o:${audOut.id}`)!;

    const ownerActs = hubActions(outEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: actionCopy('ko') });
    await expect(
      renderToStaticMarkup(
        <HubDetail
          entry={outEntry}
          copy={KO_DICT.studioLibrary}
          name={KO_DICT.studioLibrary.item.image}
          liked={false}
          main={ownerActs.main}
          more={ownerActs.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-asset-hub-detail-output.html');

    const viewerActs = hubActions(assetEntry, { organizationId: ORG, canOpenStudio: true, canCreate: false, copy: actionCopy('ko') });
    await expect(
      renderToStaticMarkup(
        <HubDetail
          entry={assetEntry}
          copy={KO_DICT.studioLibrary}
          name="Serum bottle"
          liked
          main={viewerActs.main}
          more={viewerActs.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-asset-hub-detail-asset.html');

    const audioActs = hubActions(audioEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: actionCopy('ko') });
    await expect(
      renderToStaticMarkup(
        <HubDetail
          entry={audioEntry}
          copy={KO_DICT.studioLibrary}
          name={KO_DICT.studioLibrary.item.audio}
          liked={false}
          main={audioActs.main}
          more={audioActs.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-asset-hub-detail-audio.html');

    const hubState = studioState({
      assets: [imgAsset],
      jobs: [job(1, { prompt: 'Glass serum bottle in morning light', outputs: [imgOut] })],
    });
    await expect(
      renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={KO_DICT.brandStudio}
          libraryCopy={KO_DICT.studioLibrary}
          initialState={hubState}
          injectedLibrary={stubLibrary()}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-asset-hub-entry.html');
  });
});
