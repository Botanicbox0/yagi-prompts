import type { CreatorSession } from '@/lib/auth/observe-creator-session';
import { makerHandleOf } from './profile';

export interface MakerSessionState {
  signedIn: boolean;
  active: boolean;
  handle: string | null;
}

const INITIAL: MakerSessionState = Object.freeze({
  signedIn: false,
  active: false,
  handle: null,
});

let state: MakerSessionState = INITIAL;
const listeners = new Set<() => void>();

export function subscribeMakerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function makerSessionSnapshot(): MakerSessionState {
  return state;
}

export function serverMakerSessionSnapshot(): MakerSessionState {
  return INITIAL;
}

export function publishMakerSession(session: CreatorSession): void {
  const next: MakerSessionState = !session.signedIn
    ? INITIAL
    : {
        signedIn: true,
        active: session.maker?.active === true,
        handle: session.maker?.active ? makerHandleOf(session.maker.handle) : null,
      };
  if (
    state.signedIn === next.signedIn &&
    state.active === next.active &&
    state.handle === next.handle
  ) {
    return;
  }
  state = next;
  for (const listener of [...listeners]) listener();
}

export function resetMakerSessionStore(): void {
  state = INITIAL;
  listeners.clear();
}
