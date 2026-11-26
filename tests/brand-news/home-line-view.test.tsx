import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import { HomeNewsLine } from '@/components/brand-workspace/home/news-line';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards';
import { BRAND_NEWS_LIMITS, type HomeAnnouncement } from '@/lib/brand-news/contracts';
import type { StudioBrandProjectCard } from '@/lib/brand-studio/contracts';
import { homeLayout, type HomeLayout } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const NEWS_ID = '33333333-3333-4333-8333-333333333333';

const legacyCopyOf = (locale: 'ko' | 'en'): WorkspaceHomeProps['copy'] => {
  const d = getDictionary(locale);
  return {
    home: d.brandHome,
    shell: d.studioShell,
    roomsNav: d.roomsShell.nav,
    inbox: d.roomsChat.inbox,
    prompt: {
      label: d.brandStudio.dock.label,
      placeholder: { image: d.brandStudio.dock.placeholder, video: d.brandStudio.dock.placeholderVideo },
    },
    activeStatus: d.brandWorkspace.status.active,
    allAssets: d.studioLibrary.allAssets,
    closedRequestDraft: d.brandStudio.dock.closedRequestDraft,
    closedRequestOrgFallback: d.brandStudio.dock.closedRequestOrgFallback,
    billingCustomer: d.brandBilling.customer,
    brandNews: d.brandNews,
  };
};

const spineCopyOf = (locale: 'ko' | 'en'): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
  const d = getDictionary(locale);
  return {
    ...legacyCopyOf(locale),
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const layoutOf = (role: 'owner' | 'viewer' = 'owner'): HomeLayout =>
  homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role === 'owner', rooms: true })!;

const SAMPLE_CARD: StudioBrandProjectCard = {
  project: { id: '10000000-0000-4000-8000-000000000001', title: '봄 향수 론칭', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
  counts: { image: 4, video: 0, sound: 0, upload: 0, film: 0 },
  covers: [],
  lastActivity: null,
  unread: 0,
  stage: null,
};

const sampleNews = (over: Partial<HomeAnnouncement> = {}): HomeAnnouncement => ({
  id: NEWS_ID,
  kicker: null,
  title: '영상 스튜디오에서 참고 영상으로 바로 시작할 수 있습니다',
  ctaLabel: null,
  href: `/brand/studio/video?start=reverse&organizationId=${ORG}`,
  external: false,
  shape: 'line',
  image: null,
  ...over,
});

describe('HomeNewsLine markup (both shapes, defaults, long sentence, external link, placement)', () => {
  it('renders line shape with default ko/en strings, quiet soft pill CTA (no arrow), close glyph, and no box or video', () => {
    const ko = getDictionary('ko').brandNews;
    const koHtml = renderToStaticMarkup(<HomeNewsLine organizationId={ORG} news={sampleNews()} copy={ko} />);
    expect(koHtml).toContain(`data-home-news="${NEWS_ID}"`);
    expect(koHtml).toContain('data-shape="line"');
    expect(koHtml).toContain('<section');
    expect(koHtml).toContain(`aria-label="${ko.kickerDefault}"`);
    expect(koHtml).toContain(`>${ko.kickerDefault}<`);
    expect(koHtml).toContain(`>${ko.ctaDefault}<`);
    expect(koHtml).toContain('data-variant="soft"');
    expect(koHtml).toContain('data-size="sm"');
    expect(koHtml).toMatch(/<a\b[^>]*class="bs-btn [^"]*"[^>]*data-home-news-link=""[^>]*>[^<]*<\/a>/);
    expect(koHtml).toContain(`aria-label="${ko.close}"`);
    expect(koHtml).toContain(`href="/brand/studio/video?start=reverse&amp;organizationId=${ORG}"`);
    expect(koHtml).not.toContain('<img');
    expect(koHtml).not.toMatch(/<video[\s>]/i);
    expect(koHtml).not.toContain('data-variant="solid"');

    const en = getDictionary('en').brandNews;
    const enHtml = renderToStaticMarkup(<HomeNewsLine organizationId={ORG} news={sampleNews()} copy={en} />);
    expect(enHtml).toContain('aria-label="What&#x27;s new"');
    expect(enHtml).toContain('>View more<');
    expect(enHtml).toContain('aria-label="Close"');
  });

  it('uses given kicker and ctaLabel, keeps section aria-label as kickerDefault, and puts full 60-char title in title attribute', () => {
    const ko = getDictionary('ko').brandNews;
    const longTitle = ('가나다라마바사아자차카타파하'.repeat(4) + '가나다라').slice(0, BRAND_NEWS_LIMITS.titleChars);
    expect(Array.from(longTitle)).toHaveLength(BRAND_NEWS_LIMITS.titleChars);

    const html = renderToStaticMarkup(
      <HomeNewsLine
        organizationId={ORG}
        news={sampleNews({ kicker: '새 기능', title: longTitle, ctaLabel: '써 보기' })}
        copy={ko}
      />,
    );
    expect(html).toContain(`aria-label="${ko.kickerDefault}"`);
    expect(html).toContain('>새 기능<');
    expect(html).toContain('>써 보기<');
    expect(html).toContain(`title="${longTitle}"`);
    expect(html).toContain(`>${longTitle}<`);
  });

  it('renders external twings.app links in the same tab without target or rel', () => {
    const ko = getDictionary('ko').brandNews;
    const html = renderToStaticMarkup(
      <HomeNewsLine
        organizationId={ORG}
        news={sampleNews({ href: 'https://twings.app/ko/templates?from=brand', external: true })}
        copy={ko}
      />,
    );
    expect(html).toContain('href="https://twings.app/ko/templates?from=brand"');
    expect(html).not.toMatch(/\btarget=/);
    expect(html).not.toMatch(/\brel=/);
  });

  it('renders banner shape with 1600x400 eager async image, alt="", self-contained bannerClose (no bs-tile-btn), full title attr, and no video', () => {
    const ko = getDictionary('ko').brandNews;
    const longTitle = '가'.repeat(60);
    const html = renderToStaticMarkup(
      <HomeNewsLine
        organizationId={ORG}
        news={sampleNews({
          shape: 'banner',
          title: longTitle,
          image: {
            url: 'https://media.example.test/public-content/abcd.webp',
            width: BRAND_NEWS_LIMITS.image.width,
            height: BRAND_NEWS_LIMITS.image.height,
          },
        })}
        copy={ko}
      />,
    );
    expect(html).toContain(`data-home-news="${NEWS_ID}"`);
    expect(html).toContain('data-shape="banner"');
    expect(html).toMatch(/class="[^"]*bannerMedia[^"]*"[^>]*aria-hidden="true"/);
    expect(html).toContain(`title="${longTitle}"`);
    expect(html).toContain('src="https://media.example.test/public-content/abcd.webp"');
    expect(html).toContain(`width="${BRAND_NEWS_LIMITS.image.width}"`);
    expect(html).toContain(`height="${BRAND_NEWS_LIMITS.image.height}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('bs-tile-btn');
    expect(html).toContain('data-variant="soft"');
    expect(html).toContain('data-size="sm"');
    expect(html).toMatch(/<a\b[^>]*class="bs-btn [^"]*"[^>]*data-home-news-link=""[^>]*>[^<]*<\/a>/);
    expect(html).toMatch(/class="[^"]*bannerClose[^"]*"/);
    expect(html).not.toMatch(/<video[\s>]/i);
    expect(html).not.toContain('data-variant="solid"');
  });

  it('sits between the top row/heading and the prompt bar on both legacy and project-cards paths, with one solid CTA total', () => {
    const news = sampleNews();

    const legacy = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        news={news}
        copy={legacyCopyOf('ko')}
      />,
    );
    expect(legacy).toContain(`data-home-news="${NEWS_ID}"`);
    expect(legacy.indexOf('<h1')).toBeLessThan(legacy.indexOf('data-home-news'));
    expect(legacy.indexOf('data-home-news')).toBeLessThan(legacy.indexOf('data-home-prompt'));
    expect(legacy.match(/data-variant="solid"/g)).toHaveLength(1);

    const spine = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        news={news}
        spineHome={{
          canCreate: true,
          roomsOpen: true,
          cards: {
            ok: true,
            projects: [SAMPLE_CARD],
            unfiled: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
          },
        }}
        copy={spineCopyOf('ko')}
      />,
    );
    expect(spine).toContain(`data-home-news="${NEWS_ID}"`);
    expect(spine.indexOf('data-home-top-row')).toBeLessThan(spine.indexOf('data-home-news'));
    expect(spine.indexOf('data-home-news')).toBeLessThan(spine.indexOf('data-home-prompt'));
    expect(spine.indexOf('data-home-prompt')).toBeLessThan(spine.indexOf('data-home-projects'));
    expect(spine.match(/data-variant="solid"/g)).toHaveLength(1);
  });
});

describe('HomeNewsLine close behavior in DOM harness', () => {
  let mounted: MountedDom | null = null;
  const origFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await mounted?.unmount();
    mounted = null;
  });

  function makeHomeElement(news: HomeAnnouncement, role: 'owner' | 'viewer' = 'owner') {
    return (
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf(role)}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={role === 'viewer'}
        viewerNote={role === 'viewer'}
        news={news}
        copy={legacyCopyOf('ko')}
      />
    );
  }

  it('hides at once, moves focus to the prompt bar field, sends news.dismiss once, ignores failure, and never re-sends on rerender', async () => {
    let resolveFetch!: (res: Response) => void;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as unknown as typeof fetch;

    const news = sampleNews();
    mounted = await mountDom(makeHomeElement(news));
    expect(mounted.query('[data-home-news]')).not.toBeNull();
    const promptField = mounted.query('[data-home-prompt-field]');
    expect(promptField).not.toBeNull();

    // Click close while fetch is still pending: line must hide at once and focus the prompt field.
    await mounted.click('[data-home-news-close]');
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(mounted.document.activeElement).toBe(promptField);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/brand-workspace');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      operation: 'news.dismiss',
      input: { organizationId: ORG, announcementId: NEWS_ID },
    });

    // Server answers failure: nothing visible changes and no retry happens.
    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ ok: false, code: 'failed' }), { status: 500 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(calls).toHaveLength(1);

    // Rerendering with a new news object carrying the same id stays hidden and never sends a second call.
    await mounted.rerender(makeHomeElement({ ...news }));
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('handles offline/network rejection without visible error or retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mounted = await mountDom(makeHomeElement(sampleNews()));
    await mounted.click('[data-home-news-close]');
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('moves viewer focus to the first focusable element after the line position, or hides cleanly when none follows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mounted = await mountDom(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('viewer')}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly
        viewerNote
        news={sampleNews()}
        spineHome={{
          canCreate: false,
          roomsOpen: true,
          cards: {
            ok: true,
            projects: [SAMPLE_CARD],
            unfiled: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 }, covers: [] },
          },
        }}
        copy={spineCopyOf('ko')}
      />,
    );
    expect(mounted.query('[data-home-prompt-field]')).toBeNull();
    const firstAfter = mounted.query('[data-home-projects] a[href]');
    expect(firstAfter).not.toBeNull();
    await mounted.click('[data-home-news-close]');
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(mounted.document.activeElement).toBe(firstAfter);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mounted.unmount();
    mounted = null;

    mounted = await mountDom(makeHomeElement(sampleNews(), 'viewer'));
    expect(mounted.query('[data-home-prompt-field]')).toBeNull();
    await mounted.click('[data-home-news-close]');
    expect(mounted.query('[data-home-news]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not hide or call dismiss, and prevents preview link navigation while keeping it focusable', async () => {
    const dismiss = vi.fn();
    mounted = await mountDom(
      <HomeNewsLine news={sampleNews()} copy={getDictionary('ko').brandNews} dismiss={dismiss} preview />,
    );
    const link = mounted.query('a[data-home-news-link]') as unknown as {
      getAttribute: (name: string) => string | null;
      dispatchEvent: (ev: unknown) => boolean;
    };
    expect(link.getAttribute('href')).toBe(sampleNews().href);
    expect(link.getAttribute('tabindex')).not.toBe('-1');

    const origPreviewDispatch = link.dispatchEvent.bind(link);
    const previewAllowed: boolean[] = [];
    link.dispatchEvent = (ev: unknown) => {
      const ok = origPreviewDispatch(ev);
      previewAllowed.push(ok);
      return ok;
    };
    await mounted.click('a[data-home-news-link]');
    expect(previewAllowed).toEqual([false]);

    await mounted.click('[data-home-news-close]');
    expect(mounted.query('[data-home-news]')).not.toBeNull();
    expect(dismiss).not.toHaveBeenCalled();

    await mounted.unmount();
    mounted = null;

    mounted = await mountDom(makeHomeElement(sampleNews()));
    const liveLink = mounted.query('a[data-home-news-link]') as unknown as {
      dispatchEvent: (ev: unknown) => boolean;
    };
    const origLiveDispatch = liveLink.dispatchEvent.bind(liveLink);
    const liveAllowed: boolean[] = [];
    liveLink.dispatchEvent = (ev: unknown) => {
      const ok = origLiveDispatch(ev);
      liveAllowed.push(ok);
      return ok;
    };
    await mounted.click('a[data-home-news-link]');
    expect(liveAllowed).toEqual([true]);
  });
});

describe('Slice 3b Batch A source and CSS Module guards', () => {
  const ROOT = process.cwd();
  const NEWS_LINE_DIR = 'components/brand-workspace/home/news-line';

  const listTsFiles = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? listTsFiles(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
    });

  function parseCssRules(css: string): Array<{ selector: string; at: string[]; body: string }> {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: Array<{ selector: string; at: string[]; body: string }> = [];
    const stack: Array<{ kind: 'at' | 'rule'; name: string; body: string }> = [];
    let buffer = '';
    for (const char of text) {
      const top = stack[stack.length - 1];
      if (char === '{') {
        const prelude = buffer.trim();
        buffer = '';
        stack.push({ kind: prelude.startsWith('@') ? 'at' : 'rule', name: prelude, body: '' });
      } else if (char === '}') {
        const done = stack.pop();
        if (done?.kind === 'rule') {
          out.push({ selector: done.name, at: stack.filter((s) => s.kind === 'at').map((s) => s.name), body: done.body });
        }
        buffer = '';
      } else if (top && top.kind === 'rule') {
        top.body += char;
        buffer += char;
        if (char === ';') buffer = '';
      } else {
        buffer += char;
      }
    }
    return out;
  }

  function splitSelectorList(list: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let cur = '';
    for (const char of list) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        result.push(cur.trim());
        cur = '';
      } else cur += char;
    }
    if (cur.trim()) result.push(cur.trim());
    return result;
  }

  function stripBalancedGlobal(selector: string): string {
    let out = '';
    for (let i = 0; i < selector.length; ) {
      if (selector.startsWith(':global(', i)) {
        let depth = 0;
        let j = i + ':global('.length - 1;
        for (; j < selector.length; j += 1) {
          if (selector[j] === '(') depth += 1;
          else if (selector[j] === ')') {
            depth -= 1;
            if (depth === 0) {
              j += 1;
              break;
            }
          }
        }
        i = j;
      } else {
        out += selector[i];
        i += 1;
      }
    }
    return out;
  }

  it('forbids <video>, timers, server imports, and dictionary imports under news-line/', () => {
    for (const file of listTsFiles(NEWS_LINE_DIR)) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, `${file} <video`).not.toMatch(/<video/i);
      expect(src, `${file} setInterval`).not.toMatch(/\bsetInterval\b/);
      expect(src, `${file} setTimeout`).not.toMatch(/\bsetTimeout\b/);
      expect(src, `${file} service`).not.toMatch(/brand-news\/service|brand-news-operations/);
      expect(src, `${file} getDictionary`).not.toContain('getDictionary');
    }
  });

  it('uses every exported runtime symbol from news-line/model.ts inside news-line/', () => {
    const modelSrc = readFileSync(path.join(ROOT, `${NEWS_LINE_DIR}/model.ts`), 'utf8');
    const exports = [
      ...modelSrc.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),
      ...modelSrc.matchAll(/^export\s+const\s+(\w+)/gm),
    ].map((m) => m[1]!);
    expect(exports.length).toBeGreaterThan(0);

    const combined = listTsFiles(NEWS_LINE_DIR).map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    const indexSrc = readFileSync(path.join(ROOT, `${NEWS_LINE_DIR}/index.tsx`), 'utf8');
    expect(indexSrc).toContain("from './model'");
    for (const sym of exports) {
      const matches = combined.match(new RegExp(`\\b${sym}\\b`, 'g')) ?? [];
      expect(matches.length, `unused export ${sym}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps news-line.module.css pure, token-only (no literals or accent), self-contained, and reduced-motion safe', () => {
    const rawCss = readFileSync(path.join(ROOT, `${NEWS_LINE_DIR}/news-line.module.css`), 'utf8');
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(css).not.toMatch(/accent|pink|\bred\b|#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
    expect(css).not.toMatch(/transition\s*:\s*all\b/i);

    const parsed = parseCssRules(css);
    expect(parsed.length).toBeGreaterThan(10);

    for (const rule of parsed) {
      for (const part of splitSelectorList(rule.selector)) {
        const localOnly = stripBalancedGlobal(part);
        expect(localOnly, `impure CSS Modules selector: ${part}`).toMatch(/\.[A-Za-z_][\w-]*/);
      }
    }

    const sizes = parsed.flatMap((r) => [...r.body.matchAll(/font-size\s*:\s*([^;]+)/g)].map((m) => m[1]!.trim()));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(['15px', '12.5px']).toContain(size);

    expect(parsed.some((r) => r.at.some((a) => a.includes('prefers-reduced-motion: reduce')))).toBe(true);
    expect(css).toMatch(/:global\(\.bw-main\) a\.link\.link:hover[\s\S]*?color:\s*var\(--ys-ink\)/);
  });

  it('matches prototype line (45px+18px) and banner (fixed 120px+18px, 2-line clamp) layout and white-on-glass close token', () => {
    const css = readFileSync(path.join(ROOT, `${NEWS_LINE_DIR}/news-line.module.css`), 'utf8');
    const parsed = parseCssRules(css);
    const bySelector = (sel: string) =>
      parsed.find((r) => splitSelectorList(r.selector).includes(sel) && r.at.length === 0)?.body ?? '';

    const line = bySelector('.line');
    expect(line).toMatch(/box-sizing:\s*border-box/);
    expect(line).toMatch(/height:\s*45px/);
    expect(line).toMatch(/padding:\s*0\b/);
    expect(line).toMatch(/margin:\s*0 0 18px/);

    const lineKicker = bySelector('.line .kicker');
    expect(lineKicker).toMatch(/padding:\s*1px 8px/);
    expect(lineKicker).toMatch(/border-radius:\s*var\(--ys-r-pill,\s*999px\)/);
    expect(lineKicker).toMatch(/background:\s*var\(--ys-panel\)/);
    expect(lineKicker).toMatch(/color:\s*var\(--ys-ink\)/);

    const pillLink = bySelector('.link');
    expect(pillLink).toMatch(/min-height:\s*36px/);
    expect(pillLink).toMatch(/padding:\s*0 14px/);
    expect(pillLink).toMatch(/border-radius:\s*var\(--ys-r-pill,\s*999px\)/);
    expect(pillLink).toMatch(/background:\s*var\(--ys-panel\)/);
    expect(pillLink).toMatch(/text-decoration:\s*none/);

    const banner = bySelector('.banner');
    expect(banner).toMatch(/box-sizing:\s*border-box/);
    expect(banner).toMatch(/height:\s*120px/);
    expect(banner).toMatch(/min-height:\s*120px/);
    expect(banner).toMatch(/margin:\s*0 0 18px/);
    expect(banner).not.toMatch(/aspect-ratio\s*:/);
    expect(banner).toMatch(/align-items:\s*center/);

    const media = bySelector('.bannerMedia');
    expect(media).toMatch(/position:\s*absolute/);
    expect(media).toMatch(/inset:\s*0 0 0 44%/);

    const img = bySelector('.bannerImage');
    expect(img).toMatch(/object-fit:\s*cover/);
    expect(img).toMatch(/object-position:\s*50% 42%/);

    const fade = bySelector('.banner::after');
    expect(fade).toMatch(/linear-gradient\([\s\S]*var\(--ys-bg\)/);

    const copyBox = bySelector('.bannerCopy');
    expect(copyBox).toMatch(/gap:\s*2px/);
    expect(copyBox).toMatch(/padding:\s*7px 56px 7px 26px/);

    const title = bySelector('.bannerTitle');
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title).toMatch(/\bline-clamp:\s*2/);
    expect(title).toMatch(/line-height:\s*21px/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);

    const bannerActionLink = bySelector('.bannerActions .link');
    expect(bannerActionLink).not.toMatch(/padding\s*:/);

    const close = bySelector('.bannerClose');
    expect(close).toMatch(/top:\s*10px/);
    expect(close).toMatch(/right:\s*10px/);
    expect(close).toMatch(/width:\s*30px/);
    expect(close).toMatch(/height:\s*30px/);
    expect(close).toMatch(/var\(--ys-glass-dark\)/);
    expect(close).toMatch(/var\(--ys-stage-border\)/);
    expect(close).toMatch(/color:\s*var\(--color-white\)/);
    expect(close).not.toMatch(/color:\s*var\(--ys-ink\)/);

    const blurRule = parsed.find((r) => r.selector === '.bannerClose' && r.at.some((a) => a.includes('backdrop-filter')))?.body ?? '';
    expect(blurRule).toMatch(/backdrop-filter:\s*blur\(8px\)/);

    const closeIcon = bySelector('.bannerClose :global(.bs-icon)');
    expect(closeIcon).toMatch(/stroke:\s*currentColor/);
    expect(closeIcon).toMatch(/fill:\s*none/);
  });
});
