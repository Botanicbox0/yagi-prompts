import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import { meterFigures, meterSummary } from '@/components/brand-workspace/rail-activity';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { HOME_STARTERS, homeLayout, homeTileRatio, homeWallRows, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';

/**
 * The workspace home on 직접 만들기 (docs/BRAND-STUDIO-V3.md §12), redesigned 2026-11-25 as one prompt bar,
 * what waits as thin lines and a wall of recent work. Server render of the view itself, per role, per
 * organization layout and per state; the page-level checks (who gets the home at all, the Morphic hardline,
 * the real schema) stay in workspace-home.test.tsx.
 */
type Locale = 'ko' | 'en';
const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const ALLOWANCE = { capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' };

// Markers of the home before the redesign: none may come back.
const GONE = ['data-home-tools', 'data-home-doors', 'data-home-door', 'data-door-picture', 'data-home-example', 'data-home-team-stages', 'data-home-lower', 'data-home-credits'];

/** React's own escaping of text and attribute values, so dictionary strings can be looked for in markup. */
const html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const re = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const actions = (markup: string) => [...markup.matchAll(/data-home-action="([^"]+)"/g)].map((m) => m[1]);

const copyOf = (locale: Locale): WorkspaceHomeProps['copy'] => {
  const d = getDictionary(locale);
  return {
    home: d.brandHome,
    shell: d.studioShell,
    roomsNav: d.roomsShell.nav,
    inbox: d.roomsChat.inbox,
    prompt: { label: d.brandStudio.dock.label, placeholder: { image: d.brandStudio.dock.placeholder, video: d.brandStudio.dock.placeholderVideo } },
    activeStatus: d.brandWorkspace.status.active,
    allAssets: d.studioLibrary.allAssets,
    closedRequestDraft: d.brandStudio.dock.closedRequestDraft,
    closedRequestOrgFallback: d.brandStudio.dock.closedRequestOrgFallback,
    billingCustomer: d.brandBilling.customer,
  };
};

type Role = 'owner' | 'editor' | 'viewer' | 'studio';
const layoutOf = (role: Role, options: { rooms?: boolean; assets?: boolean } = {}): HomeLayout => {
  const layout = homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role === 'owner' || role === 'editor', rooms: options.rooms ?? true })!;
  expect(layout, role).not.toBeNull();
  // A brand whose asset hub is closed: the layout carries no `assets` tool (lib/brands/workspace/home.ts).
  return options.assets === false ? { ...layout, tools: layout.tools.filter((tool) => tool.key !== 'assets') } : layout;
};

interface View {
  locale?: Locale;
  role?: Role;
  rooms?: boolean;
  assets?: boolean;
  reviews?: RoomAlertItem[];
  results?: HomeResult[];
  activeProjects?: number;
  checklist?: FirstRunChecklistState | null;
  notice?: ReactNode;
}
function view(v: View = {}): string {
  const locale = v.locale ?? 'ko';
  const role = v.role ?? 'owner';
  return renderToStaticMarkup(
    <WorkspaceHome
      organizationId={ORG}
      organizationName={NAME}
      locale={locale}
      layout={layoutOf(role, { rooms: v.rooms, assets: v.assets })}
      allowance={ALLOWANCE}
      reviews={v.reviews ?? []}
      results={v.results ?? []}
      activeProjects={v.activeProjects ?? 0}
      readOnly={role === 'viewer' || role === 'studio'}
      viewerNote={role === 'viewer'}
      notice={v.notice}
      checklist={v.checklist ?? null}
      canOpenBilling={role === 'owner'}
      copy={copyOf(locale)}
    />,
  );
}

const alert = (n: number, over: Partial<RoomAlertItem> = {}): RoomAlertItem => ({
  id: `alert-${n}`,
  kind: 'review',
  projectId: `p0000000-0000-4000-8000-00000000000${n}`,
  projectTitle: `Spring launch ${n}`,
  targetId: `t0000000-0000-4000-8000-00000000000${n}`,
  title: `Cut ${n}`,
  version: n,
  openNotes: 0,
  updatedAt: '2026-11-24T00:00:00Z',
  ...over,
});
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const result = (n: number, kind: 'image' | 'video', over: Partial<HomeResult> = {}): HomeResult => ({
  outputId: oid(n),
  kind,
  src: kind === 'image' ? `/m/still-${n}.webp` : `/m/poster-${n}.jpg`,
  clip: null,
  play: kind === 'video' ? `/m/film-${n}.mp4` : null,
  width: kind === 'image' ? 800 : 1920,
  height: kind === 'image' ? 1000 : 1080,
  seconds: kind === 'video' ? 6.2 : null,
  href: `/brand/studio${kind === 'video' ? '/video' : ''}?organizationId=${ORG}&view=o%3A${oid(n)}`,
  ...over,
});
const WALL: HomeResult[] = [
  result(1, 'video'),
  result(2, 'image'),
  result(3, 'image', { width: 1080, height: 1920 }),
  result(4, 'video', { src: null, clip: '/m/film-4.mp4', play: '/m/film-4.mp4', width: null, height: null, seconds: null }),
  result(5, 'image', { width: 2400, height: 1000 }),
  result(6, 'image', { width: null, height: null }),
  result(7, 'video', { width: 1080, height: 1920, seconds: 14 }),
];
const checklist = (over: Partial<FirstRunChecklistState> = {}): FirstRunChecklistState => ({
  show: true,
  hasTeammate: false,
  hasLogo: false,
  hasUploads: false,
  usageApproved: false,
  usageRequestSent: false,
  usageState: 'not_requested',
  hasFirstImage: false,
  ...over,
});

describe('the home after the redesign: no tool cards, doors or credits', () => {
  it.each(['ko', 'en'] as const)('draws none of them, empty or full, for any role (%s)', (locale) => {
    const d = getDictionary(locale);
    const credits = meterSummary(meterFigures(ALLOWANCE, locale)!, d.studioShell);
    expect(credits.length).toBeGreaterThan(0);
    for (const role of ['owner', 'editor', 'viewer', 'studio'] as const) {
      for (const results of [[], WALL]) {
        const markup = view({ locale, role, results, reviews: [alert(1)], activeProjects: 1 });
        for (const marker of GONE) expect(markup, `${role} ${marker}`).not.toContain(marker);
        // The credits sentence is the rail meter's alone.
        expect(markup, role).not.toContain(html(credits));
        expect(markup, role).not.toMatch(/\d\s*원|₩|KRW/);
        // The rail lists every tool: the home links to none of them by name.
        for (const name of [d.studioShell.rail.image, d.studioShell.rail.video, d.studioShell.rail.compose, d.studioShell.rail.workflows]) {
          expect(markup, `${role} ${name}`).not.toContain(`>${html(name)}<`);
        }
        for (const path of ['/brand/studio/compose', '/brand/studio/workflows', '/brand/studio/sound']) expect(markup, path).not.toContain(`href="${path}?`);
        // The heading: the workspace's name, the one h1.
        expect(count(markup, /<h1[\s>]/g)).toBe(1);
        expect(markup).toMatch(new RegExp(`<h1[^>]*>${re(html(interpolate(d.brandHome.heading, { name: NAME })))}</h1>`));
      }
    }
  });
});

describe('the prompt bar', () => {
  it('is there for an owner and an editor, first, with the page\'s only filled button', () => {
    for (const role of ['owner', 'editor'] as const) {
      for (const results of [[], WALL]) {
        const markup = view({ role, results, reviews: [alert(1)], checklist: checklist() });
        expect(markup, role).toContain('data-home-prompt');
        expect(count(markup, /data-variant="solid"/g), role).toBe(1);
        expect(markup).toContain(html(getDictionary('ko').brandStudio.dock.placeholder));
        expect(markup.indexOf('data-home-prompt')).toBeLessThan(markup.indexOf('data-home-lines'));
        expect(markup).not.toContain('data-home-viewer-note');
      }
    }
  });
  it('is not there for a viewer (who gets one line saying why) or for the TWINGS team view (which gets its notice)', () => {
    const viewer = view({ role: 'viewer', results: WALL });
    expect(viewer).not.toContain('data-home-prompt');
    expect(viewer).not.toContain('data-variant="solid"');
    expect(viewer).toContain('data-home-viewer-note');
    expect(viewer).toContain(html(getDictionary('ko').brandHome.viewerNote));

    const staff = view({ role: 'studio', results: WALL, notice: <p data-staff-notice-fixture>TWINGS team view</p> });
    expect(staff).not.toContain('data-home-prompt');
    expect(staff).not.toContain('data-variant="solid"');
    expect(staff).not.toContain('data-home-viewer-note');
    expect(staff).toContain('data-staff-notice-fixture');
    expect(staff).toContain('data-home-read-only="true"');
    expect(view({ role: 'owner' })).not.toContain('data-home-read-only');
  });
});

describe('what waits, as lines', () => {
  const d = getDictionary('ko');
  it('draws no review lines while nothing waits', () => {
    const markup = view();
    expect(markup).toContain('data-home-lines');
    expect(markup).not.toContain('data-home-reviews');
    expect(markup).not.toContain('data-home-review=');
    // The heading over waiting lines is not drawn (the section's own aria-label still names it).
    expect(markup).not.toContain(`>${html(d.roomsChat.inbox.alertsHeading)}<`);
  });
  it('draws one line per waiting draft, up to two, each linking to its room', () => {
    const one = view({ reviews: [alert(1)] });
    expect(one).toContain('data-home-reviews="1"');
    expect(count(one, /data-home-review="/g)).toBe(1);
    expect(one).not.toContain('data-home-reviews-more');
    expect(one).toContain(`>${html(d.roomsChat.inbox.alertsHeading)}<`);

    const two = view({ reviews: [alert(1), alert(2, { kind: 'storyboard', title: '' })] });
    expect(two).toContain('data-home-reviews="2"');
    expect([...two.matchAll(/data-home-review="([^"]+)"/g)].map((m) => m[1])).toEqual(['review', 'storyboard']);
    expect(two).not.toContain('data-home-reviews-more');
    // A draft opens on the room's review tab, a storyboard on its storyboard; each line says what to do.
    expect(two).toContain(`href="/brand/rooms/${alert(1).projectId}?organizationId=${ORG}&amp;tab=review&amp;review=${alert(1).targetId}"`);
    expect(two).toContain(`href="/brand/rooms/${alert(2).projectId}?organizationId=${ORG}&amp;tab=storyboard&amp;board=${alert(2).targetId}"`);
    expect(two).toContain(html(interpolate(d.roomsChat.inbox.alertReview, { version: 1 })));
    expect(two).toContain(html(interpolate(d.roomsChat.inbox.alertStoryboard, { version: 2 })));
    // A storyboard without its own title is named by its project.
    expect(two).toContain('Spring launch 2');
    // Open notes are counted on the line.
    expect(view({ reviews: [alert(1, { openNotes: 3 })] })).toContain(html(interpolate(d.roomsChat.inbox.alertReviewNotes, { version: 1, count: 3 })));
  });
  it('folds everything past two into one "more" link to the inbox, which counts them all', () => {
    for (const n of [3, 7]) {
      const markup = view({ reviews: Array.from({ length: n }, (_, i) => alert(i + 1)) });
      expect(markup).toContain(`data-home-reviews="${n}"`);
      expect(count(markup, /data-home-review="/g)).toBe(2);
      expect(count(markup, /data-home-reviews-more/g)).toBe(1);
      expect(markup).toMatch(new RegExp(`<a href="/brand/rooms\\?organizationId=${ORG}"[^>]*data-home-reviews-more[^>]*>${re(html(interpolate(d.brandHome.reviewMore, { count: n })))}</a>`));
      expect(markup).not.toContain('Cut 3');
    }
  });
});

describe('the team line', () => {
  const d = getDictionary('ko');
  it('is always there: a sentence and the one request link while no project is under way', () => {
    for (const reviews of [[], [alert(1)], [alert(1), alert(2), alert(3)]]) {
      const markup = view({ reviews });
      expect(markup).toContain('data-home-team="commission"');
      expect(markup).not.toContain('data-home-team-facts');
      expect(markup).toContain(html(d.brandHome.lines.commission));
      expect(markup).toContain(html(d.roomsShell.nav.groupTeam));
      expect(markup).toMatch(new RegExp(`<a href="/brand/projects/new\\?organizationId=${ORG}"[^>]*data-home-action="commission"[^>]*>${re(html(d.roomsShell.nav.commission))}</a>`));
      expect(actions(markup)).toEqual(['commission']);
    }
  });
  it('says the campaign request while rooms are closed, and the projects list to a role that cannot request', () => {
    const campaign = view({ rooms: false });
    expect(campaign).toContain('data-home-team="campaign"');
    expect(campaign).toContain(html(d.brandHome.lines.campaign));
    expect(campaign).toContain(`href="/brand/projects/new?organizationId=${ORG}"`);
    expect(actions(campaign)).toEqual(['campaign']);
    for (const role of ['viewer', 'studio'] as const) {
      const markup = view({ role });
      expect(markup, role).toContain('data-home-team="projects"');
      expect(markup, role).toContain(html(d.brandHome.lines.projects));
      expect(markup, role).toContain(`href="/brand?organizationId=${ORG}"`);
      expect(markup, role).not.toContain('/brand/projects/new');
      expect(actions(markup), role).toEqual(['projects']);
    }
  });
  it('counts the projects under way, linked to the list, only when there are some', () => {
    for (const n of [1, 4]) {
      const markup = view({ activeProjects: n });
      expect(count(markup, /data-home-team-facts/g)).toBe(1);
      expect(markup).toMatch(new RegExp(`<a href="/brand\\?organizationId=${ORG}"[^>]*data-home-team-facts[^>]*>`));
      expect(markup).toContain(html(`${d.brandWorkspace.status.active} ${n}`));
      expect(markup).not.toContain(html(d.brandHome.lines.commission));
      expect(actions(markup)).toEqual(['commission']);
    }
    expect(view({ activeProjects: 0 })).not.toContain('data-home-team-facts');
  });
});

describe('the wall', () => {
  it('draws one tile per result, in order, in rows of one height, each at its own proportions', () => {
    const markup = view({ results: WALL });
    expect(markup).toContain('data-home-state="content"');
    expect(markup).toContain(`data-home-results="${WALL.length}"`);
    expect(count(markup, /data-home-wall(?:=|\s|>)/g)).toBe(1);
    expect(markup).not.toContain('data-home-starters');
    // Tiles: as many as results, in their order, each a link to its own viewer.
    expect([...markup.matchAll(/data-home-result="([^"]+)"/g)].map((m) => m[1])).toEqual(WALL.map((r) => r.kind));
    const order = WALL.map((r) => markup.indexOf(`view=o%3A${r.outputId}`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Rows as homeWallRows lays them out; each tile's box carries its ratio; a short last row leaves its end open.
    const rows = homeWallRows(WALL, homeTileRatio);
    expect([...markup.matchAll(/data-home-wall-row="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(rows.map((row) => row.items.length));
    expect([...markup.matchAll(/<li style="flex-grow:([\d.]+);aspect-ratio:([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])).toEqual(
      WALL.map((r) => [homeTileRatio(r), homeTileRatio(r)]),
    );
    expect([...markup.matchAll(/<li aria-hidden="true"[^>]*style="flex-grow:([\d.]+)"/g)].map((m) => Number(m[1]))).toEqual(rows.filter((row) => row.rest > 0).map((row) => row.rest));
    // Pictures and clips: no clip plays on its own.
    expect(markup).not.toMatch(/autoplay/i);
    expect(markup).not.toContain('data-playing');
  });
  it('links to the asset hub only where the brand has it', () => {
    const d = getDictionary('ko');
    const withHub = view({ results: WALL });
    expect(withHub).toMatch(new RegExp(`<a href="/brand/library\\?organizationId=${ORG}"[^>]*data-home-action="assets"[^>]*>${re(html(d.studioLibrary.allAssets))}</a>`));
    expect(actions(withHub)).toEqual(['commission', 'assets']);
    const withoutHub = view({ results: WALL, assets: false });
    expect(withoutHub).not.toContain('data-home-action="assets"');
    expect(withoutHub).not.toContain('/brand/library');
    expect(withoutHub).toContain(`data-home-results="${WALL.length}"`);
    // A viewer reads the wall too, with the same link out.
    expect(view({ role: 'viewer', results: WALL })).toContain('data-home-action="assets"');
  });
});

describe('the starters (a brand with no results yet)', () => {
  it.each(['ko', 'en'] as const)('shows three, each with its medium inside the name line, for every role (%s)', (locale) => {
    const h = getDictionary(locale).brandHome;
    for (const role of ['owner', 'viewer'] as const) {
      const markup = view({ locale, role });
      expect(markup, role).toContain('data-home-state="empty"');
      expect(markup, role).toContain('data-home-starters');
      expect(markup, role).not.toContain('data-home-wall');
      expect(markup, role).not.toContain('data-home-results');
      expect(markup, role).not.toContain('data-home-action="assets"');
      expect([...markup.matchAll(/data-home-starter="([^"]+)"/g)].map((m) => m[1]), role).toEqual(HOME_STARTERS.map((s) => s.key));
      for (const starter of HOME_STARTERS) {
        expect(markup, `${role} ${starter.key}`).toMatch(new RegExp(`<span[^>]*><span[^>]*>${re(html(h.prompt.medium[starter.medium]))}</span>${re(html(h.starters[starter.key].name))}</span>`));
        expect(markup).toContain(html(h.starters[starter.key].prompt));
        expect(markup).toContain(`src="${starter.picture}"`);
      }
      // Each opens its studio, scoped to this brand.
      expect(markup).toContain(`href="/brand/studio?organizationId=${ORG}"`);
      expect(markup).toContain(`href="/brand/studio/video?organizationId=${ORG}"`);
    }
  });
});

describe('the first-run guide', () => {
  const k = getDictionary('ko').brandHome.checklist;
  it('renders under the lines with its markers, in every usage state', () => {
    const fresh = view({ checklist: checklist() });
    expect(fresh).toContain('data-home-first-run');
    expect(fresh).toContain('data-home-checklist-dismiss');
    expect(fresh).toContain('data-home-checklist-request');
    expect(fresh).toContain('data-home-checklist-usage-status="not_requested"');
    expect(fresh).toContain(html(k.usage.pendingAction));
    expect(fresh.indexOf('data-home-lines')).toBeLessThan(fresh.indexOf('data-home-first-run'));
    expect(fresh.indexOf('data-home-first-run')).toBeLessThan(fresh.indexOf('data-home-starters'));
    expect(fresh).toContain(`/brand/billing?organizationId=${ORG}`);
    expect(count(fresh, /data-variant="solid"/g)).toBe(1);

    const requested = view({ checklist: checklist({ usageRequestSent: true, usageState: 'requested' }) });
    expect(requested).toContain('data-home-checklist-usage-status="requested"');
    expect(requested).toContain('data-home-checklist-request');
    expect(requested).toContain(html(k.usage.requestedAction));

    const ready = view({ checklist: checklist({ usageApproved: true, usageState: 'ready', hasTeammate: true }) });
    expect(ready).toContain('data-home-checklist-usage-status="ready"');
    expect(ready).not.toContain('data-home-checklist-request');
    expect(ready).toContain('data-home-checklist-dismiss');
  });
  it('is not drawn once done or dismissed, nor for a viewer or the team view', () => {
    expect(view({ checklist: checklist({ show: false }) })).not.toContain('data-home-first-run');
    expect(view({ checklist: null })).not.toContain('data-home-first-run');
    for (const role of ['viewer', 'studio'] as const) expect(view({ role, checklist: checklist() }), role).not.toContain('data-home-first-run');
  });
});
