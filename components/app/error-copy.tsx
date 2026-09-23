'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The `(app)` error boundary's copy, handed down by the server layout (audit P1-3).
 *
 * `error.tsx` must be a client component, and importing `getDictionary` there would ship BOTH
 * dictionaries in every app page's bundle. The layout already knows the locale, so it resolves
 * these four strings on the server and provides them here; the boundary (rendered inside the
 * layout) reads them from context.
 */
export interface AppErrorCopy {
  locale: string;
  title: string;
  body: string;
  retry: string;
  home: string;
  homeHref: string;
}

const AppErrorCopyContext = createContext<AppErrorCopy | null>(null);

export function AppErrorCopyProvider({ copy, children }: { copy: AppErrorCopy; children: ReactNode }) {
  return <AppErrorCopyContext.Provider value={copy}>{children}</AppErrorCopyContext.Provider>;
}

export function useAppErrorCopy(): AppErrorCopy | null {
  return useContext(AppErrorCopyContext);
}
