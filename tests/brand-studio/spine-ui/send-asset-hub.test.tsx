import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendTransport } from '@/components/brand-rooms/chat/transport';
import type {
  SendFileCard,
  SendFileRef,
  SendMessage,
  SendPerson,
  SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import type { BrandWorkspaceChoice } from '@/lib/brands/workspace/selection';
import type { StudioJobView, StudioState } from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG, asset, id, job, output, studioState } from '../ui/fixtures';
import { pickSendCopy, type ViewerSendProp } from '@/components/brand-send/model';
import { createStudioApi, type StudioApi } from '@/components/brand-studio/api';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import type { BrandAssetHubProps, HubEntry } from '@/components/brand-studio/asset-hub';

const PROJ = id(0x61);
const OUT_1 = output(1).id;
const ASSET_1 = asset(1).id;
const ROOT_1 = id(0x21);
const USER_1 = id(0x31);
const USER_2 = id(0x32);
const USER_3 = id(0x33);

const KO_DICT = getDictionary('ko');
const EN_DICT = getDictionary('en');
const KO = pickSendCopy(KO_DICT);
const EN = pickSendCopy(EN_DICT);

const PEOPLE: SendPerson[] = [
  { id: USER_1, name: '김서아', role: 'owner', me: true },
  { id: USER_2, name: '이하린', role: 'editor', me: false },
  { id: USER_3, name: '박도윤', role: 'viewer', me: false },
];

const hubHostMocks = vi.hoisted(() => ({
  locale: 'ko' as 'ko' | 'en',
  org: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Lumiere',
    role: 'owner' as BrandWorkspaceChoice['role'],
    logoUrl: null as string | null,
    denied: undefined as string[] | undefined,
  } as BrandWorkspaceChoice,
  isAdmin: false,
  studioV2On: true,
  hubVisible: true,
  spineOpen: true,
  sendSwitchesOn: true,
  sendOpenFor: true,
  captureOnly: false,
  capturedProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/library',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary: getDict } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: vi.fn(async () => {
      const dict = getDict(hubHostMocks.locale);
      return {
        viewer: { userId: USER_1, isAdmin: hubHostMocks.isAdmin },
        sql: {},
        verifiedEmail: 'owner@lumiere.test',
        brandHost: true,
        locale: hubHostMocks.locale,
        dict,
        b: dict.brandWorkspace,
      };
    }),
  };
});

vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspaceScope: vi.fn(async () => ({
    choices: [hubHostMocks.org],
    projectOrganizations: {},
  })),
  loadBrandWorkspace: vi.fn(async () => ({
    organizations: [{ id: hubHostMocks.org.id, name: hubHostMocks.org.name, role: hubHostMocks.org.role }],
    projects: [],
  })),
}));

vi.mock('@/lib/brand-studio/brand-projects', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/brand-projects')>(
    '@/lib/brand-studio/brand-projects',
  );
  return {
    ...actual,
    brandProjectSpineOpen: vi.fn(async () => hubHostMocks.spineOpen),
  };
});

vi.mock('@/lib/brand-rooms/members-channel', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-rooms/members-channel')>(
    '@/lib/brand-rooms/members-channel',
  );
  return {
    ...actual,
    brandSendSwitchesOn: () => hubHostMocks.sendSwitchesOn,
    brandSendOpenFor: vi.fn(async () => hubHostMocks.sendOpenFor),
  };
});

vi.mock('@/lib/brand-studio/visibility', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/visibility')>(
    '@/lib/brand-studio/visibility',
  );
  return {
    ...actual,
    assetHubVisible: vi.fn(() => hubHostMocks.hubVisible),
    studioV2Visible: vi.fn(() => true),
  };
});

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandStudioV2Open: () => hubHostMocks.studioV2On,
  };
});

vi.mock('@/components/brand-studio/asset-hub', async () => {
  const actual = await vi.importActual<typeof import('@/components/brand-studio/asset-hub')>(
    '@/components/brand-studio/asset-hub',
  );
  return {
    ...actual,
    BrandAssetHub: (props: BrandAssetHubProps) => {
      hubHostMocks.capturedProps = props as unknown as Record<string, unknown>;
      if (hubHostMocks.captureOnly) {
        return <div data-stub-brand-asset-hub data-has-send={props.send ? 'true' : 'false'} />;
      }
      return <actual.BrandAssetHub {...props} />;
    },
  };
});

import {
  buildHubEntries,
  hubActions,
  hubEntryToSendRef,
} from '@/components/brand-studio/asset-hub-model';
import { BrandAssetHub as BrandAssetHubIsland } from '@/components/brand-studio/asset-hub';
import { HubDetail } from '@/components/brand-studio/asset-hub-tile';

function actionCopy(locale: 'ko' | 'en') {
  const dict = getDictionary(locale);
  const h = dict.studioLibrary.hub;
  return {
    useImage: h.openInImage,
    decorate: dict.brandStudio.gallery.menu.decorate,
    makeVideo: h.openInVideo,
    compose: h.openInCompose,
    reverse: h.reverseVideo,
    share: h.shareReview,
    similar: h.findSimilar,
    edit: dict.studioLibrary.uploads.edit,
  };
}

function stubLibrary(patch: Partial<StudioLibrary> = {}): StudioLibrary {
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
    ...patch,
  };
}

function stubApi(state: StudioState): StudioApi {
  return {
    ...createStudioApi({ organizationId: ORG }),
    loadState: vi.fn(async () => state),
    call: vi.fn(async () => ({ ok: true as const })) as unknown as StudioApi['call'],
  };
}

function makeFile(over: Partial<SendFileCard> = {}): SendFileCard {
  return {
    ref: { kind: 'output', outputId: OUT_1 },
    available: true,
    kind: 'image',
    name: null,
    url: '/api/brand-studio/media/st/pic.png',
    thumbUrl: '/api/brand-studio/media/st/pic-thumb.webp',
    width: 720,
    height: 1280,
    project: { id: PROJ, title: '봄 향수 론칭' },
    ...over,
  };
}

function makeMsg(over: Partial<SendMessage> = {}): SendMessage {
  return {
    id: ROOT_1,
    rootId: ROOT_1,
    parentId: null,
    authorId: USER_2,
    authorName: '이하린',
    mine: false,
    body: '@김서아 에셋 시트 확인 부탁드려요.',
    mentions: [{ id: USER_1, name: '김서아' }],
    createdAt: '2026-11-26T04:40:00.000Z',
    ...over,
  };
}

function makeThread(over: Partial<SendThreadSummary> = {}): SendThreadSummary {
  const root = over.root ?? makeMsg();
  return {
    rootId: root.rootId,
    root,
    file: over.file ?? makeFile(),
    replyCount: 0,
    lastActivityAt: root.createdAt,
    latest: {
      messageId: root.id,
      authorId: root.authorId,
      authorName: root.authorName,
      mine: root.mine,
      line: root.body,
      at: root.createdAt,
    },
    mentioned: true,
    unread: true,
    lastReadAt: null,
    ...over,
  };
}

function mockTransport(over: Partial<SendTransport> = {}): SendTransport {
  return {
    organizationId: ORG,
    file: vi.fn(async (ref: SendFileRef) => ({
      ok: true as const,
      file: makeFile({ ref }),
      threads: [makeThread({ file: makeFile({ ref }) })],
    })),
    inbox: vi.fn(async () => ({ ok: true as const, view: 'all' as const, threads: [], next: null, unread: 0, mentionsUnread: 0 })),
    thread: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
    people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
    post: vi.fn(async () => ({
      ok: true as const,
      message: makeMsg({ id: id(0x28), rootId: id(0x28), mine: true, authorId: USER_1, authorName: '김서아', mentions: [] }),
      thread: makeThread({ rootId: id(0x28) }),
      mentionsDelivered: [],
    })),
    reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    read: vi.fn(async (rootId: string) => ({ ok: true as const, rootId, lastReadAt: '2026-11-26T05:00:00.000Z' })),
    readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    ...over,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountHubDom(node: Parameters<typeof mountDom>[0]): Promise<MountedDom> {
  const dom = await mountDom(null);
  const g = globalThis as unknown as {
    Element?: { prototype: Record<string, unknown> };
    HTMLSelectElement?: { prototype: { childNodes: Array<{ tagName?: string }> } };
  };
  if (g.Element?.prototype && !g.Element.prototype.getAttributeNames) {
    g.Element.prototype.getAttributeNames = function getAttributeNames(this: { attributes?: Record<string, string> }) {
      return Object.keys(this.attributes ?? {});
    };
  }
  const SelectProto = g.HTMLSelectElement?.prototype;
  if (SelectProto && !Object.getOwnPropertyDescriptor(SelectProto, 'options')) {
    Object.defineProperty(SelectProto, 'options', {
      get() {
        return (this as { childNodes: Array<{ tagName?: string }> }).childNodes.filter(
          (c) => c.tagName === 'OPTION',
        );
      },
      configurable: true,
    });
  }
  await dom.rerender(node);
  return dom;
}

const noop = () => undefined;

describe('hubEntryToSendRef & hubActions externalLinkLabel (Batch D)', () => {
  it('maps uploaded assets and studio outputs to SendFileRef, excluding fill strips and compose-1080p', () => {
    const picOut = output(1);
    const vidOut = output(2, { kind: 'video', url: '/v.mp4' });
    const sndOut = output(3, { kind: 'audio', url: '/s.mp3', width: null, height: null, thumbUrl: null });
    const picJob = job(1, { kind: 'image', outputs: [picOut] });
    const vidJob = job(2, { kind: 'video_final', outputs: [vidOut] });
    const sndJob = job(3, { kind: 'music', outputs: [sndOut] });
    const entries = buildHubEntries(
      [
        asset(1),
        asset(2, { kind: 'video', url: '/up.mp4' }),
        asset(3, { kind: 'audio', url: '/up.mp3', width: null, height: null, thumbUrl: null }),
      ],
      [picJob, vidJob, sndJob],
      '생성 결과',
    );

    const byKey = new Map(entries.map((e) => [e.key, e]));
    expect(hubEntryToSendRef(byKey.get(`a:${asset(1).id}`))).toEqual({ kind: 'asset', assetId: asset(1).id });
    expect(hubEntryToSendRef(byKey.get(`a:${asset(2).id}`))).toEqual({ kind: 'asset', assetId: asset(2).id });
    expect(hubEntryToSendRef(byKey.get(`a:${asset(3).id}`))).toEqual({ kind: 'asset', assetId: asset(3).id });
    expect(hubEntryToSendRef(byKey.get(`o:${picOut.id}`), picJob)).toEqual({ kind: 'output', outputId: picOut.id });
    expect(hubEntryToSendRef(byKey.get(`o:${vidOut.id}`), vidJob)).toEqual({ kind: 'output', outputId: vidOut.id });
    expect(hubEntryToSendRef(byKey.get(`o:${sndOut.id}`), sndJob)).toEqual({ kind: 'output', outputId: sndOut.id });

    // Output whose run is NOT loaded returns null (Fix round 5 item 5)
    expect(hubEntryToSendRef(byKey.get(`o:${picOut.id}`))).toBeNull();
    expect(hubEntryToSendRef(byKey.get(`o:${vidOut.id}`), null)).toBeNull();

    // Job exclusions match Viewer
    const outEntry = byKey.get(`o:${picOut.id}`)!;
    expect(hubEntryToSendRef(outEntry, job(10, { kind: 'region_edit', purpose: 'fill', outputs: [picOut] }))).toBeNull();
    expect(hubEntryToSendRef(outEntry, job(11, { kind: 'video', model: 'compose-1080p', outputs: [vidOut] }))).toBeNull();
    expect(hubEntryToSendRef(null)).toBeNull();
  });

  it('renames existing share action to 외부 링크 만들기 only when share already exists (canOpenStudio && canCreate && (image || video))', () => {
    const picEntry = buildHubEntries([asset(1)], [], '생성 결과')[0]!;
    const sndEntry = buildHubEntries([asset(2, { kind: 'audio', url: '/s.mp3', width: null, height: null, thumbUrl: null })], [], '생성 결과')[0]!;

    const baseCopy = actionCopy('ko');
    const withoutExt = hubActions(picEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: baseCopy,
    });
    expect(withoutExt.more.find((a) => a.key === 'share')?.label).toBe(baseCopy.share);

    const ownerPic = hubActions(picEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: baseCopy,
      externalLinkLabel: KO.externalLink,
    });
    expect(ownerPic.more.find((a) => a.key === 'share')).toMatchObject({
      key: 'share',
      label: KO.externalLink,
      marker: 'data-asset-hub-share-review',
    });

    // viewer -> canCreate: false -> NO external link action added
    const viewerPic = hubActions(picEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: false,
      copy: baseCopy,
      externalLinkLabel: KO.externalLink,
    });
    expect(viewerPic.more.find((a) => a.key === 'share')).toBeUndefined();

    // project-only -> canOpenStudio: false -> NO external link action added
    const closedStudioPic = hubActions(picEntry, {
      organizationId: ORG,
      canOpenStudio: false,
      canCreate: true,
      copy: baseCopy,
      externalLinkLabel: KO.externalLink,
    });
    expect(closedStudioPic.more.find((a) => a.key === 'share')).toBeUndefined();

    // audio -> no share today -> NO external link action added
    const ownerAudio = hubActions(sndEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: baseCopy,
      externalLinkLabel: KO.externalLink,
    });
    expect(ownerAudio.more.find((a) => a.key === 'share')).toBeUndefined();
  });
});

describe('HubDetail & BrandAssetHub send integration (Batch D)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('without send: renders byte-identical HubDetail with 검수 · 공유 and no 보내기 / 외부 링크 만들기', () => {
    const pic = asset(1);
    const entry = buildHubEntries([pic], [], '생성 결과')[0]!;
    const acts = hubActions(entry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: actionCopy('ko'),
    });
    const html = renderToStaticMarkup(
      <HubDetail
        entry={entry}
        copy={KO_DICT.studioLibrary}
        name="Perfume shot"
        liked={false}
        main={acts.main}
        more={acts.more}
        onLike={noop}
        onAction={noop}
        onClose={noop}
      />,
    );
    expect(html).not.toContain('data-asset-hub-send');
    expect(html).not.toContain(KO.externalLink);
    expect(html).toContain(KO_DICT.studioLibrary.hub.shareReview);
  });

  it('with send: shows 보내기 for every role (owner, editor, viewer) and audio, and 외부 링크 만들기 only when share already existed', () => {
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: KO };
    const pic = asset(1);
    const snd = asset(2, { kind: 'audio', url: '/s.mp3', width: null, height: null, thumbUrl: null });
    const picOut = output(1);
    const picJob = job(1, { kind: 'image', outputs: [picOut] });
    const entries = buildHubEntries(
      [pic, snd],
      [picJob],
      '생성 결과',
    );
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const picEntry = byKey.get(`a:${pic.id}`)!;
    const sndEntry = byKey.get(`a:${snd.id}`)!;
    const outEntry = byKey.get(`o:${picOut.id}`)!;

    const renderDetail = (
      entry: HubEntry,
      opts: { canCreate: boolean; canOpenStudio?: boolean; job?: StudioJobView | null },
    ) => {
      const acts = hubActions(entry, {
        organizationId: ORG,
        canOpenStudio: opts.canOpenStudio ?? true,
        canCreate: opts.canCreate,
        copy: actionCopy('ko'),
        externalLinkLabel: sendProp.copy.externalLink,
      });
      return renderToStaticMarkup(
        <HubDetail
          entry={entry}
          copy={KO_DICT.studioLibrary}
          name="Item"
          liked={false}
          main={acts.main}
          more={acts.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
          send={sendProp}
          sendJob={opts.job ?? null}
        />,
      );
    };

    // Owner/editor on image asset: both 보내기 and 외부 링크 만들기
    const ownerPicHtml = renderDetail(picEntry, { canCreate: true });
    expect(ownerPicHtml).toContain('data-asset-hub-send');
    expect(ownerPicHtml).toContain(KO.externalLink);
    expect(ownerPicHtml).not.toContain(KO_DICT.studioLibrary.hub.shareReview);

    // Owner/editor on audio: 보내기 YES, 외부 링크 만들기 NO
    const ownerAudioHtml = renderDetail(sndEntry, { canCreate: true });
    expect(ownerAudioHtml).toContain('data-asset-hub-send');
    expect(ownerAudioHtml).not.toContain(KO.externalLink);

    // Viewer (`canCreate: false`): 보내기 YES on both uploaded asset and studio output, 외부 링크 만들기 NO
    const viewerPicHtml = renderDetail(picEntry, { canCreate: false });
    expect(viewerPicHtml).toContain('data-asset-hub-send');
    expect(viewerPicHtml).not.toContain(KO.externalLink);

    const viewerOutHtml = renderDetail(outEntry, { canCreate: false, job: picJob });
    expect(viewerOutHtml).toContain('data-asset-hub-send');
    expect(viewerOutHtml).not.toContain(KO.externalLink);

    // Output whose run is not loaded gets no 보내기 action (Fix round 5 item 5)
    const unloadedJobHtml = renderDetail(outEntry, { canCreate: true, job: null });
    expect(unloadedJobHtml).not.toContain('data-asset-hub-send');

    // Project-only member (`canOpenStudio: false`, `canCreate: true`): 보내기 YES, 외부 링크 만들기 NO
    const noStudioHtml = renderDetail(picEntry, { canCreate: true, canOpenStudio: false });
    expect(noStudioHtml).toContain('data-asset-hub-send');
    expect(noStudioHtml).not.toContain(KO.externalLink);

    // Fill strip / compose-1080p: 보내기 NOT shown even when send is present
    const fillHtml = renderDetail(outEntry, {
      canCreate: true,
      job: job(9, { kind: 'region_edit', purpose: 'fill', outputs: [picOut] }),
    });
    expect(fillHtml).not.toContain('data-asset-hub-send');

    const composeHtml = renderDetail(outEntry, {
      canCreate: true,
      job: job(10, { kind: 'video', model: 'compose-1080p', outputs: [picOut] }),
    });
    expect(composeHtml).not.toContain('data-asset-hub-send');
  });

  it('non-detail cards (orgLogo, VideoProjectSummary film tiles, campaign deliverable links) never open HubDetail or expose 보내기', () => {
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: KO };
    const html = renderToStaticMarkup(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={studioState({ assets: [], jobs: [] })}
        deliverables={[
          {
            id: id(0x91),
            projectId: PROJ,
            projectTitle: 'Winter Campaign',
            title: 'Creator Deliverable',
            kind: 'image',
            url: 'https://media.example/deliv.jpg',
            createdAt: '2026-11-26T00:00:00Z',
          },
        ]}
        deliverableCount={1}
        projectLinks={{ self: [], team: [] }}
        spine={{
          overview: {
            ok: true,
            projects: [
              {
                project: { id: PROJ, title: 'Brand Film', origin: 'self', lastActivityAt: '2026-11-26T00:00:00Z' },
                counts: { image: 0, video: 0, sound: 0, upload: 0, film: 1 },
                covers: [],
              },
            ],
            brandMaterials: {
              count: 0,
              byRole: { logo: 0, product: 0, person: 0, style: 0, place: 0 },
              covers: [],
            },
            unfiled: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
          },
          canMove: true,
          copy: KO_DICT.projectSpine,
          filmMeta: KO_DICT.studioVideo.workspace.projects.meta,
          orgLogo: { url: 'https://media.example/logo.png', editHref: '/brand/settings#brand-logo-heading' },
        }}
        initialSpine={{
          tab: 'brand_materials',
          openedScope: { kind: 'brand_materials' },
        }}
        injectedLibrary={stubLibrary()}
        send={sendProp}
      />,
    );
    expect(html).not.toContain('data-asset-hub-send');
    expect(html).not.toContain('data-send-panel');

    const scopedPic = asset(1, { name: 'Scoped Pic.png' });
    const scopedOut = output(1);
    const scopedJob = job(1, { kind: 'image', outputs: [scopedOut] });
    const spineDetailHtml = renderToStaticMarkup(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={studioState({ assets: [], jobs: [] })}
        spine={{
          overview: {
            ok: true,
            projects: [],
            brandMaterials: {
              count: 1,
              byRole: { logo: 0, product: 1, person: 0, style: 0, place: 0 },
              covers: [],
            },
            unfiled: { counts: { image: 1, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
          },
          canMove: true,
          copy: KO_DICT.projectSpine,
          filmMeta: KO_DICT.studioVideo.workspace.projects.meta,
          orgLogo: null,
        }}
        initialSpine={{
          tab: 'unfiled',
          openedScope: { kind: 'unfiled' },
          page: {
            ok: true,
            items: [{ type: 'job', id: scopedJob.id }],
            assets: [scopedPic],
            jobs: [scopedJob],
            films: [],
            next: null,
          },
          detailKey: `o:${scopedOut.id}`,
        }}
        injectedLibrary={stubLibrary()}
        send={sendProp}
      />,
    );
    expect(spineDetailHtml).toContain(`data-asset-hub-detail="o:${scopedOut.id}"`);
    expect(spineDetailHtml).toContain('data-asset-hub-send');
    expect(spineDetailHtml).toContain(KO.externalLink);
  });

  it('opens HubDetail from BrandAssetHub, loads send.file once across parent re-renders, triggers external link action, and layers Escape cleanly (picker -> SendPanel -> HubDetail)', async () => {
    const fileMock = vi.fn(async (ref: SendFileRef) => ({
      ok: true as const,
      file: makeFile({ ref }),
      threads: [makeThread({ file: makeFile({ ref }) })],
    }));
    const transport = mockTransport({ file: fileMock });
    const state0 = studioState({
      canCreate: true,
      assets: [asset(1, { name: '봄 향수 컷.png' })],
      jobs: [],
    });
    const lib0 = stubLibrary();
    const api0 = stubApi(state0);
    const sendProp = { organizationId: ORG, copy: KO, transport };

    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={lib0}
        api={api0}
        send={sendProp}
      />,
    );
    await flush();

    // Open HubDetail by clicking the tile button
    await mounted.click('[data-asset-hub-open]');
    await flush();
    const detail = mounted.query('[data-asset-hub-detail]')!;
    expect(detail).not.toBeNull();
    expect(fileMock).toHaveBeenCalledTimes(0);

    // Click 보내기 -> opens SendPanel in .detailSide and runs send.file ONCE
    const sendBtn = mounted.query('[data-asset-hub-send]')!;
    expect(sendBtn.textContent).toBe(KO.action);
    await mounted.click(sendBtn);
    await flush();

    const panel = mounted.query('[data-send-panel]')!;
    expect(panel).not.toBeNull();
    expect(detail.contains(panel)).toBe(true);
    expect(fileMock).toHaveBeenCalledTimes(1);
    expect(fileMock).toHaveBeenCalledWith({ kind: 'asset', assetId: ASSET_1 });

    // Trigger parent BrandAssetHub re-renders 3 times (search / like / prop rerender)
    const searchInput = mounted.query('[data-asset-hub-search]')!;
    await mounted.setValue(searchInput, '봄');
    await mounted.setValue(searchInput, '');
    await mounted.rerender(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={lib0}
        api={api0}
        send={sendProp}
      />,
    );
    await flush();
    expect(fileMock).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-panel]')).not.toBeNull();

    // Level 1 Escape: close @ picker only
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '@');
    await flush();
    expect(mounted.query('[data-send-picker]')).not.toBeNull();

    await mounted.keyDown('Escape', { target: textarea });
    await act(async () => {
      detail.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();

    // Level 2 Escape: close SendPanel only, focus back on 보내기 button, detail stays open
    await mounted.keyDown('Escape', { target: textarea });
    await act(async () => {
      detail.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();
    expect(mounted.document.activeElement).toBe(sendBtn);

    // Level 3 Escape: after the 100ms browser-cancel suppression window, modal dialog `cancel` closes HubDetail
    await act(async () => {
      vi.advanceTimersByTime(120);
      detail.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    expect(mounted.query('[data-asset-hub-detail]')).toBeNull();

    // Reopen detail and verify "외부 링크 만들기" invokes the existing ShareReviewDialog
    await mounted.click('[data-asset-hub-open]');
    await flush();
    const extBtn = mounted.query('[data-asset-hub-share-review]')!;
    expect(extBtn.textContent).toBe(KO.externalLink);
    await mounted.click(extBtn);
    await flush();
    expect(mounted.query('[data-asset-hub-detail]')).toBeNull();
    expect(mounted.document.querySelector('[data-share-bridge-review-section]')).not.toBeNull();
  });

  it('hides 보내기 on not_found (including reopen) and hides across page on invalid / sign_in_required', async () => {
    const state0 = studioState({
      canCreate: false, // viewer role!
      assets: [asset(1, { name: '첫째.png' }), asset(2, { name: '둘째.png' })],
      jobs: [],
    });
    let failMode: 'not_found' | 'invalid' = 'not_found';
    const fileSpy = vi.fn(async () => ({ ok: false as const, code: failMode }));
    const dynamicTransport = mockTransport({
      file: fileSpy,
    });
    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={stubLibrary()}
        api={stubApi(state0)}
        send={{ organizationId: ORG, copy: KO, transport: dynamicTransport }}
      />,
    );
    await flush();

    // Viewer can open detail for first tile and sees 보내기 (and NO 외부 링크 만들기)
    const openBtns = mounted.queryAll('[data-asset-hub-open]');
    expect(openBtns).toHaveLength(2);
    await mounted.click(openBtns[0]!);
    await flush();
    expect(mounted.query('[data-asset-hub-share-review]')).toBeNull();
    await mounted.click('[data-asset-hub-send]');
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();

    // Close and reopen first tile -> stays hidden
    await act(async () => {
      mounted!
        .query('[data-asset-hub-detail]')!
        .dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    await mounted.click(mounted.queryAll('[data-asset-hub-open]')[0]!);
    await flush();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();

    // Second tile still shows 보내기; invalid closes send across the whole hub
    await act(async () => {
      mounted!
        .query('[data-asset-hub-detail]')!
        .dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    failMode = 'invalid';
    await mounted.click(mounted.queryAll('[data-asset-hub-open]')[1]!);
    await flush();
    expect(mounted.query('[data-asset-hub-send]')).not.toBeNull();
    await mounted.click('[data-asset-hub-send]');
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();

    // Closing detail after invalid and opening another tile renders no send action & 0 send.file requests (Fix round 4 item 3)
    const callsBeforeClose = fileSpy.mock.calls.length;
    await act(async () => {
      mounted!
        .query('[data-asset-hub-detail]')!
        .dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    failMode = 'not_found';
    await mounted.click(mounted.queryAll('[data-asset-hub-open]')[0]!);
    await flush();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();
    expect(fileSpy).toHaveBeenCalledTimes(callsBeforeClose);
  });

  it('ignores Escape during Korean composition, keeps POST not_found panel open until closed, and matches pre-Batch-D hook counts (Fix round 4)', async () => {
    // Source check: exact hook counts recorded from git commit 54079a62 (before Batch D)
    const tileSrc = readFileSync(path.join(process.cwd(), 'components/brand-studio/asset-hub-tile.tsx'), 'utf8');
    const preTile = { useState: 6, useEffect: 2, useLayoutEffect: 0, useRef: 2, useCallback: 0, useMemo: 0, useId: 0 };
    for (const [hook, expected] of Object.entries(preTile)) {
      expect((tileSrc.match(new RegExp(`\\b${hook}\\b`, 'g')) ?? []).length, `asset-hub-tile.tsx ${hook}`).toBe(expected);
    }
    expect(tileSrc).not.toContain('<SendPanel');

    const hubSrc = readFileSync(path.join(process.cwd(), 'components/brand-studio/asset-hub.tsx'), 'utf8');
    const preHub = { useState: 21, useEffect: 0, useLayoutEffect: 0, useRef: 5, useCallback: 3, useMemo: 14, useId: 0 };
    for (const [hook, expected] of Object.entries(preHub)) {
      expect((hubSrc.match(new RegExp(`\\b${hook}\\b`, 'g')) ?? []).length, `asset-hub.tsx ${hook}`).toBe(expected);
    }

    const state0 = studioState({ canCreate: true, assets: [asset(1, { name: '봄.png' })], jobs: [] });
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
      post: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
    });
    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={stubLibrary()}
        api={stubApi(state0)}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );
    await flush();

    await mounted.click('[data-asset-hub-open]');
    await flush();
    await mounted.click('[data-asset-hub-send]');
    await flush();

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '한');

    // Escape while IME composing -> panel and detail stay open, text kept
    await act(async () => {
      textarea.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
      } as never);
    });
    await flush();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();
    expect((textarea as unknown as HTMLTextAreaElement).value).toBe('한');

    // POST not_found keeps panel open with fileGone header, kept text, and disabled submit until user closes
    await mounted.keyDown('Enter', { target: textarea });
    await flush();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect(mounted.query('[data-send-file-gone]')?.textContent).toBe(KO.fileGone);
    expect((textarea as unknown as HTMLTextAreaElement).value).toBe('한');
    expect((mounted.query('[data-send-submit]') as unknown as { disabled?: boolean }).disabled).toBe(true);
    expect(mounted.query('[data-asset-hub-send]')).not.toBeNull();

    await mounted.click('[data-send-panel-close]');
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();

    // Item 6: Escape while IME composing directly on HubDetail dialog (with panel closed) keeps detail open
    const detail = mounted.query('[data-asset-hub-detail]')!;
    await act(async () => {
      detail.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        isComposing: false,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
      } as never);
    });
    await flush();
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();
  });

  it('keeps .detailBody 320px side column / .detailStage sizing unchanged at 1440 and 1920', () => {
    const css = readFileSync(path.join(process.cwd(), 'components/brand-studio/asset-hub.module.css'), 'utf8');
    expect(css).toContain('.detail {');
    expect(css).toContain('width: min(1120px, calc(100vw - 48px));');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 320px;');
  });
});

describe('Server hosting gating for /brand/library (Batch D)', () => {
  beforeEach(() => {
    hubHostMocks.locale = 'ko';
    hubHostMocks.org = { id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null };
    hubHostMocks.isAdmin = false;
    hubHostMocks.studioV2On = true;
    hubHostMocks.hubVisible = true;
    hubHostMocks.spineOpen = true;
    hubHostMocks.sendSwitchesOn = true;
    hubHostMocks.sendOpenFor = true;
    hubHostMocks.captureOnly = true;
    hubHostMocks.capturedProps = null;
  });

  afterEach(() => {
    hubHostMocks.captureOnly = false;
  });

  it('passes send to BrandAssetHub for owner, editor, and viewer when spine + switches + org flag are open; omits for staff, closed org, or guest', async () => {
    const { default: ContentLibrary } = await import('@/app/(brand)/brand/library/page');

    const runCase = async (
      role: BrandWorkspaceChoice['role'],
      opts: { isAdmin?: boolean; spineOpen?: boolean; switchesOn?: boolean; openFor?: boolean } = {},
    ) => {
      hubHostMocks.capturedProps = null;
      hubHostMocks.org = { id: ORG, name: 'Lumiere', role, logoUrl: null };
      hubHostMocks.isAdmin = opts.isAdmin ?? (role === 'studio');
      hubHostMocks.spineOpen = opts.spineOpen ?? true;
      hubHostMocks.sendSwitchesOn = opts.switchesOn ?? true;
      hubHostMocks.sendOpenFor = opts.openFor ?? true;

      const el = await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) });
      renderToStaticMarkup(el as ReactElement);
      return hubHostMocks.capturedProps as BrandAssetHubProps | null;
    };

    const ownerProps = await runCase('owner');
    expect(ownerProps?.send).toMatchObject({ organizationId: ORG, locale: 'ko', copy: { action: KO.action, externalLink: KO.externalLink } });

    hubHostMocks.locale = 'en';
    const enProps = await runCase('owner');
    expect(enProps?.send).toMatchObject({ organizationId: ORG, locale: 'en', copy: { action: EN.action, externalLink: EN.externalLink } });
    hubHostMocks.locale = 'ko';

    const editorProps = await runCase('editor');
    expect(editorProps?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const viewerProps = await runCase('viewer');
    expect(viewerProps?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const staffProps = await runCase('studio', { isAdmin: true });
    expect(staffProps?.send).toBeUndefined();

    const orgClosed = await runCase('owner', { openFor: false });
    expect(orgClosed?.send).toBeUndefined();

    const switchesClosed = await runCase('owner', { switchesOn: false });
    expect(switchesClosed?.send).toBeUndefined();

    const spineClosed = await runCase('owner', { spineOpen: false });
    expect(spineClosed?.send).toBeUndefined();

    const guestProps = await runCase('guest');
    expect(guestProps).toBeNull();
  });
});

describe('Fix round 5 (locale, tile menu externalLink, unloaded job exclusion)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    hubHostMocks.locale = 'en';
    hubHostMocks.org = { id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null };
    hubHostMocks.isAdmin = false;
    hubHostMocks.studioV2On = true;
    hubHostMocks.hubVisible = true;
    hubHostMocks.spineOpen = true;
    hubHostMocks.sendSwitchesOn = true;
    hubHostMocks.sendOpenFor = true;
    hubHostMocks.captureOnly = false;
    hubHostMocks.capturedProps = null;
  });

  afterEach(async () => {
    vi.useRealTimers();
    hubHostMocks.captureOnly = false;
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('uses server-provided send.locale for time words even on an English page with a custom label, and removes copy.label comparison (Item 3)', async () => {
    const tileSrc = readFileSync(path.join(process.cwd(), 'components/brand-studio/asset-hub-tile.tsx'), 'utf8');
    expect(tileSrc).not.toContain('copy.label === "Assets"');

    const { default: ContentLibrary } = await import('@/app/(brand)/brand/library/page');
    hubHostMocks.captureOnly = true;
    const pageEl = await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) });
    renderToStaticMarkup(pageEl as ReactElement);
    hubHostMocks.captureOnly = false;
    const serverSend = (hubHostMocks.capturedProps as BrandAssetHubProps | null)?.send;
    expect(serverSend).toBeTruthy();

    const state0 = studioState({ canCreate: true, assets: [asset(1, { name: 'Bottle.png' })], jobs: [] });
    const transport = mockTransport({
      file: vi.fn(async (ref: SendFileRef) => ({
        ok: true as const,
        file: makeFile({ ref }),
        threads: [makeThread({ file: makeFile({ ref }), lastActivityAt: '2026-11-26T04:40:00.000Z' })],
      })),
    });
    const customEnLibraryCopy = { ...EN_DICT.studioLibrary, label: 'Brand Vault' };

    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={EN_DICT.brandStudio}
        libraryCopy={customEnLibraryCopy}
        initialState={state0}
        injectedLibrary={stubLibrary()}
        api={stubApi(state0)}
        send={{ ...serverSend!, transport }}
      />,
    );
    await flush();

    await mounted.click('[data-asset-hub-open]');
    await flush();
    await mounted.click('[data-asset-hub-send]');
    await flush();

    expect(mounted.container.textContent).toContain('20 minutes ago');
    expect(mounted.container.textContent).not.toContain('20분 전');
  });

  it('uses brandSend.externalLink in tile menus when send is present, leaving without-send tile menus unchanged (Item 4)', async () => {
    const state0 = studioState({ canCreate: true, assets: [asset(1, { name: '향수.png' })], jobs: [] });

    // Without send -> tile menu keeps 검수 · 공유
    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={stubLibrary()}
        api={stubApi(state0)}
      />,
    );
    await flush();
    await mounted.click('[aria-haspopup="menu"]');
    await flush();
    expect(mounted.document.querySelector('[data-asset-hub-share-review]')?.textContent).toBe(
      KO_DICT.studioLibrary.hub.shareReview,
    );

    // With send -> tile menu uses 외부 링크 만들기 (same as detail)
    await mounted.rerender(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={state0}
        injectedLibrary={stubLibrary()}
        api={stubApi(state0)}
        send={{ organizationId: ORG, copy: KO, locale: 'ko', transport: mockTransport() }}
      />,
    );
    await flush();
    expect(mounted.document.querySelector('[data-asset-hub-share-review]')?.textContent).toBe(KO.externalLink);
  });

  it('omits 보내기 in HubDetail rendered from BrandAssetHub when an output job is not loaded (Item 5)', async () => {
    const unloadedOut = output(9, { url: '/api/brand-studio/media/st/unloaded.png' });
    const unloadedJob = job(9, { kind: 'region_edit', purpose: 'fill', outputs: [unloadedOut] });
    const emptyState = studioState({ canCreate: true, assets: [], jobs: [] });

    mounted = await mountHubDom(
      <BrandAssetHubIsland
        organizationId={ORG}
        studioCopy={KO_DICT.brandStudio}
        libraryCopy={KO_DICT.studioLibrary}
        initialState={emptyState}
        spine={{
          overview: {
            ok: true,
            projects: [],
            brandMaterials: { count: 0, byRole: { logo: 0, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
            unfiled: { counts: { image: 1, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
          },
          canMove: false,
          copy: KO_DICT.projectSpine,
          filmMeta: KO_DICT.studioVideo.workspace.projects.meta,
          orgLogo: null,
        }}
        initialSpine={{
          tab: 'unfiled',
          openedScope: { kind: 'unfiled' },
          page: {
            ok: true,
            items: [{ type: 'job', id: unloadedJob.id }],
            assets: [],
            // Entry stored/opened without corresponding job loaded in state or initialSpine lists:
            jobs: [],
            films: [],
            next: null,
          },
          // Simulate an output entry carried over without its job record in loaded jobs:
          detailKey: undefined,
        }}
        injectedLibrary={stubLibrary()}
        api={stubApi(emptyState)}
        send={{ organizationId: ORG, copy: KO, locale: 'ko', transport: mockTransport() }}
      />,
    );
    await flush();

    // Direct HubDetail check when entry is an output without a loaded job:
    const entryWithoutJob = buildHubEntries([], [unloadedJob], '생성 결과')[0]!;
    await mounted.rerender(
      <HubDetail
        entry={entryWithoutJob}
        copy={KO_DICT.studioLibrary}
        name="Result"
        liked={false}
        main={null}
        more={[]}
        onLike={noop}
        onAction={noop}
        onClose={noop}
        send={{ organizationId: ORG, copy: KO, locale: 'ko', transport: mockTransport() }}
        sendJob={null}
      />,
    );
    await flush();
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();
    expect(mounted.query('[data-asset-hub-send]')).toBeNull();
  });

  it('docks composer inside SendPanel with position: sticky in HubDetail without modifying asset-hub.module.css or moving detailSide JSX (Fix round 7)', async () => {
    const a1 = asset(11, { name: '향수컷.png' });
    const entry = buildHubEntries([a1], [], '생성 결과')[0]!;
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    });

    mounted = await mountHubDom(
      <HubDetail
        entry={entry}
        copy={KO_DICT.studioLibrary}
        name="향수컷.png"
        liked={false}
        main={null}
        more={[]}
        onLike={noop}
        onAction={noop}
        onClose={noop}
        send={{ organizationId: ORG, copy: KO, locale: 'ko', transport }}
      />,
    );

    await mounted.click('[data-asset-hub-send]');
    await flush();
    const panel = mounted.query('[data-send-panel]')!;
    const stickyComposer = mounted.query('[data-send-panel] [data-send-panel-composer]')!;
    expect(panel).not.toBeNull();
    expect(mounted.query('[data-asset-hub-upper]')).toBeNull();
    expect(stickyComposer.contains(mounted.query('[data-send-composer]')!)).toBe(true);

    const hubCss = readFileSync(path.join(process.cwd(), 'components/brand-studio/asset-hub.module.css'), 'utf8');
    expect(hubCss).not.toContain('.detailUpper');
    expect(hubCss).not.toContain('.detailSide:has([data-send-panel])');
  });
});
