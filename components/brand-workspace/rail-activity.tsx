'use client';
/**
 * The rail's live studio state (docs/BRAND-STUDIO-V3.md §3, slice A): the credits meter, the running
 * count on 이미지 / 영상, and the toast when a job finishes while the person is on another screen.
 *
 * Reads `GET /api/brand-studio/summary`. While this person has a job running it reads it again every
 * 20 s and also calls the board's own poll (`GET /api/brand-studio?jobs=…`) for the jobs whose board is
 * not on screen, so they keep moving anywhere in the workspace. It refreshes at once on
 * STUDIO_JOB_STARTED / STUDIO_JOB_SETTLED (components/brand-studio/seams.ts) and when the tab returns.
 * A 401/403/404 (flag off, sandboxed or closed brand, not a member) stops it for this page: no meter.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { STUDIO_JOB_SETTLED, STUDIO_JOB_STARTED } from '@/components/brand-studio/seams';
import { ROOM_ACTIVITY, type RoomSummary } from '@/components/brand-rooms/seams';
import { refillWording, windowDayInstant, withoutLastSentence, type RefillWording } from '@/lib/brand-studio/allowance-window';
import { creditsLeft, creditsOf, formatCredits } from '@/lib/brand-studio/credits';
import type { StudioSummary } from '@/lib/brand-studio/summary';
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import {
  GROUP_SCREEN,
  RAIL_JOBS_SESSION_KEY,
  countByGroup,
  foldSummary,
  jobGroup,
  onBoardFor,
  parseJobMemory,
  toastFor,
  type RailJobMemory,
  type RailToast,
} from './rail-model';

export const RAIL_POLL_MS = 20_000;
const TOAST_MS = 9_000;
const SUMMARY_ENDPOINT = '/api/brand-studio/summary';

export type RailSummary = Omit<StudioSummary, 'ok'>;

function readMemory(): RailJobMemory {
  try {
    return parseJobMemory(window.sessionStorage.getItem(RAIL_JOBS_SESSION_KEY));
  } catch {
    return { open: [], announced: [] };
  }
}
function writeMemory(memory: RailJobMemory): void {
  try {
    window.sessionStorage.setItem(RAIL_JOBS_SESSION_KEY, JSON.stringify(memory));
  } catch {
    // Storage blocked: toasts still work within this page.
  }
}

export function useStudioActivity({ organizationId, enabled, path }: { organizationId: string | null; enabled: boolean; path: string }) {
  const [summary, setSummary] = useState<RailSummary | null>(null);
  const [toasts, setToasts] = useState<RailToast[]>([]);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  const memory = useRef<RailJobMemory>({ open: [], announced: [] });
  const stopped = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const active = Boolean(enabled && organizationId);

  const push = useCallback((next: RailToast[]) => {
    if (next.length > 0) setToasts((current) => [...current.filter((t) => !next.some((n) => n.id === t.id)), ...next].slice(-3));
  }, []);

  const load = useCallback((): Promise<void> => {
    if (!active || stopped.current) return Promise.resolve();
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const response = await fetch(`${SUMMARY_ENDPOINT}?organizationId=${encodeURIComponent(organizationId!)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          stopped.current = true;
          setSummary(null);
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as StudioSummary | { ok: false };
        if (!body || body.ok !== true) return;
        const folded = foldSummary(memory.current, body, pathRef.current);
        memory.current = folded.memory;
        writeMemory(folded.memory);
        setSummary({ allowance: body.allowance, open: body.open, settled: body.settled });
        push(folded.toasts);
      } catch {
        // Offline or a deploy in progress: the next tick tries again.
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [active, organizationId, push]);

  // First read, with what this tab remembered from the previous page.
  useEffect(() => {
    if (!active) return;
    memory.current = readMemory();
    void load();
  }, [active, load]);

  // Events from the studio screens and the tab coming back.
  useEffect(() => {
    if (!active) return;
    const started = (event: Event) => {
      const id = (event as CustomEvent<{ jobId?: unknown }>).detail?.jobId;
      if (typeof id === 'string' && !memory.current.open.includes(id)) {
        memory.current = { ...memory.current, open: [...memory.current.open, id] };
        writeMemory(memory.current);
      }
      void load();
    };
    const settled = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: unknown; status?: unknown; kind?: unknown }>).detail;
      if (detail && typeof detail.jobId === 'string' && typeof detail.kind === 'string' && typeof detail.status === 'string') {
        const announced = new Set(memory.current.announced);
        const toast = toastFor(
          { id: detail.jobId, kind: detail.kind, status: detail.status as 'succeeded' | 'failed' | 'canceled' },
          pathRef.current,
          announced,
        );
        memory.current = { open: memory.current.open.filter((id) => id !== detail.jobId), announced: [...announced, detail.jobId].slice(-60) };
        writeMemory(memory.current);
        if (toast) push([toast]);
      }
      void load();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener(STUDIO_JOB_STARTED, started);
    window.addEventListener(STUDIO_JOB_SETTLED, settled);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener(STUDIO_JOB_STARTED, started);
      window.removeEventListener(STUDIO_JOB_SETTLED, settled);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, load, push]);

  // While something runs: keep it moving (off its board) and read the summary again.
  const openKey = summary?.open.map((j) => `${j.id}:${j.kind}`).join(',') ?? '';
  useEffect(() => {
    if (!active || !openKey) return;
    const jobs = openKey.split(',').map((pair) => {
      const [id, kind] = pair.split(':');
      return { id: id!, kind: kind! };
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const away = jobs.filter((j) => !onBoardFor(jobGroup(j.kind), pathRef.current)).map((j) => j.id);
      const poll = away.length
        ? fetch(`/api/brand-studio?organizationId=${encodeURIComponent(organizationId!)}&jobs=${away.join(',')}`, {
            cache: 'no-store',
            credentials: 'same-origin',
          }).catch(() => undefined)
        : Promise.resolve(undefined);
      void poll.then(() => load());
    }, RAIL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, openKey, organizationId, load]);

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  return {
    summary,
    counts: summary ? countByGroup(summary.open) : { image: 0, video: 0, sound: 0 },
    toasts,
    dismiss,
  };
}

/* ----------------------------------------------------------------- room unread (docs/BRAND-ROOMS.md §2) */

export const ROOM_UNREAD_POLL_MS = 30_000;
const ROOM_SUMMARY_ENDPOINT = '/api/brand-rooms/summary';

/** The total from a summary body; anything unexpected reads as zero. */
export function unreadFrom(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const { ok, unread } = body as Partial<RoomSummary>;
  return ok === true && typeof unread === 'number' && Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
}

/**
 * Unread messages across every room this person may open, for the 메시지 badge. Read on load, every
 * 30 s while the tab is visible, on ROOM_ACTIVITY, when the window gets focus and when the tab returns.
 * A 401/403/404 (rooms closed, a sandboxed brand, the route not deployed yet) or any failure reads as
 * zero; the first three also stop the polling for this page.
 */
export function useRoomUnread({ organizationId, enabled }: { organizationId: string | null; enabled: boolean }): number {
  const [unread, setUnread] = useState(0);
  const stopped = useRef(false);
  const inflight = useRef(false);
  const active = Boolean(enabled && organizationId);

  const load = useCallback(async () => {
    if (!active || stopped.current || inflight.current) return;
    inflight.current = true;
    try {
      const response = await fetch(`${ROOM_SUMMARY_ENDPOINT}?organizationId=${encodeURIComponent(organizationId!)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        stopped.current = true;
        setUnread(0);
        return;
      }
      setUnread(response.ok ? unreadFrom(await response.json().catch(() => null)) : 0);
    } catch {
      setUnread(0);
    } finally {
      inflight.current = false;
    }
  }, [active, organizationId]);

  useEffect(() => {
    if (!active) return;
    stopped.current = false;
    void load();
    const refresh = () => void load();
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, ROOM_UNREAD_POLL_MS);
    window.addEventListener(ROOM_ACTIVITY, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ROOM_ACTIVITY, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, load]);

  return active ? unread : 0;
}

/* ----------------------------------------------------------------- meter */

export function refillDate(resetsAt: string, locale: 'ko' | 'en'): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date);
}

export interface MeterFigures {
  left: number;
  total: number;
  ratio: number;
  leftText: string;
  totalText: string;
  date: string;
  /** R4: refill words as today's, the trial's words with its last day, or none (extra credits without a trial). */
  refill: RefillWording;
  /** The trial's last day in the same format as `date`; empty unless `refill` is the trial's. */
  trialDate: string;
}

/** Null when the allowance is closed (cap 0): the meter is not shown at all. */
export function meterFigures(allowance: RailSummary['allowance'] | null | undefined, locale: 'ko' | 'en'): MeterFigures | null {
  if (!allowance || !(allowance.capKrw > 0)) return null;
  const total = creditsOf(allowance.capKrw);
  const left = Math.min(total, creditsLeft(allowance.capKrw, allowance.usedKrw));
  const refill = refillWording(allowance.refill);
  return {
    left,
    total,
    ratio: total > 0 ? Math.max(0, Math.min(1, left / total)) : 0,
    leftText: formatCredits(left, locale),
    totalText: formatCredits(total, locale),
    date: refillDate(allowance.resetsAt, locale),
    refill,
    trialDate: refill.kind === 'trial' ? refillDate(windowDayInstant(refill.through).toISOString(), locale) : '',
  };
}

/** The meter's sentence ("크레딧 400 중 120 남았어요. …"), shared by the rail and the home so the two never disagree. */
export function meterSummary(figures: MeterFigures, copy: StudioShellCopy): string {
  const values = { left: figures.leftText, total: figures.totalText };
  if (figures.refill.kind === 'trial') return interpolate(copy.credits.summaryTrial, { ...values, date: figures.trialDate });
  if (figures.refill.kind === 'hidden') return interpolate(withoutLastSentence(copy.credits.summary), values);
  return interpolate(copy.credits.summary, { ...values, date: figures.date });
}

/** The meter's refill line; null when nothing refills and there is no trial (extra credits only). */
export function meterRefillLine(figures: MeterFigures, copy: StudioShellCopy): string | null {
  if (figures.refill.kind === 'trial') return interpolate(copy.credits.refillTrial, { date: figures.trialDate });
  if (figures.refill.kind === 'hidden') return null;
  return interpolate(copy.credits.refill, { date: figures.date });
}

const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

export function CreditsMeter({
  allowance,
  copy,
  locale,
  expanded,
}: {
  allowance: RailSummary['allowance'] | null | undefined;
  copy: StudioShellCopy;
  locale: 'ko' | 'en';
  expanded: boolean;
}) {
  const figures = meterFigures(allowance, locale);
  if (!figures) return null;
  const summary = meterSummary(figures, copy);
  const refillLine = meterRefillLine(figures, copy);
  const low = figures.ratio < 0.1;
  return (
    <div
      className="bw-rail-credits"
      data-rail-credits
      data-low={low ? 'true' : undefined}
      data-rail-tip={expanded ? undefined : summary}
      tabIndex={expanded ? undefined : 0}
      role="group"
      aria-label={copy.credits.label}
    >
      <svg className="bw-rail-ring" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={RING_R} className="bw-rail-ring-track" />
        <circle
          cx="10"
          cy="10"
          r={RING_R}
          className="bw-rail-ring-fill"
          strokeDasharray={`${(RING_C * figures.ratio).toFixed(2)} ${RING_C.toFixed(2)}`}
          transform="rotate(-90 10 10)"
        />
      </svg>
      <div className="bw-rail-credits-text">
        <span className="bw-rail-credits-line">
          <span>{copy.credits.label}</span>
          <strong>
            {figures.leftText}
            <span className="bw-rail-credits-total"> / {figures.totalText}</span>
          </strong>
        </span>
        <span
          className="bw-rail-credits-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={figures.total}
          aria-valuenow={figures.left}
          aria-valuetext={summary}
          aria-label={copy.credits.label}
        >
          <span style={{ width: `${(figures.ratio * 100).toFixed(1)}%` }} />
        </span>
        {refillLine !== null ? <span className="bw-rail-credits-refill">{refillLine}</span> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toast */

export function RailToasts({
  toasts,
  copy,
  scope,
  onDismiss,
}: {
  toasts: RailToast[];
  copy: StudioShellCopy;
  scope: (path: string) => string;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), TOAST_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, onDismiss]);
  return (
    <div className="bw-rail-toasts" role="status" aria-live="polite" data-rail-toasts>
      {toasts.map((toast) => {
        const text =
          toast.group === 'image'
            ? toast.outcome === 'done'
              ? copy.toast.imageDone
              : copy.toast.imageFailed
            : toast.group === 'sound'
              ? toast.outcome === 'done'
                ? copy.toast.soundDone
                : copy.toast.soundFailed
              : toast.outcome === 'done'
                ? copy.toast.videoDone
                : copy.toast.videoFailed;
        return (
          <div key={toast.id} className="bw-rail-toast" data-rail-toast={toast.outcome}>
            <span className="bw-rail-toast-dot" aria-hidden="true" />
            <span className="bw-rail-toast-text">{text}</span>
            <a href={scope(GROUP_SCREEN[toast.group])} className="bw-rail-toast-link">
              {copy.toast.view}
            </a>
            <button type="button" className="bw-rail-toast-close" aria-label={copy.toast.dismiss} onClick={() => onDismiss(toast.id)}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
