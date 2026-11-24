'use client';

import { useEffect, useRef, useState } from 'react';
import { IDENTITY_SELFIE_PATH } from '@/lib/identity/links';
import { ANONYMOUS_SESSION, observeCreatorSession, type CreatorSession } from '@/lib/auth/observe-creator-session';
import { publishLookSession } from '@/lib/template-look/store';

export interface CreatorAccountLabels {
  signIn: string; profile: string; selfie: string; renders: string; campaigns: string; signOut: string; menu: string; fallbackName: string;
}

export function CreatorAccountView({ session, labels, signInHref }: { session: CreatorSession; labels: CreatorAccountLabels; signInHref: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!session.signedIn) return;
    const close = (event: PointerEvent) => { if (!details.current?.contains(event.target as Node)) details.current?.removeAttribute('open'); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.removeAttribute('open'); details.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [session.signedIn]);
  if (!session.signedIn) return <a data-creator-signin href={signInHref} className="inline-flex min-h-10 items-center rounded-full border border-current px-3 py-2 text-xs font-medium sm:px-4">{labels.signIn}</a>;
  const name = session.displayName ?? labels.fallbackName;
  return (
    <details ref={details} data-creator-account className="relative">
      <summary aria-label={`${name} · ${labels.menu}`} className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-hairline p-1 lg:pr-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{Array.from(name)[0]?.toUpperCase()}<span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white bg-accent" /></span>
        <span className="hidden max-w-24 truncate text-xs font-medium lg:block">{name}</span>
        <span aria-hidden="true" className="hidden text-xs lg:block">⌄</span>
      </summary>
      <div className="absolute right-0 top-full z-[60] mt-2 min-w-48 rounded-2xl border border-hairline bg-white p-2 text-sm shadow-lg">
        <a href="/account" className="flex min-h-11 items-center rounded-xl px-3 hover:bg-black/5">{labels.profile}</a>
        <a href={IDENTITY_SELFIE_PATH} data-creator-selfie className="flex min-h-11 items-center rounded-xl px-3 hover:bg-black/5">{labels.selfie}</a>
        <a href="/renders" className="flex min-h-11 items-center rounded-xl px-3 hover:bg-black/5">{labels.renders}</a>
        <a href="/campaigns/mine" className="flex min-h-11 items-center rounded-xl px-3 hover:bg-black/5">{labels.campaigns}</a>
        <form method="post" action="/auth/signout" className="mt-1 border-t border-hairline pt-1"><button type="submit" className="flex min-h-11 w-full items-center rounded-xl px-3 text-left opacity-65 hover:bg-black/5">{labels.signOut}</button></form>
      </div>
    </details>
  );
}

export function useCreatorSession(enabled: boolean) {
  const [session, setSession] = useState<CreatorSession>(ANONYMOUS_SESSION);
  useEffect(() => {
    if (!enabled) { setSession(ANONYMOUS_SESSION); return; }
    return observeCreatorSession({
      window, document, now: Date.now,
      fetch: signal => fetch('/api/account/session', { signal, credentials: 'same-origin', cache: 'no-store' }),
    }, (next) => {
      setSession(next);
      // docs/PERSONAL-STUDIO.md §3.4.10: the template style islands read this answer instead of asking again.
      publishLookSession(next);
    });
  }, [enabled]);
  return session;
}
