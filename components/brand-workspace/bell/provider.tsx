'use client';
/**
 * Shell-wide single-poll bell state for 직접 만들기 (docs/BRAND-PROJECT-SPINE.md §5.1, §8.1; slice 3a).
 * Server passes eligible candidate ids; client decides when the active brand and mode open the bell.
 * One source of truth: the poll machine lives in a ref and is never overwritten during render.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StudioLocale } from '@/components/brand-studio/copy';
import { brandTransport, loadRoomBell } from '@/components/brand-rooms/chat/transport';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
import { studioShowroomVisible, studioV2Visible } from '@/lib/brand-studio/visibility';
import { sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from '../identity';
import {
  RAIL_MODE_COOKIE,
  parseRailModeCookie,
  rememberedRailMode,
  resolveRailMode,
  type RailMode,
} from '../rail-mode';
import {
  BELL_POLL_MS,
  bellActive,
  bellMarkReadTarget,
  bellPollReduce,
  initialBellPollState,
  type BellCopy,
  type BellItem,
  type BellPollMachine,
  type BellPollReason,
  type BellState,
} from './model';

export const RAIL_MODE_CHANGED_EVENT = 'twings:rail-mode-changed';

export interface BellContextValue {
  organizationId: string;
  unread: number;
  items: BellItem[];
  more: boolean;
  loaded: boolean;
  copy: BellCopy | null;
  locale: StudioLocale;
  refresh(): Promise<void>;
  markRead(item: Pick<BellItem, 'kind' | 'projectId' | 'at' | 'unread'>): Promise<void>;
}

export interface BellProviderProps {
  candidates: readonly string[];
  scope: BrandWorkspaceScope;
  railModes?: Readonly<Record<string, RailMode>>;
  rooms?: boolean;
  bellCopy?: BellCopy;
  locale?: StudioLocale;
  children: ReactNode;
}

interface BellViewSnapshot {
  organizationId: string | null;
  active: boolean;
  stopped: boolean;
  bell: BellState | null;
}

const BellContext = createContext<BellContextValue | null>(null);

/** Current bell state when the 직접 만들기 bell is active for this view, otherwise null. */
export function useBell(): BellContextValue | null {
  return useContext(BellContext);
}

function readModeCookie(): Readonly<Record<string, RailMode>> | null {
  if (typeof document === 'undefined') return null;
  try {
    const raw = document.cookie
      .split('; ')
      .find((part) => part.startsWith(`${RAIL_MODE_COOKIE}=`))
      ?.slice(RAIL_MODE_COOKIE.length + 1);
    return raw ? parseRailModeCookie(raw) : {};
  } catch {
    return null;
  }
}

function sameModeMap(
  a: Readonly<Record<string, RailMode>> | null,
  b: Readonly<Record<string, RailMode>> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

function ActiveBellProvider({
  candidates,
  scope,
  railModes,
  rooms = false,
  bellCopy,
  locale = 'ko',
  children,
}: BellProviderProps) {
  const { pathname, selection } = useWorkspaceSelection(scope);
  const choice = selectedChoice(selection);
  const selectedOrgId = choice?.id ?? null;

  const [cookieModes, setCookieModes] = useState<Readonly<Record<string, RailMode>> | null>(null);
  useEffect(() => {
    const syncCookie = () => {
      const next = readModeCookie();
      setCookieModes((prev) => (sameModeMap(prev, next) ? prev : next));
    };
    syncCookie();
    window.addEventListener(RAIL_MODE_CHANGED_EVENT, syncCookie);
    return () => window.removeEventListener(RAIL_MODE_CHANGED_EVENT, syncCookie);
  }, [selectedOrgId]);

  const visible = sectionVisibility(choice);
  const studio = visible.studio && studioV2Visible(choice, true);
  const studioShowroom = Boolean(
    choice && choice.role !== 'guest' && choice.role !== 'studio' && studioShowroomVisible(choice, true),
  );
  const roomsActive = Boolean(rooms && choice && choice.role !== 'studio');
  const remembered = rememberedRailMode(cookieModes ?? railModes ?? {}, selectedOrgId);
  const mode = resolveRailMode({
    studio,
    studioShowroom,
    rooms: roomsActive,
    path: pathname,
    remembered,
  });
  // Activation and polling depend solely on (selectedOrgId, modeActive); path changes inside the same org+mode are no-ops.
  const modeActive = bellActive({ candidates, organizationId: selectedOrgId, mode });

  // One source of truth: machineRef is mutated only via reducer transitions, never overwritten from React state on render.
  const machineRef = useRef<BellPollMachine>(initialBellPollState());
  const [view, setView] = useState<BellViewSnapshot>(() =>
    modeActive && selectedOrgId
      ? { organizationId: selectedOrgId, active: true, stopped: false, bell: null }
      : { organizationId: null, active: false, stopped: false, bell: null },
  );

  const syncMachine = useCallback((next: BellPollMachine) => {
    machineRef.current = next;
    setView((prev) =>
      prev.organizationId === next.organizationId &&
      prev.active === next.active &&
      prev.stopped === next.stopped &&
      prev.bell === next.bell
        ? prev
        : {
            organizationId: next.organizationId,
            active: next.active,
            stopped: next.stopped,
            bell: next.bell,
          },
    );
  }, []);

  const inflightRef = useRef<Promise<void> | null>(null);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const dispatchRead = useCallback(
    async (orgId: string, seq: number): Promise<void> => {
      const res = await loadRoomBell(orgId);
      if (unmountedRef.current) return;
      const answer = res.ok ? { ok: true as const, bell: res.bell } : { ok: false as const, code: res.code };
      const settled = bellPollReduce(machineRef.current, { type: 'answer', organizationId: orgId, seq, result: answer });
      syncMachine(settled.state);
    },
    [syncMachine],
  );

  const startRequest = useCallback(
    (orgId: string, seq: number): Promise<void> => {
      const pending = dispatchRead(orgId, seq).finally(() => {
        if (inflightRef.current === pending) inflightRef.current = null;
      });
      inflightRef.current = pending;
      return pending;
    },
    [dispatchRead],
  );

  const triggerRead = useCallback(
    (reason: BellPollReason): Promise<void> => {
      const targetOrg = machineRef.current.organizationId;
      if (!targetOrg) return Promise.resolve();
      const visibleTab =
        typeof document === 'undefined'
          ? true
          : reason === 'visible'
            ? document.visibilityState === 'visible'
            : document.visibilityState !== 'hidden';
      const { state: next, shouldRead } = bellPollReduce(machineRef.current, {
        type: 'trigger',
        reason,
        visible: visibleTab,
      });
      machineRef.current = next;
      if (!shouldRead) return inflightRef.current ?? Promise.resolve();
      return startRequest(targetOrg, next.seq);
    },
    [startRequest],
  );

  // Sync activation/deactivation strictly with (selectedOrgId, modeActive).
  useEffect(() => {
    if (!modeActive || !selectedOrgId) {
      const deactivated = bellPollReduce(machineRef.current, { type: 'deactivate' });
      syncMachine(deactivated.state);
      return;
    }

    const sameOrg =
      machineRef.current.organizationId !== null &&
      machineRef.current.organizationId.toLowerCase() === selectedOrgId.toLowerCase();
    if (sameOrg && machineRef.current.stopped) return;

    if (!sameOrg || !machineRef.current.active) {
      const activated = bellPollReduce(machineRef.current, {
        type: 'activate',
        organizationId: selectedOrgId,
      });
      syncMachine(activated.state);
      if (activated.shouldRead) {
        void startRequest(selectedOrgId, activated.state.seq);
      }
    } else if (!machineRef.current.bell && !machineRef.current.inflight) {
      void triggerRead('mount');
    }
  }, [modeActive, selectedOrgId, startRequest, syncMachine, triggerRead]);

  // Run the 20 s interval only while active, unstopped, and visible; pause while hidden and resume on visible.
  const pollingActive = Boolean(
    modeActive &&
      selectedOrgId &&
      view.active &&
      !view.stopped &&
      view.organizationId?.toLowerCase() === selectedOrgId.toLowerCase(),
  );
  useEffect(() => {
    if (!pollingActive) return;

    let timer: number | null = null;
    const stopTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const startTimer = () => {
      if (timer !== null) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      timer = window.setInterval(() => {
        void triggerRead('tick');
      }, BELL_POLL_MS);
    };

    const onActivity = () => {
      void triggerRead('activity');
    };
    const onFocus = () => {
      void triggerRead('focus');
    };
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        stopTimer();
        return;
      }
      void triggerRead('visible');
      startTimer();
    };

    startTimer();
    window.addEventListener(ROOM_ACTIVITY, onActivity);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopTimer();
      window.removeEventListener(ROOM_ACTIVITY, onActivity);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollingActive, selectedOrgId, triggerRead]);

  const refresh = useCallback(() => triggerRead('manual'), [triggerRead]);

  const markRead = useCallback(
    async (item: Pick<BellItem, 'kind' | 'projectId' | 'at' | 'unread'>) => {
      const targetOrg = machineRef.current.organizationId;
      const target = bellMarkReadTarget(item);
      if (!targetOrg || !target || !machineRef.current.active || machineRef.current.stopped) return;
      await brandTransport(targetOrg).read?.(target.channel, target.at);
      if (unmountedRef.current) return;
      if (inflightRef.current) await inflightRef.current;
      if (unmountedRef.current || machineRef.current.organizationId?.toLowerCase() !== targetOrg.toLowerCase()) return;
      await triggerRead('manual');
    },
    [triggerRead],
  );

  const activeNow = Boolean(
    modeActive &&
      selectedOrgId &&
      view.active &&
      !view.stopped &&
      view.organizationId?.toLowerCase() === selectedOrgId.toLowerCase(),
  );
  const currentBell = view.bell;
  const activeOrg = view.organizationId;
  const resolvedCopy = bellCopy ?? null;

  const value = useMemo<BellContextValue | null>(
    () =>
      activeNow && activeOrg
        ? {
            organizationId: activeOrg,
            unread: currentBell?.unread ?? 0,
            items: currentBell?.items ?? [],
            more: currentBell?.more ?? false,
            loaded: currentBell !== null,
            copy: resolvedCopy,
            locale,
            refresh,
            markRead,
          }
        : null,
    [activeNow, activeOrg, currentBell, resolvedCopy, locale, refresh, markRead],
  );

  return <BellContext.Provider value={value}>{children}</BellContext.Provider>;
}

export function BellProvider(props: BellProviderProps) {
  if (props.candidates.length === 0) return <>{props.children}</>;
  return <ActiveBellProvider {...props} />;
}
