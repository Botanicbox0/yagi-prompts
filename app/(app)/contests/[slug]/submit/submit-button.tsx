'use client';

import { useFormStatus } from 'react-dom';

/**
 * The entry form's submit control — PLAN §14.2, M9 design review finding 5.
 *
 * The one client component on this route, and it is progressive enhancement rather than a
 * dependency: `useFormStatus` reads the state of the `<form>` it is rendered inside, so with
 * JavaScript blocked this is an ordinary submit button posting to an ordinary server action, which
 * is the property §14.2 asked for. With JavaScript, a form whose POST takes two seconds stops being
 * two seconds of silence — the label changes and the button refuses a second press, which is the
 * actual failure this fixes (a double submit reads as a resubmit and resets the entry to pending).
 *
 * `min-h-12` rather than padding arithmetic: 48px is the touch target, stated once.
 */
export function EntrySubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-submit-state={pending ? 'pending' : 'idle'}
      className="inline-flex min-h-12 items-center border border-accent bg-accent px-6 py-3 font-label text-label text-white uppercase disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
