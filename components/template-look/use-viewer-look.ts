'use client';

import { useSyncExternalStore } from 'react';
import type { ViewerLook } from '@/lib/prompts/facets';
import { lookSnapshot, serverLookSnapshot, subscribeLook, viewerLookOf, type LookState } from '@/lib/template-look/store';

const noopSubscribe = () => () => {};

/**
 * The shared style state (lib/template-look/store.ts). `enabled` false (the switch off) never subscribes and always
 * answers the server snapshot, so a component that carries the hook unconditionally behaves exactly as before.
 */
export function useLookState(enabled: boolean): LookState {
  return useSyncExternalStore(enabled ? subscribeLook : noopSubscribe, enabled ? lookSnapshot : serverLookSnapshot, serverLookSnapshot);
}

/** The viewer's style for THIS page view; null when the switch is off. */
export function useViewerLook(enabled: boolean): ViewerLook | null {
  const state = useLookState(enabled);
  if (!enabled) return null;
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  return viewerLookOf(state, pathname);
}
