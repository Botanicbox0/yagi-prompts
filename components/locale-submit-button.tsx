'use client';

import { useFormStatus } from 'react-dom';

/** A small client island: the dictionaries and return-path forms stay on the server. */
export function LocaleSubmitButton({ current, label }: { current: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-current={current ? 'true' : undefined}
      aria-busy={pending}
      disabled={current || pending}
      className={`relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm px-2 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default ${current ? 'text-accent' : 'opacity-60 hover:opacity-100'} ${pending ? 'opacity-60' : ''}`}
    >
      {pending && <span aria-hidden="true" className="absolute left-0 size-2 animate-spin rounded-full border border-current border-t-transparent motion-reduce:animate-none" />}
      {label}
    </button>
  );
}
