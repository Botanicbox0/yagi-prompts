import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { EditorV2 } from '@/components/brand-studio/editor-v2/editor-v2';
import { layoutPrepaintScript } from '@/components/brand-studio/editor-v2/layout-store';
import { composeStreamUrl, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import { brandStudioEditorV2ChatOpenFor } from '@/lib/flags';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatEn, studioEditorChatKo } from '@/messages/studio-editor-chat';

const ROOT = process.cwd();
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const ASSET = '40000000-0000-4000-8000-000000000001';
const USER = '11111111-1111-4111-8111-111111111111';

/**
 * Step 0 baselines captured directly on the clean pre-edit `5b0a84aa` checkout (no runtime `git show`
 * dependency so CI / shallow clones pass identically):
 * - `studioEditorTs`: `messages/studio-editor.ts` (LF-normalized) at `5b0a84aa`
 * - `prepaintScriptBar`: `layoutPrepaintScript('bar')` / `<script data-ev-prepaint>` text at `5b0a84aa`
 * - `sampleKo` / `realKo` / `sampleEn` / `realEn`: closed SSR markup hashes at `5b0a84aa`
 * - `pageSamplePropsNoCopy` / `pageRealPropsNoCopy`: closed page.tsx prop hashes at `5b0a84aa`
 */
const STEP0 = {
  studioEditorTs: { sha256: 'dda9c96b853e2ace528b0683f75f9f111b139b4e9d93f49e634a1c573971e356', length: 37344 },
  prepaintScriptBar: { sha256: 'a1073f292f1e1d12350cadf12908959c7f78356cf742afdc3c6d92247695e0aa', length: 1971 },
  sampleKo: { sha256: '9a4e53c120f6d8ff3495a7c7ece64ed434c714bc9b1f37318c5b756d700e1b49', length: 42680 },
  realKo: { sha256: '8a10557cd9693639f08166d9d59b5f7ecabdb39868d395d0401c993940dc159a', length: 14049 },
  sampleEn: { sha256: 'b59965ce85e20c2b28f36effea070dbca00df57377df59e081d2f3a502653c87', length: 43644 },
  realEn: { sha256: 'c08b13c6d454d239ce0641f6db0e4883beaed01ad4a5706f5068e6c80dddc11b', length: 14781 },
  pageSamplePropsNoCopy: { sha256: '13635d4d52f27db308d83b021a9f1d99c9b5d0568b44570579e0cc13354898c9', length: 293 },
  pageRealPropsNoCopy: { sha256: '19aa57fd5e64fbbb088c69e5e23a611f58b2a84b8c97f3ca763a020ebf61dc58', length: 1618 },
} as const;

const SOURCE: EditorSource = {
  key: `a:${ASSET}`,
  kind: 'asset',
  id: ASSET,
  label: 'runway walk.mp4',
  srcUrl: composeStreamUrl(ORG, 'asset', ASSET),
  thumbUrl: '/api/brand-studio/media/thumb.jpg',
  seconds: 5.7,
  durationMs: 5705,
  createdAt: '2026-11-20T10:00:00.000Z',
};

const REAL = {
  organizationId: ORG,
  organizationName: 'Sample Brand',
  canEdit: true,
  sources: [SOURCE],
  sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}`,
};

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/studio/editor',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/components/brand-studio/route-context', () => ({
  studioRouteContext: vi.fn(async () => ({
    viewer: { userId: USER, email: 'member@brand.example' },
    choice: { id: ORG, name: 'Sample Brand', role: 'owner' },
    dict: getDictionary('ko'),
    locale: 'ko',
    access: { staff: false },
    deps: { sql: { query: vi.fn() } },
  })),
}));
vi.mock('@/lib/brand-studio/media-store', () => ({
  createStudioMediaStore: () => ({ url: (key: string) => `/media/${key}` }),
}));
vi.mock('@/lib/brand-studio/open-project-server', () => ({
  loadStudioSpine: vi.fn(async () => null),
}));
vi.mock('@/lib/brand-studio/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/repo')>('@/lib/brand-studio/repo');
  return {
    ...actual,
    assetsOf: vi.fn(async () => [
      { id: ASSET, kind: 'video', role: null, name: 'runway walk.mp4', tags: [], storage_key: 'a.mp4', thumb_key: 'a.jpg', width: 720, height: 1280, duration_ms: 5705, source: 'upload', created_at: new Date('2026-11-20T10:00:00Z') },
    ]),
    jobsOf: vi.fn(async () => []),
    viewsOf: vi.fn(async () => []),
  };
});

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function serializePropsWithoutCopy(props: Record<string, unknown>) {
  const { copy: _copy, ...rest } = props;
  return JSON.stringify({ propKeys: Object.keys(props).sort(), data: rest });
}

function serializeAllProps(props: Record<string, unknown>) {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(props).sort()) {
    sorted[key] = props[key];
  }
  return JSON.stringify(sorted);
}

describe('BRAND_STUDIO_EDITOR_V2_CHAT switch (shared orgListSwitchOpen semantics)', () => {
  it('defaults off, never opens for blank org ids, opens all orgs on empty list or * / all when on, and restricts to listed orgs case-insensitively', () => {
    for (const value of [undefined, '', 'off', 'ON', 'true', '1', ' on']) {
      expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: value })).toBe(false);
    }
    // Blank org id never opens
    for (const blank of [null, undefined, '', '   ']) {
      expect(brandStudioEditorV2ChatOpenFor(blank, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: '*' })).toBe(false);
    }
    // Shared orgListSwitchOpen meaning: on + empty/unset list or */all = every org
    expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on' })).toBe(true);
    expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: '' })).toBe(true);
    expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: '*' })).toBe(true);
    expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: 'ALL' })).toBe(true);

    // Explicit org list restricts to listed orgs (case-insensitive)
    expect(brandStudioEditorV2ChatOpenFor(ORG, { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: OTHER })).toBe(false);
    expect(brandStudioEditorV2ChatOpenFor(ORG.toUpperCase(), { BRAND_STUDIO_EDITOR_V2_CHAT: 'on', BRAND_STUDIO_EDITOR_V2_CHAT_ORGS: ` ${OTHER} , ${ORG} ` })).toBe(true);
  });
});

describe('Step 0 closed-switch parity & open-switch page gate', () => {
  beforeEach(() => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', 'on');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps messages/studio-editor.ts and closed pre-paint script byte-identical to main 5b0a84aa and renders byte-identical SSR markup when closed (with and without nonce)', () => {
    const currentStudioEditor = readFileSync(join(ROOT, 'messages/studio-editor.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect({ sha256: sha(currentStudioEditor), length: currentStudioEditor.length }).toEqual(STEP0.studioEditorTs);

    const prepaintBar = layoutPrepaintScript('bar');
    expect({ sha256: sha(prepaintBar), length: prepaintBar.length }).toEqual(STEP0.prepaintScriptBar);

    const sampleKo = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: null,
      }),
    );
    const realKo = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: REAL,
      }),
    );
    const sampleEn = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorEn,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: null,
      }),
    );
    const realEn = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorEn,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: REAL,
      }),
    );

    expect({ sha256: sha(sampleKo), length: sampleKo.length }).toEqual(STEP0.sampleKo);
    expect({ sha256: sha(realKo), length: realKo.length }).toEqual(STEP0.realKo);
    expect({ sha256: sha(sampleEn), length: sampleEn.length }).toEqual(STEP0.sampleEn);
    expect({ sha256: sha(realEn), length: realEn.length }).toEqual(STEP0.realEn);

    // Closed-org SSR WITH a CSP nonce emits the exact 1,971-char 5b0a84aa pre-paint script (B1)
    // and ZERO Batch 3 attachment controls or draggable material attributes.
    const closedWithNonce = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: REAL,
        nonce: 'closed-parity-nonce',
      }),
    );
    const scriptMatch = closedWithNonce.match(/<script[^>]*data-ev-prepaint=""[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    const emittedScript = scriptMatch![1]!;
    expect({ sha256: sha(emittedScript), length: emittedScript.length }).toEqual(STEP0.prepaintScriptBar);
    expect(closedWithNonce).not.toContain('data-editor-chat-attach');
    expect(closedWithNonce).not.toContain('draggable="true"');
  });

  it('sends zero new chat strings and zero new prop keys in closed-org page data (hashing copy + every prop), and opens realChat + chatCopy only when open', async () => {
    const Page = (await import('@/app/(brand)/brand/studio/editor/page')).default;

    // Closed: exact Step 0 page props AND full serialized props (including copy) have zero new keys or strings
    const closedReal = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement<Record<string, unknown>>;
    const closedSample = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: '1' }) })) as ReactElement<Record<string, unknown>>;

    const realNoCopy = serializePropsWithoutCopy(closedReal.props);
    const sampleNoCopy = serializePropsWithoutCopy(closedSample.props);
    expect({ sha256: sha(realNoCopy), length: realNoCopy.length }).toEqual(STEP0.pageRealPropsNoCopy);
    expect({ sha256: sha(sampleNoCopy), length: sampleNoCopy.length }).toEqual(STEP0.pageSamplePropsNoCopy);

    // Full serialized payload including copy
    const closedRealAll = serializeAllProps(closedReal.props);
    const closedSampleAll = serializeAllProps(closedSample.props);
    expect(Object.keys(closedReal.props).sort()).toEqual([
      'autoDownload',
      'copy',
      'currentEditorHref',
      'exportPath',
      'initialWorkspace',
      'keep',
      'nonce',
      'real',
    ]);
    expect(Object.keys(closedSample.props).sort()).toEqual([
      'autoDownload',
      'copy',
      'currentEditorHref',
      'exportPath',
      'initialWorkspace',
      'nonce',
      'real',
    ]);
    expect('realChat' in closedReal.props).toBe(false);
    expect('chatCopy' in closedReal.props).toBe(false);
    expect('realChat' in closedSample.props).toBe(false);
    expect('chatCopy' in closedSample.props).toBe(false);

    // Every unique new chat string (not already present in main's studioEditor) must be completely absent from closed payloads
    const baselineEditorText = JSON.stringify(studioEditorKo) + JSON.stringify(studioEditorEn);
    const uniqueNewChatStrings = [
      ...Object.values(studioEditorChatKo),
      ...Object.values(studioEditorChatEn),
    ].filter((val) => !baselineEditorText.includes(val));
    expect(uniqueNewChatStrings.length).toBeGreaterThan(20);
    for (const phrase of uniqueNewChatStrings) {
      expect(closedRealAll.includes(phrase), `closedReal leaked "${phrase}"`).toBe(false);
      expect(closedSampleAll.includes(phrase), `closedSample leaked "${phrase}"`).toBe(false);
    }

    // Closed by org list -> identical full serialized payload hash (including copy)
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_CHAT', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_CHAT_ORGS', OTHER);
    vi.stubEnv('BRAND_STUDIO_EDIT_ASSIST', 'on');
    const unlistedReal = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement<Record<string, unknown>>;
    expect(sha(serializeAllProps(unlistedReal.props))).toBe(sha(closedRealAll));

    // Global kill switch BRAND_STUDIO_EDIT_ASSIST=off while org chat is open -> keeps panel open with assistEnabled: false (local fallback, zero fetch)
    const koDict = getDictionary('ko');
    const expectedUploadCopy = {
      errors: koDict.brandStudio.errors,
      unapprovedUpload: koDict.brandStudio.unapprovedUpload,
      uploadFailed: koDict.brandStudio.uploadFailed,
    };
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_CHAT_ORGS', ORG);
    vi.stubEnv('BRAND_STUDIO_EDIT_ASSIST', 'off');
    const killedReal = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement<Record<string, unknown>>;
    expect(killedReal.props.realChat).toEqual({
      userId: USER,
      filmId: 'own',
      assistEnabled: false,
      locale: 'ko',
      uploadCopy: expectedUploadCopy,
    });
    expect(killedReal.props.chatCopy).toBe(koDict.studioEditorChat);

    // Open -> real mode gets realChat ({ userId, filmId, assistEnabled: true, locale, uploadCopy }) + chatCopy; sample mode stays byte-identical to closed!
    vi.stubEnv('BRAND_STUDIO_EDIT_ASSIST', 'on');
    const opened = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement<Record<string, unknown>>;
    expect(opened.props.realChat).toEqual({
      userId: USER,
      filmId: 'own',
      assistEnabled: true,
      locale: 'ko',
      uploadCopy: expectedUploadCopy,
    });
    expect(opened.props.chatCopy).toBe(koDict.studioEditorChat);

    const openedSample = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: '1' }) })) as ReactElement<Record<string, unknown>>;
    expect(sha(serializeAllProps(openedSample.props))).toBe(sha(closedSampleAll));
  });
});
