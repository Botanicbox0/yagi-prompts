'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** The first thing to press in the studio, in page order (the studio's own sticky bar used the same). */
const MAKE_FOCUS = '[data-selfie-use], [data-selfie-camera], [data-selfie-choose], [data-pay-cta]:not(:disabled), [data-studio-signin], [data-studio-interest]:not(:disabled)';

/**
 * The make panel as a sheet (founder, 2026-10-29): the long make card — studio, photo guide,
 * refund and AI notes — no longer stretches the template page's right column, so the recipe sits
 * right under the example. It is a native `<dialog>` (focus trap, Esc closes): a bottom sheet on a
 * phone, a centred panel on a desktop.
 *
 * Every way into the make card still works because they all say `#make`: the launcher, the
 * "my selfie → this scene" strip, the recipe box, and the sign-in / face-check return addresses.
 * The sheet opens on that hash (on load and on change) and on any `#make` link click, and drops the
 * hash when it closes so the same link opens it again. The content is server-rendered inside, so the
 * studio mounts — and asks for this reader's access — while the sheet is still closed.
 */
export function MakeSheet({ title, closeLabel, children }: { title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const open = () => {
      if (!dialog.open) dialog.showModal();
      const target = dialog.querySelector<HTMLElement>(MAKE_FOCUS);
      target?.focus({ preventScroll: true });
    };
    const fromHash = () => { if (window.location.hash === '#make') open(); };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href="#make"]');
      if (!link) return;
      event.preventDefault();
      if (window.location.hash !== '#make') window.history.replaceState(null, '', '#make');
      open();
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const onClose = () => {
    if (window.location.hash === '#make') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  return (
    <dialog
      ref={ref}
      data-make-sheet
      aria-label={title}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}
      className="fixed inset-x-0 bottom-0 m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[24px] bg-white p-0 text-black shadow-[0_24px_60px_-24px_rgba(12,15,20,0.22),0_0_0_1px_rgba(12,15,20,0.08)] backdrop:bg-black/55 md:inset-0 md:m-auto md:max-h-[88vh] md:max-w-lg md:rounded-[24px]"
    >
      <div className="sticky top-0 z-10 border-b border-hairline bg-white/95 px-5 pt-2.5 pb-3 backdrop-blur">
        <div data-make-sheet-handle aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/15 md:hidden" />
        <div className="flex items-center justify-between gap-4">
          <p className="truncate text-sm font-semibold">{title}</p>
          <button type="button" data-make-sheet-close onClick={() => ref.current?.close()} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-xl leading-none text-black/75 transition-colors hover:bg-black/[0.05] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3875C5]" aria-label={closeLabel}>×</button>
        </div>
      </div>
      <div className="px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}
