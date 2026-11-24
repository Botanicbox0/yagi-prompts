import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactNode } from 'react';

const hooks = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ deps?: readonly unknown[]; fn: () => void | (() => void); cleanup?: void | (() => void); dirty: boolean }>,
  callbacks: [] as Array<{ deps?: readonly unknown[]; fn: unknown }>,
  reset() {
    this.active = false;
    this.cursor = 0;
    this.states = [];
    this.refs = [];
    this.effects = [];
    this.callbacks = [];
  },
}));

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
    Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  return {
    ...react,
    useId: () => (hooks.active ? `h-${hooks.cursor++}` : react.useId()),
    useRef: <T,>(initial: T) => {
      if (!hooks.active) return react.useRef(initial);
      const idx = hooks.cursor++;
      if (!hooks.refs[idx]) hooks.refs[idx] = { current: initial };
      return hooks.refs[idx] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      if (!hooks.active) return react.useState(initial);
      const idx = hooks.cursor++;
      if (!(idx in hooks.states)) {
        hooks.states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setter = (next: T | ((prev: T) => T)) => {
        const prev = hooks.states[idx] as T;
        hooks.states[idx] = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      };
      return [hooks.states[idx] as T, setter] as const;
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]) => {
      if (!hooks.active) return react.useCallback(fn, deps);
      const idx = hooks.cursor++;
      const slot = hooks.callbacks[idx];
      if (!slot || !sameDeps(slot.deps, deps)) {
        hooks.callbacks[idx] = { fn, deps };
      }
      return hooks.callbacks[idx]!.fn as T;
    },
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => {
      if (!hooks.active) return react.useEffect(fn, deps);
      const idx = hooks.cursor++;
      const slot = hooks.effects[idx];
      if (!slot || !deps || !sameDeps(slot.deps, deps)) {
        hooks.effects[idx] = { fn, deps, cleanup: slot?.cleanup, dirty: true };
      }
    },
  };
});

import { ClosedAllowanceBanner } from '@/components/brand-studio/closed-allowance-banner';
import { StudioApp } from '@/components/brand-studio/studio-app';
import { VideoStudioWorkspace } from '@/components/brand-studio/video/workspace';
import { SupportDrawer } from '@/components/brand-workspace/support';
import {
  buildClosedAllowanceDraft,
  openBrandSupport,
  resolveSupportOpenDetail,
} from '@/components/brand-workspace/support-trigger';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { allowance, asset, ORG, studioState } from './fixtures';

function findElement(
  node: ReactNode,
  predicate: (el: { type: unknown; props: Record<string, unknown> }) => boolean,
): { type: unknown; props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = (node.props ?? {}) as Record<string, unknown>;
  const candidate = { type: node.type, props };
  if (predicate(candidate)) return candidate;
  if (props.children !== undefined) return findElement(props.children as ReactNode, predicate);
  return null;
}

afterEach(() => {
  hooks.reset();
  vi.unstubAllGlobals();
});

describe('closed studio state & prefilled SupportDrawer request (Item 3)', () => {
  it('renders closed-allowance explanation + utilization request CTA in both image and video studio', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const copy = dict.brandStudio;
      const state = studioState({ allowance: allowance({ capKrw: 0, usedKrw: 0 }), assets: [asset(1)] });

      const imageHtml = renderToStaticMarkup(
        <StudioApp
          organizationId={ORG}
          organizationName="Atelier Monet"
          locale={locale}
          copy={copy}
          mode="image"
          libraryCopy={dict.studioLibrary}
          layersCopy={dict.studioLayers}
          initialState={state}
        />,
      );
      expect(imageHtml).toContain('data-studio-allowance-closed');
      expect(imageHtml).toContain(copy.dock.closedTitle);
      expect(imageHtml).toContain(copy.dock.closedBody);
      expect(imageHtml).toContain(copy.dock.closedAction);
      // The explanation is said once: by the banner, not again as the empty gallery's text (seen doubled on 2026-11-24).
      expect(imageHtml.split(copy.dock.closedBody).length - 1).toBe(1);

      const videoHtml = renderToStaticMarkup(
        <VideoStudioWorkspace
          organizationId={ORG}
          organizationName="Atelier Monet"
          locale={locale}
          copy={copy}
          libraryCopy={dict.studioLibrary}
          videoCopy={dict.studioVideo}
          initialState={state}
        />,
      );
      expect(videoHtml).toContain('data-studio-allowance-closed');
      expect(videoHtml).toContain(copy.dock.closedTitle);
      expect(videoHtml).toContain(copy.dock.closedBody);
      expect(videoHtml).toContain(copy.dock.closedAction);
      expect(videoHtml.split(copy.dock.closedBody).length - 1).toBe(1);
    }

    const videoSource = readFileSync(
      resolve(process.cwd(), 'components/brand-studio/video/workspace.tsx'),
      'utf8',
    );
    expect(videoSource).not.toMatch(/from\s+["']\.\.\/studio-app["']/);
  });

  it('builds a prefilled editable request with company name + desired content and resolves SupportDrawer state', () => {
    const koCopy = getDictionary('ko').brandStudio.dock;
    const draft = buildClosedAllowanceDraft(koCopy, '아틀리에 모네');
    expect(draft).toContain('아틀리에 모네');
    expect(koCopy.closedAction).toBe('이용 신청');

    const fallbackDraft = buildClosedAllowanceDraft(koCopy, '');
    expect(fallbackDraft).toContain(koCopy.closedRequestOrgFallback);

    const resolved = resolveSupportOpenDetail(
      { organizationId: ORG, draft },
      [{ id: 'other', name: 'Other', role: 'owner' }, { id: ORG, name: '아틀리에 모네', role: 'owner' }],
      'other',
    );
    expect(resolved).toEqual({ organizationId: ORG, draft });

    const unknownOrg = resolveSupportOpenDetail(
      { organizationId: 'missing-org', draft },
      [{ id: 'other', name: 'Other', role: 'owner' }],
      'other',
    );
    expect(unknownOrg).toEqual({ organizationId: 'other', draft });
  });

  it('dispatches open-brand-support event safely in SSR / browser environments', () => {
    const dispatched: Array<{ type: string; detail: unknown }> = [];
    const fakeWindow = {
      dispatchEvent(ev: { type: string; detail?: unknown }) {
        dispatched.push({ type: ev.type, detail: ev.detail });
        return false;
      },
    };
    openBrandSupport({ organizationId: ORG, draft: 'hello' }, fakeWindow as unknown as Window);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.detail).toEqual({ organizationId: ORG, draft: 'hello' });
  });

  it('clicking "이용 신청" opens the real SupportDrawer with the prefilled editable draft for the current organization (C1c #3)', async () => {
    const dict = getDictionary('ko');
    const koCopy = dict.brandStudio.dock;
    const expectedDraft = buildClosedAllowanceDraft(koCopy, '아틀리에 모네');

    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    const fakeWindow = {
      addEventListener(type: string, fn: (ev: unknown) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener(type: string, fn: (ev: unknown) => void) {
        listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
      },
      dispatchEvent(ev: { type: string; detail?: unknown; preventDefault?: () => void }) {
        let canceled = false;
        const wrapped = Object.assign(ev, {
          preventDefault() {
            canceled = true;
          },
        });
        for (const fn of listeners.get(ev.type) ?? []) fn(wrapped);
        return !canceled;
      },
    };

    class FakeCustomEvent<T = unknown> {
      type: string;
      detail?: T;
      constructor(type: string, init?: { detail?: T }) {
        this.type = type;
        this.detail = init?.detail;
      }
    }

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('CustomEvent', FakeCustomEvent);
    vi.stubGlobal('document', { hidden: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, messages: [] }) })),
    );

    const orgs = [
      { id: 'other-org', name: '다른 브랜드', role: 'owner' as const },
      { id: ORG, name: '아틀리에 모네', role: 'owner' as const },
    ];

    hooks.active = true;
    const renderSupport = () => {
      hooks.cursor = 0;
      const tree = SupportDrawer({ organizations: orgs, b: dict.brandWorkspace, locale: 'ko' });
      for (const slot of hooks.effects) {
        if (slot?.dirty) {
          slot.cleanup?.();
          slot.cleanup = slot.fn();
          slot.dirty = false;
        }
      }
      return tree;
    };

    // 1) Initial closed render of the real SupportDrawer (starts on first org 'other-org').
    const initialTree = renderSupport();
    const initialDialog = findElement(initialTree, (el) => el.type === 'dialog');
    expect(initialDialog?.props.open).toBe(false);

    // 2) Render real ClosedAllowanceBanner via React markup -> renders "이용 신청" button, zero red/SLA copy.
    const bannerHtml = renderToStaticMarkup(
      <ClosedAllowanceBanner
        organizationId={ORG}
        organizationName="아틀리에 모네"
        dockCopy={koCopy}
      />,
    );
    expect(bannerHtml).toContain('data-studio-allowance-closed');
    expect(bannerHtml).toContain('이용 신청');
    expect(bannerHtml).toContain('data-variant="solid"');

    // 3) SupportDrawer still opens on explicit openBrandSupport dispatch with prefilled editable draft.
    openBrandSupport({ organizationId: ORG, draft: expectedDraft }, fakeWindow as unknown as Window);

    // Flush the async history refresh triggered when SupportDrawer opens so `busy` settles to `false`.
    await new Promise((r) => setTimeout(r, 0));

    // 4) Re-render real SupportDrawer -> must be open, targeted at ORG, with prefilled editable textarea.
    const openedTree = renderSupport();
    const openedDialog = findElement(openedTree, (el) => el.type === 'dialog');
    expect(openedDialog?.props.open).toBe(true);
    expect(openedDialog?.props['data-concierge-handle']).toBe('@아틀리에-모네');

    const orgSelect = findElement(openedTree, (el) => el.type === 'select');
    expect(orgSelect?.props.value).toBe(ORG);

    const textarea = findElement(openedTree, (el) => el.type === 'textarea' && el.props.name === 'body');
    expect(textarea).not.toBeNull();
    expect(textarea?.props.value).toBe(expectedDraft);
    expect(textarea?.props.disabled).toBeFalsy();

    // 4) Editing the draft in SupportDrawer updates the controlled value.
    const editedDraft = `${expectedDraft}\n추가 요청: 제품 10컷`;
    (textarea!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: editedDraft } });
    const editedTree = renderSupport();
    const editedTextarea = findElement(editedTree, (el) => el.type === 'textarea' && el.props.name === 'body');
    expect(editedTextarea?.props.value).toBe(editedDraft);
  });
});
