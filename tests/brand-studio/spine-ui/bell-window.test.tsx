import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const navState = vi.hoisted(() => ({
  path: '/brand/studio',
  query: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.query),
}));

const mocks = vi.hoisted(() => ({
  loadRoomBell: vi.fn(),
  readChannel: vi.fn(),
}));

vi.mock('@/components/brand-rooms/chat/transport', () => ({
  loadRoomBell: (...args: unknown[]) => mocks.loadRoomBell(...args),
  brandTransport: (organizationId: string) => ({
    read: (channel: string, at: string) => mocks.readChannel(organizationId, channel, at),
  }),
}));

import { BellProvider } from '@/components/brand-workspace/bell/provider';
import { WorkspaceBell } from '@/components/brand-workspace/bell';
import { pickBellCopy, type BellItem, type BellState } from '@/components/brand-workspace/bell/model';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CANDIDATES = [ORG] as const;

const SCOPE: BrandWorkspaceScope = {
  choices: [{ id: ORG, name: 'Lumiere', role: 'owner', logoUrl: null }],
  projectOrganizations: {},
};

const KO_DICT = getDictionary('ko');
const EN_DICT = getDictionary('en');
const KO_COPY = pickBellCopy(KO_DICT);
const EN_COPY = pickBellCopy(EN_DICT);

function makeItem(over: Partial<BellItem> = {}): BellItem {
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

function fakeBubbleEvent(type: string) {
  return {
    type,
    bubbles: true,
    cancelable: true,
    cancelBubble: false,
    defaultPrevented: false,
    target: null,
    currentTarget: null,
    key: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {
      this.cancelBubble = true;
    },
    stopImmediatePropagation() {
      this.cancelBubble = true;
    },
  };
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

function collectComponentTsxFiles(dir: string): string[] {
  return collectFiles(dir).filter((f) => /\.tsx$/.test(f));
}

describe('WorkspaceBell SSR parity', () => {
  beforeEach(() => {
    navState.path = '/brand/studio';
    navState.query = `organizationId=${ORG}`;
  });

  it('renders nothing without BellProvider or when inactive (야기 팀과 / non-candidate)', () => {
    expect(renderToStaticMarkup(<WorkspaceBell />)).toBe('');

    navState.path = '/brand';
    const teamHtml = renderToStaticMarkup(
      <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={KO_COPY} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    expect(teamHtml).toBe('');
  });

  it('renders closed unloaded button before mount read in ko and en and supports compact size', () => {
    const unloadedHtml = renderToStaticMarkup(
      <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={KO_COPY} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );
    expect(unloadedHtml).toContain('data-bell');
    expect(unloadedHtml).toContain('aria-label="알림"');
    expect(unloadedHtml).toContain('aria-expanded="false"');
    expect(unloadedHtml).not.toContain('data-bell-count');

    const enCompactHtml = renderToStaticMarkup(
      <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={EN_COPY} locale="en">
        <WorkspaceBell size="compact" />
      </BellProvider>,
    );
    expect(enCompactHtml).toContain('data-size="compact"');
    expect(enCompactHtml).toContain('aria-label="Notifications"');
  });
});

describe('WorkspaceBell DOM states, window markup, and interactions', () => {
  let mounted: MountedDom | null = null;

  const mountWithBell = async (
    bell: BellState,
    opts: { locale?: 'ko' | 'en'; size?: 'default' | 'compact' } = {},
  ) => {
    const locale = opts.locale ?? 'ko';
    const copy = locale === 'en' ? EN_COPY : KO_COPY;
    mocks.loadRoomBell.mockResolvedValue({ ok: true, unread: 0, channels: [], alerts: [], bell });
    if (mounted) await mounted.unmount();
    mounted = await mountDom(
      <div>
        <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={copy} locale={locale}>
          <WorkspaceBell size={opts.size} />
        </BellProvider>
        <button type="button" data-outside-btn>
          Outside
        </button>
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return mounted;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    navState.path = '/brand/studio';
    navState.query = `organizationId=${ORG}`;
    mocks.loadRoomBell.mockReset();
    mocks.readChannel.mockReset().mockResolvedValue({ ok: true });
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

  it('renders 0 unread, positive count, and 99+ cap in ko and en through BellProvider + mocked transport', async () => {
    const zeroDom = await mountWithBell({ unread: 0, items: [], more: false });
    expect(zeroDom.query('[data-bell]')?.getAttribute('aria-label')).toBe('알림');
    expect(Boolean(zeroDom.query('[data-bell-count]'))).toBe(false);

    const threeDom = await mountWithBell({ unread: 3, items: [], more: false });
    expect(threeDom.query('[data-bell]')?.getAttribute('aria-label')).toBe('알림 3건');
    expect(threeDom.query('[data-bell-count]')?.textContent).toBe('3');

    const cappedDom = await mountWithBell({ unread: 120, items: [], more: true }, { locale: 'en', size: 'compact' });
    expect(cappedDom.query('[data-bell]')?.getAttribute('data-size')).toBe('compact');
    expect(cappedDom.query('[data-bell]')?.getAttribute('aria-label')).toBe('120 notifications');
    expect(cappedDom.query('[data-bell-count]')?.textContent).toBe('99+');
  });

  it('renders open window with max 20 lines, valid span nesting (no <p> inside <a>), sibling 읽음 처리 in side slot, empty state, and 모두 보기', async () => {
    const twentyFiveItems: BellItem[] = [
      makeItem({
        id: 'sb:1',
        kind: 'storyboard',
        projectId: PROJECT,
        projectTitle: '봄 향수 론칭',
        title: '스토리보드 2안',
        version: 2,
        unread: true,
        thumbUrl: 'https://cdn.example/sb.webp',
        href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=storyboard&board=1`,
      }),
      makeItem({
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
      }),
      makeItem({
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
      }),
      makeItem({
        id: `channel:${PROJECT}`,
        kind: 'conversation',
        projectId: PROJECT,
        projectTitle: '봄 향수 론칭',
        line: '립 컬러는 이 컷이 제일 자연스러워요.',
        unread: true,
        unreadCount: 2,
        thumbUrl: null,
        href: `/brand/rooms?organizationId=${ORG}&channel=${PROJECT}`,
      }),
      makeItem({
        id: 'channel:general',
        kind: 'conversation',
        projectId: null,
        projectTitle: null,
        line: null,
        unread: false,
        unreadCount: 0,
        thumbUrl: null,
        href: `/brand/rooms?organizationId=${ORG}&channel=general`,
      }),
      makeItem({
        id: 'channel:empty-proj',
        kind: 'conversation',
        projectId: '22222222-2222-4222-8222-222222222222',
        projectTitle: '빈 프로젝트',
        line: null,
        unread: false,
        unreadCount: 0,
        thumbUrl: null,
        href: `/brand/rooms?organizationId=${ORG}&channel=22222222-2222-4222-8222-222222222222`,
      }),
      ...Array.from({ length: 19 }, (_, idx) =>
        makeItem({
          id: `extra:${idx}`,
          kind: 'conversation',
          projectId: `33333333-3333-4333-8333-${String(idx).padStart(12, '0')}`,
          projectTitle: `Extra ${idx}`,
          line: `Extra line ${idx}`,
        }),
      ),
    ];

    const dom = await mountWithBell({ unread: 4, items: twentyFiveItems, more: true });
    await dom.click('[data-bell]');

    const win = dom.query('[data-bell-window]');
    expect(win).not.toBeNull();
    expect(win?.getAttribute('role')).toBe('dialog');
    expect(win?.textContent).toContain('알림');
    expect(dom.queryAll('[role="tab"]')).toHaveLength(0);
    expect(win?.textContent).not.toContain('모두 읽음 처리');
    expect(dom.queryAll('video')).toHaveLength(0);

    // Valid HTML nesting: no <p> tags inside <a> links anywhere in the bell window.
    expect(dom.queryAll('[data-bell-window] a p')).toHaveLength(0);

    // Capped at 20 lines
    expect(dom.queryAll('[data-bell-item]')).toHaveLength(20);

    // 40px thumbnail on storyboard + no "읽음 처리" on storyboard/review alerts
    const sbRow = dom.query('[data-bell-item="sb:1"]')!;
    const sbImg = sbRow.querySelector('img');
    expect(sbImg).not.toBeNull();
    expect(sbImg?.getAttribute('width')).toBe('40');
    expect(sbImg?.getAttribute('height')).toBe('40');
    expect(sbImg?.getAttribute('loading')).toBe('lazy');
    expect(sbImg?.getAttribute('decoding')).toBe('async');
    expect(dom.query('[data-bell-mark-read="sb:1"]')).toBeNull();
    expect(dom.query('[data-bell-mark-read="rv:notes"]')).toBeNull();

    // Contract §6 lines & unread conversation badge
    expect(win?.textContent).toContain(interpolate(KO_COPY.alertStoryboard, { version: 2 }));
    expect(win?.textContent).toContain(interpolate(KO_COPY.alertReviewNotes, { version: 3, count: 2 }));
    expect(win?.textContent).toContain(interpolate(KO_COPY.alertReview, { version: 1 }));
    expect(win?.textContent).toContain('립 컬러는 이 컷이 제일 자연스러워요.');
    expect(win?.textContent).toContain('안 읽은 메시지 2개');
    expect(win?.textContent).toContain('일반 문의');
    expect(win?.textContent).toContain(KO_COPY.generalHint);
    expect(win?.textContent).toContain(KO_COPY.noMessages);

    // Unread conversation mark-read button lives inside right-hand column [data-bell-side], NOT inside <a>
    const convRow = dom.query(`[data-bell-item="channel:${PROJECT}"]`)!;
    expect(convRow.getAttribute('data-can-mark')).toBe('true');
    const markBtn = dom.query(`[data-bell-mark-read="channel:${PROJECT}"]`)!;
    expect(markBtn).not.toBeNull();
    expect(markBtn.closest('a')).toBeNull();
    expect(markBtn.closest('[data-bell-side]')).not.toBeNull();
    expect(markBtn.closest('[data-bell-side]')?.querySelector('time')).not.toBeNull();
    expect(dom.query('[data-bell-mark-read="channel:general"]')).toBeNull();

    // Footer links to /brand/rooms?organizationId=... without extra count text when more is true
    const seeAll = dom.query('[data-bell-see-all]')!;
    expect(seeAll.getAttribute('href')).toBe(`/brand/rooms?organizationId=${ORG}`);
    expect(seeAll.getAttribute('data-bell-more')).toBe('true');
    expect(seeAll.textContent).toBe('모두 보기');

    // Empty window in English
    const emptyDom = await mountWithBell({ unread: 0, items: [], more: false }, { locale: 'en' });
    await emptyDom.click('[data-bell]');
    expect(emptyDom.query('[data-bell-empty]')?.textContent).toBe('No new notifications.');
    expect(emptyDom.query('[data-bell-see-all]')?.textContent).toBe('See all');
  });

  it('opens on click, closes on Escape (only Escape returns focus), outside pointerdown, and external focus', async () => {
    const dom = await mountWithBell({
      unread: 1,
      items: [
        makeItem({
          id: `channel:${PROJECT}`,
          projectId: PROJECT,
          projectTitle: '봄 향수 론칭',
          line: '확인 부탁드려요',
          unread: true,
          unreadCount: 1,
        }),
      ],
      more: false,
    });

    const bellBtn = dom.query('[data-bell]')!;
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(false);

    // 1. Click opens; second click closes
    await dom.click(bellBtn);
    const win = dom.query('[data-bell-window]');
    expect(Boolean(win)).toBe(true);
    expect(bellBtn.getAttribute('aria-expanded')).toBe('true');
    expect(bellBtn.getAttribute('aria-controls')).toBe(win!.getAttribute('id'));

    await dom.click(bellBtn);
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(false);

    // 2. Escape closes and returns focus to [data-bell]
    await dom.click(bellBtn);
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(true);
    await dom.keyDown('Escape');
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(false);
    expect(dom.document.activeElement).toBe(bellBtn);

    // 3. Inside pointerdown keeps open; outside pointerdown closes without pulling focus back to [data-bell]
    await dom.click(bellBtn);
    const insideWin = dom.query('[data-bell-window]')!;
    expect(Boolean(insideWin)).toBe(true);
    await act(async () => {
      dom.document.dispatchEvent({ ...fakeBubbleEvent('pointerdown'), target: insideWin } as never);
    });
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(true);

    const outsideBtn = dom.query('[data-outside-btn]')!;
    await act(async () => {
      outsideBtn.focus();
      dom.document.dispatchEvent({ ...fakeBubbleEvent('pointerdown'), target: outsideBtn } as never);
    });
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(false);
    expect(dom.document.activeElement).toBe(outsideBtn);

    // 4. Focus leaving wrapper closes and leaves focus where it moved
    await dom.click(bellBtn);
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(true);
    await act(async () => {
      outsideBtn.focus();
      dom.document.dispatchEvent({ ...fakeBubbleEvent('focusin'), target: outsideBtn } as never);
    });
    expect(Boolean(dom.query('[data-bell-window]'))).toBe(false);
    expect(dom.document.activeElement).toBe(outsideBtn);
  });

  it('calls markRead from the row button without nesting inside <a>, refreshes once, and hides the read button', async () => {
    mocks.loadRoomBell
      .mockResolvedValueOnce({
        ok: true,
        bell: {
          unread: 1,
          items: [
            makeItem({
              id: `channel:${PROJECT}`,
              projectId: PROJECT,
              projectTitle: '봄 향수 론칭',
              line: '메시지 하나',
              unread: true,
              unreadCount: 1,
              at: '2026-11-26T04:10:00.000Z',
            }),
          ],
          more: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        bell: {
          unread: 0,
          items: [
            makeItem({
              id: `channel:${PROJECT}`,
              projectId: PROJECT,
              projectTitle: '봄 향수 론칭',
              line: '메시지 하나',
              unread: false,
              unreadCount: 0,
              at: '2026-11-26T04:10:00.000Z',
            }),
          ],
          more: false,
        },
      });

    mounted = await mountDom(
      <BellProvider candidates={CANDIDATES} scope={SCOPE} rooms bellCopy={KO_COPY} locale="ko">
        <WorkspaceBell />
      </BellProvider>,
    );

    expect(mounted.query('[data-bell-count]')?.textContent).toBe('1');
    await mounted.click('[data-bell]');

    const markBtn = mounted.query(`[data-bell-mark-read="channel:${PROJECT}"]`);
    expect(markBtn).not.toBeNull();
    expect(markBtn!.closest('a')).toBeNull();

    await mounted.click(markBtn!);

    expect(mocks.readChannel).toHaveBeenCalledTimes(1);
    expect(mocks.readChannel).toHaveBeenCalledWith(ORG, PROJECT, '2026-11-26T04:10:00.000Z');
    expect(mocks.loadRoomBell).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-bell-count]')).toBeNull();
    expect(mounted.query(`[data-bell-mark-read="channel:${PROJECT}"]`)).toBeNull();
  });
});

describe('Slice 3a source & CSS invariants across Batch B + C', () => {
  const root = process.cwd();

  it('ensures every exported runtime decision symbol in bell/model.ts and project-cards/model.ts is imported by components', () => {
    const workspaceSources = [
      ...collectComponentTsxFiles(path.join(root, 'components/brand-workspace/bell')).map((f) =>
        readFileSync(f, 'utf8'),
      ),
      ...collectComponentTsxFiles(path.join(root, 'components/brand-workspace/home/project-cards')).map((f) =>
        readFileSync(f, 'utf8'),
      ),
      readFileSync(path.join(root, 'components/brand-workspace/rail-nav.tsx'), 'utf8'),
      readFileSync(path.join(root, 'components/brand-workspace/home/home-view.tsx'), 'utf8'),
      readFileSync(path.join(root, 'app/(brand)/layout.tsx'), 'utf8'),
    ].join('\n');

    for (const modelRel of [
      'components/brand-workspace/bell/model.ts',
      'components/brand-workspace/home/project-cards/model.ts',
    ]) {
      const modelSource = readFileSync(path.join(root, modelRel), 'utf8');
      const runtimeExports = [...modelSource.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map(
        (m) => m[1]!,
      );
      expect(runtimeExports.length).toBeGreaterThan(0);
      for (const symbol of runtimeExports) {
        expect(workspaceSources, `${symbol} from ${modelRel} must be imported/used by components`).toMatch(
          new RegExp(`\\b${symbol}\\b`),
        );
      }
    }
  });

  it('enforces no <video>, timer containment, loadRoomBell exclusivity, 3-size typography, right-hand slot layout, and zero test-only props in bell/', () => {
    const bellDir = path.join(root, 'components/brand-workspace/bell');
    for (const file of collectFiles(bellDir)) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/<video\b/);
      if (path.basename(file) !== 'provider.tsx') {
        expect(src).not.toMatch(/\b(setInterval|setTimeout)\b/);
        expect(src).not.toContain('loadRoomBell');
      }
    }

    const bellModelSrc = readFileSync(path.join(bellDir, 'model.ts'), 'utf8');
    const providerSrc = readFileSync(path.join(bellDir, 'provider.tsx'), 'utf8');
    const bellIndexSrc = readFileSync(path.join(bellDir, 'index.tsx'), 'utf8');
    const layoutSrc = readFileSync(path.join(root, 'app/(brand)/layout.tsx'), 'utf8');

    // Fix round 2 item 6: no test-only props on WorkspaceBell or BellProvider
    expect(providerSrc).not.toMatch(/\binitialBell\b/);
    expect(bellModelSrc).not.toMatch(/initial\?:\s*BellState/);
    expect(bellIndexSrc).not.toMatch(/\binitialOpen\b/);
    expect(bellIndexSrc).not.toMatch(/\bcopy\??:\s*BellCopy/);
    expect(bellIndexSrc).not.toMatch(/\blocale\??:\s*StudioLocale/);
    // Fix round 2 item 4: no <p> tags inside <a> links in WorkspaceBell
    expect(bellIndexSrc).not.toMatch(/<a\b[\s\S]*?<p\b[\s\S]*?<\/a>/);

    // No inline object or array literals passed as JSX props on bell/provider calls
    expect(providerSrc).not.toMatch(/<ActiveBellProvider[^>]*=\{\s*[\[{]/);
    expect(bellIndexSrc).not.toMatch(/<KindGlyph[^>]*=\{\s*[\[{]/);
    expect(layoutSrc).not.toMatch(/<BellProvider[^>]*=\{\s*[\[{]/);

    // Fix round 2 items 3 & 4: strict 3 font sizes (15px, 12.5px, 11.5px) & right-column grid slot (no absolute overlap on .markRead)
    const bellCss = readFileSync(path.join(bellDir, 'bell.module.css'), 'utf8');
    const fontSizes = [...bellCss.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(new Set(fontSizes)).toEqual(new Set(['15px', '12.5px', '11.5px']));
    expect(bellCss).toContain('width: 36px');
    expect(bellCss).toContain('width: 34px');
    expect(bellCss).toContain('width: 380px');
    expect(bellCss).toContain('var(--ys-ink)');
    expect(bellCss).toContain('var(--ys-glass)');
    expect(bellCss).toContain('grid-template-areas');
    expect(bellCss).not.toMatch(/\.markRead\s*\{[^}]*position:\s*absolute/);
    expect(bellCss).toContain(':focus-within');
    expect(bellCss).toContain('prefers-reduced-motion: reduce');
    expect(bellCss).not.toContain('--ys-accent');
    expect(bellCss.toLowerCase()).not.toContain('#ff58ae');
  });

  it('keeps every rule in slice 3a CSS modules pure for Next.js CSS Modules (fix round 3 item 1)', () => {
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');
    const splitCommaOutsideParens = (header: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < header.length; i += 1) {
        const ch = header[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          parts.push(header.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(header.slice(start).trim());
      return parts.filter(Boolean);
    };
    const stripGlobalCalls = (selector: string): string => {
      let out = '';
      let i = 0;
      while (i < selector.length) {
        if (selector.startsWith(':global(', i)) {
          let depth = 1;
          i += ':global('.length;
          while (i < selector.length && depth > 0) {
            if (selector[i] === '(') depth += 1;
            else if (selector[i] === ')') depth -= 1;
            i += 1;
          }
          continue;
        }
        out += selector[i];
        i += 1;
      }
      return out;
    };
    // Approximates css-loader / Next.js CSS Modules selector purity: every selector outside :global(...) must reference at least one local .class or #id.
    const extractSelectorHeaders = (cssText: string): string[] => {
      const headers: string[] = [];
      let i = 0;
      let chunkStart = 0;
      while (i < cssText.length) {
        if (cssText[i] !== '{') {
          i += 1;
          continue;
        }
        const header = cssText.slice(chunkStart, i).trim();
        let depth = 1;
        const bodyStart = i + 1;
        i += 1;
        while (i < cssText.length && depth > 0) {
          if (cssText[i] === '{') depth += 1;
          else if (cssText[i] === '}') depth -= 1;
          i += 1;
        }
        const body = cssText.slice(bodyStart, i - 1);
        chunkStart = i;
        if (header.startsWith('@media')) {
          headers.push(...extractSelectorHeaders(body));
        } else if (header && !header.startsWith('@')) {
          headers.push(header);
        }
      }
      return headers;
    };

    const sliceCssModules = [
      'components/brand-workspace/bell/bell.module.css',
      'components/brand-workspace/home/project-cards/project-cards.module.css',
    ];
    for (const rel of sliceCssModules) {
      const css = stripComments(readFileSync(path.join(root, rel), 'utf8'));
      const headers = extractSelectorHeaders(css);
      expect(headers.length).toBeGreaterThan(0);
      for (const header of headers) {
        for (const selector of splitCommaOutsideParens(header)) {
          const localRemainder = stripGlobalCalls(selector);
          expect(
            localRemainder,
            `${rel}: selector "${selector}" is not pure (must reference at least one local class or id outside :global(...))`,
          ).toMatch(/[.#][A-Za-z_-]/);
        }
      }
    }
  });
});
