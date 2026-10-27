'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { STORE_SHELL_ATTRIBUTE } from '@/lib/mobile/store-shell';

/**
 * Client side of lib/mobile/store-shell.ts. The `<head>` script has already decided before React
 * runs; these only read `<html data-store-shell>`. null until mounted, like useStandaloneDisplay —
 * a static page cannot know.
 */
export function useStoreShell(): boolean | null {
  const [shell, setShell] = useState<boolean | null>(null);
  useEffect(() => {
    setShell(document.documentElement.hasAttribute(STORE_SHELL_ATTRIBUTE));
  }, []);
  return shell;
}

/**
 * Checkout pages: inside the Play app the payment widget never loads; the note stands in. Nothing
 * renders until the page has looked, so the Toss script is not fetched in the app even for a moment.
 */
export function StoreShellGate({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const shell = useStoreShell();
  if (shell === null) return null;
  return <>{shell ? fallback : children}</>;
}

/** What a checkout page shows inside the app: two sentences, no link (Play Payments policy). */
export function StoreCheckoutNote({ title, body }: { title: string; body: string }) {
  return (
    <section data-store-checkout-note className="mt-8 rounded-2xl border border-hairline p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-black/70">{body}</p>
    </section>
  );
}
