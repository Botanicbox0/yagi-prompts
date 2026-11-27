import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandProjectSummary } from '@/lib/brands/workspace/types';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { CampaignOpsAfterHeader } from '@/components/brand-workspace/campaign-ops/header-after';
import { CampaignOpsList } from '@/components/brand-workspace/campaign-ops/ops-list';
import { campaignOpsSteps } from '@/components/brand-workspace/campaign-ops/model';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const ko = getDictionary('ko');
const b = ko.brandWorkspace;
const ORG = 'a0000000-0000-4000-8000-00000000000a';

const project = (
  id: string,
  status: BrandProjectSummary['status'],
  title: string,
): BrandProjectSummary => ({
  id,
  organizationId: ORG,
  organizationName: 'Alpha fixture',
  title,
  objective: 'Goal',
  audience: '',
  budgetKrw: null,
  budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: '2026-11-15',
  endsOn: '2026-11-30',
  productionMode: 'creator',
  status,
  revision: 1,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
});

const rooms = {
  organizationId: ORG,
  unread: {},
  copy: ko.roomsShell.entry,
  list: ko.roomsShell.space.list,
};

const mounted: MountedDom[] = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe('CampaignOpsList status chips and client filter', () => {
  const items = [
    project('10000000-0000-4000-8000-000000000001', 'requested', 'Requested One'),
    project('20000000-0000-4000-8000-000000000002', 'active', 'Active One'),
  ];

  it('shows only 전체 and the statuses actually present, and filters without network calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const dom = await mountDom(
      <CampaignOpsList
        kind="campaigns"
        organizationId={ORG}
        projects={items}
        listTitle={ko.campaignOps.campaigns.list.title}
        listEmpty={ko.campaignOps.campaigns.list.empty}
        allLabel={ko.campaignOps.shared.filterAll}
        b={b}
        locale="ko"
        rooms={rooms}
        trackLabels={ko.roomsShell.room.tracks}
      />,
    );
    mounted.push(dom);

    const chips = dom.queryAll('[data-filter-status]').map((el) => el.getAttribute('data-filter-status'));
    expect(chips).toEqual(['all', 'requested', 'active']);
    expect(dom.query('[data-filter-status="completed"]')).toBeNull();
    expect(dom.query('[data-filter-status="cancelled"]')).toBeNull();
    expect(dom.queryAll('.bw-campaign-card')).toHaveLength(2);

    await dom.click('[data-filter-status="requested"]');
    expect(dom.query('[data-filter-status="requested"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(dom.query('[data-filter-status="all"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(dom.queryAll('.bw-campaign-card').map((a) => a.textContent)).toEqual([
      expect.stringContaining('Requested One'),
    ]);

    await dom.click('[data-filter-status="all"]');
    expect(dom.queryAll('.bw-campaign-card')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows list.empty when no item matches the active filter', async () => {
    const dom = await mountDom(
      <CampaignOpsList
        kind="campaigns"
        organizationId={ORG}
        projects={items}
        listTitle={ko.campaignOps.campaigns.list.title}
        listEmpty={ko.campaignOps.campaigns.list.empty}
        allLabel={ko.campaignOps.shared.filterAll}
        b={b}
        locale="ko"
        rooms={rooms}
        trackLabels={ko.roomsShell.room.tracks}
        initialStatus="completed"
      />,
    );
    mounted.push(dom);
    expect(dom.query('[data-campaign-ops-empty]')?.textContent).toBe(ko.campaignOps.campaigns.list.empty);
    expect(dom.query('[data-campaign-ops-grid]')).toBeNull();
  });
});

describe('HowDialog open, close three ways, and focus restoration', () => {
  it('opens with the process stage, stays open on inside clicks, closes by Esc/button/outside, and returns focus', async () => {
    const dom = await mountDom(
      <CampaignOpsAfterHeader
        title={ko.campaignOps.rail.campaigns}
        howTitle={ko.campaignOps.campaigns.how.title}
        closeLabel={ko.campaignOps.shared.howClose}
        exampleCaption={ko.campaignOps.campaigns.how.example}
        steps={campaignOpsSteps('campaigns', ko.campaignOps)}
        pic={ko.campaignOps.pic}
        startHref={`/brand/projects/new?track=creator_campaign&organizationId=${ORG}`}
        ctaLabel={ko.campaignOps.campaigns.hero.cta}
        canRequest
      />,
    );
    mounted.push(dom);

    const trigger = dom.query('[data-how-dialog-trigger]')!;
    expect(dom.query('[data-how-dialog]')).toBeNull();

    // 1. Open and close with close button.
    await dom.click(trigger);
    expect(dom.query('[role="dialog"]')).not.toBeNull();
    expect(dom.query('[role="dialog"] [data-process-stage]')).not.toBeNull();
    expect(dom.document.activeElement).toBe(dom.query('[data-how-dialog-close]'));

    // Clicking inside does not close.
    await dom.click('[data-how-dialog]');
    expect(dom.query('[data-how-dialog]')).not.toBeNull();

    await dom.click('[data-how-dialog-close]');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);

    // 2. Open and close with Escape.
    await dom.click(trigger);
    expect(dom.query('[data-how-dialog]')).not.toBeNull();
    await dom.keyDown('Escape');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);

    // 3. Open and close by clicking outside (backdrop).
    await dom.click(trigger);
    expect(dom.query('[data-how-dialog]')).not.toBeNull();
    await dom.click('[data-how-dialog-backdrop]');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);
  });

  it('Should-fix 3 & Fix3 §1: preserves viewport scroll at 250 across open and all three close ways (no scrollTo/scrollTop/html-or-body style changes, always preventScroll), marks background inert, ignores Escape when another modal is on top, and stacks above rail popovers', async () => {
    const css = readFileSync('components/brand-workspace/campaign-ops/campaign-ops.module.css', 'utf8');
    const backdropBlock = /\.dialogBackdrop\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    const zMatch = /z-index:\s*(\d+)/.exec(backdropBlock);
    expect(Number(zMatch?.[1] ?? 0)).toBeGreaterThan(95);
    expect(backdropBlock).toContain('position: fixed');
    expect(backdropBlock).toContain('inset: 0');
    expect(backdropBlock).toContain('overflow: auto');
    expect(backdropBlock).toContain('overscroll-behavior: contain');

    const dom = await mountDom(
      <div className="bw-shell">
        <CampaignOpsAfterHeader
          title={ko.campaignOps.rail.campaigns}
          howTitle={ko.campaignOps.campaigns.how.title}
          closeLabel={ko.campaignOps.shared.howClose}
          exampleCaption={ko.campaignOps.campaigns.how.example}
          steps={campaignOpsSteps('campaigns', ko.campaignOps)}
          pic={ko.campaignOps.pic}
          startHref={`/brand/projects/new?track=creator_campaign&start=ops&organizationId=${ORG}`}
          ctaLabel={ko.campaignOps.campaigns.hero.cta}
          canRequest
        />
      </div>,
    );
    mounted.push(dom);

    let windowScrollY = 250;
    const scrollToSpy = vi.fn((_x: number, y: number) => {
      windowScrollY = y;
    });
    Object.defineProperty(globalThis, 'scrollY', { configurable: true, get: () => windowScrollY });
    Object.defineProperty(globalThis, 'scrollX', { configurable: true, get: () => 0 });
    vi.stubGlobal('scrollTo', scrollToSpy);

    const scrollTopAssignments: Array<{ target: 'html' | 'body'; value: number }> = [];
    for (const [label, el, initial] of [
      ['html', dom.document.documentElement, 250],
      ['body', dom.document.body, 0],
    ] as const) {
      let current: number = initial;
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => current,
        set: (next: number) => {
          current = next;
          scrollTopAssignments.push({ target: label, value: next });
        },
      });
    }

    const styleMutations: string[] = [];
    const attrMutations: string[] = [];
    for (const [label, el] of [
      ['html', dom.document.documentElement],
      ['body', dom.document.body],
    ] as const) {
      const rawStyle = el.style;
      const origSetProp = rawStyle.setProperty.bind(rawStyle);
      const origRemoveProp = rawStyle.removeProperty.bind(rawStyle);
      const wrappedStyle = new Proxy(rawStyle, {
        set(target, prop, value) {
          if (prop === 'setProperty' || prop === 'removeProperty') return Reflect.set(target, prop, value);
          styleMutations.push(`${label}.style.${String(prop)}=${String(value)}`);
          return Reflect.set(target, prop, value);
        },
        get(target, prop) {
          if (prop === 'setProperty') {
            return (k: string, v: string) => {
              styleMutations.push(`${label}.style.setProperty(${k},${v})`);
              origSetProp(k, v);
            };
          }
          if (prop === 'removeProperty') {
            return (k: string) => {
              styleMutations.push(`${label}.style.removeProperty(${k})`);
              origRemoveProp(k);
            };
          }
          return Reflect.get(target, prop);
        },
      });
      Object.defineProperty(el, 'style', { configurable: true, value: wrappedStyle });

      const origSetAttr = el.setAttribute.bind(el);
      const origRemoveAttr = el.removeAttribute.bind(el);
      vi.spyOn(el, 'setAttribute').mockImplementation((k: string, v: string) => {
        attrMutations.push(`${label}.setAttribute(${k},${v})`);
        origSetAttr(k, v);
      });
      vi.spyOn(el, 'removeAttribute').mockImplementation((k: string) => {
        attrMutations.push(`${label}.removeAttribute(${k})`);
        origRemoveAttr(k);
      });
    }

    const trigger = dom.query('[data-how-dialog-trigger]')!;
    const elProto = Object.getPrototypeOf(Object.getPrototypeOf(trigger)) as {
      focus: (opts?: FocusOptions) => void;
    };
    expect(Object.prototype.hasOwnProperty.call(elProto, 'focus')).toBe(true);
    const origFocus = elProto.focus;
    const focusCalls: Array<{ target: unknown; opts: unknown }> = [];
    vi.spyOn(elProto, 'focus').mockImplementation(function (this: unknown, opts?: FocusOptions) {
      const stack = new Error().stack ?? '';
      if (!stack.includes('_dom-harness')) {
        focusCalls.push({ target: this, opts });
      }
      return origFocus.call(this);
    });

    // 1. Open -> Tab/Shift+Tab trap -> Close via button.
    await dom.click(trigger);
    expect(dom.container.hasAttribute('inert')).toBe(true);
    const portalBackdrop = dom.document.body.querySelector('[data-how-dialog-backdrop]')!;
    expect(portalBackdrop.hasAttribute('inert')).toBe(false);
    expect(portalBackdrop.closest('[inert]')).toBeNull();

    await dom.keyDown('Tab', { shiftKey: true, target: dom.query('[data-how-dialog-close]') });
    const segments = dom.queryAll('[data-segment-index]');
    await dom.keyDown('Tab', { target: segments[segments.length - 1] });
    expect(dom.document.activeElement).toBe(dom.query('[data-how-dialog-close]'));

    // If a later modal overlay appears above HowDialog, Escape must NOT close HowDialog.
    const topModal = dom.document.createElement('div');
    topModal.setAttribute('role', 'dialog');
    topModal.setAttribute('aria-modal', 'true');
    dom.document.body.appendChild(topModal);
    await dom.keyDown('Escape');
    expect(dom.document.body.querySelector('[data-how-dialog]')).not.toBeNull();
    dom.document.body.removeChild(topModal);

    await dom.click('[data-how-dialog-close]');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);
    expect(dom.container.hasAttribute('inert')).toBe(false);

    // 2. Open -> Close via Escape.
    await dom.click(trigger);
    await dom.keyDown('Escape');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);

    // 3. Open -> Close via backdrop click.
    await dom.click(trigger);
    await dom.click('[data-how-dialog-backdrop]');
    expect(dom.query('[data-how-dialog]')).toBeNull();
    expect(dom.document.activeElement).toBe(trigger);

    // 4. Open -> Unmount cleanly restores inertness without touching scroll or html/body styles.
    await dom.click(trigger);
    expect(dom.container.hasAttribute('inert')).toBe(true);
    await mounted.pop()!.unmount();
    expect(dom.container.hasAttribute('inert')).toBe(false);

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollTopAssignments).toEqual([]);
    expect(styleMutations).toEqual([]);
    expect(attrMutations).toEqual([]);
    expect(windowScrollY).toBe(250);
    expect((dom.document.documentElement as unknown as { scrollTop: number }).scrollTop).toBe(250);
    // 4 opens (close button focus) + 2 Tab trap focuses + 3 closes (trigger focus) = 9 programmatic calls.
    expect(focusCalls.length).toBe(9);
    for (const call of focusCalls) {
      expect(call.opts).toEqual({ preventScroll: true });
    }

    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).scrollY;
    delete (globalThis as Record<string, unknown>).scrollX;
  });
});
