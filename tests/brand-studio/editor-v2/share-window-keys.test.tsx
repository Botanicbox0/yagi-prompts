import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioEditorKo } from '@/messages/studio-editor';
import type { MountedDom } from '@/tests/brands/_dom-harness';

/**
 * The review share window ("검수 · 공유" on the finished export, export-keep.tsx) is modal: while it is open the
 * editor's keys do nothing, so a Delete or Backspace meant for the window never removes a cut behind it, and
 * Escape closes only the window (it closes itself). Without the window the same key edits the film as before.
 */
let dom: MountedDom | null = null;

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A key as the browser delivers it to the editor's window listener. */
function press(code: string, key: string, target: unknown) {
  const event = { type: 'keydown', code, key, target, keyCode: 0, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  (window as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(event);
}

async function mountSample(withWindow: boolean) {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, projects: [], shares: [] }), { headers: { 'Content-Type': 'application/json' } })));
  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
  const { ShareReviewDialog } = await import('@/components/brand-studio/share-review-dialog');
  dom = await mountDom(null);
  // What the fake document lacks and these screens read: `dataset` (the preview) and a `<select>`'s `options`.
  const element = Object.getPrototypeOf(Object.getPrototypeOf(dom.document.createElement('select'))) as object;
  if (!('dataset' in element)) {
    Object.defineProperty(element, 'dataset', {
      get(this: { attributes: Record<string, string> }) {
        const attributes = this.attributes;
        const name = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        return new Proxy({}, { get: (_t, key) => attributes[name(String(key))], set: (_t, key, value) => ((attributes[name(String(key))] = String(value)), true) });
      },
    });
  }
  const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
  if (!('options' in select)) {
    Object.defineProperty(select, 'options', {
      get(this: { children: unknown[] }) {
        return this.children;
      },
    });
  }
  await dom.rerender(
    <>
      <EditorV2 copy={studioEditorKo} currentEditorHref="/brand/studio/compose?classic=1" real={null} />
      {withWindow && <ShareReviewDialog target={{ organizationId: '00000000-0000-4000-8000-0000000000aa', assetId: '30000000-0000-4000-8000-0000000000a1' }} onClose={() => undefined} />}
    </>,
  );
  return dom;
}

const cuts = () => dom!.queryAll('[data-editor-clip]').length;

describe('keys while the review share window is open', () => {
  it('without the window, Delete removes the selected cut (the control)', async () => {
    await mountSample(false);
    const before = cuts();
    expect(before).toBeGreaterThan(1);
    // Select the first cut the keyboard way (Enter on the cut).
    await dom!.keyDown('Enter', { target: dom!.query('[data-editor-clip="1"]') });
    expect(dom!.query('[data-editor-clip="1"]')?.hasAttribute('data-selected')).toBe(true);
    const { act } = await import('react');
    await act(async () => press('Delete', 'Delete', dom!.document.body));
    expect(cuts()).toBe(before - 1);
  });

  it('with the window open, Delete and Backspace leave the film alone', async () => {
    await mountSample(true);
    expect(dom!.document.querySelector('[data-share-review-dialog]')).not.toBeNull();
    const before = cuts();
    // Select the first cut the keyboard way (Enter on the cut).
    await dom!.keyDown('Enter', { target: dom!.query('[data-editor-clip="1"]') });
    expect(dom!.query('[data-editor-clip="1"]')?.hasAttribute('data-selected')).toBe(true);
    const { act } = await import('react');
    await act(async () => press('Delete', 'Delete', dom!.document.body));
    await act(async () => press('Backspace', 'Backspace', dom!.document.body));
    expect(cuts()).toBe(before);
  });
});
