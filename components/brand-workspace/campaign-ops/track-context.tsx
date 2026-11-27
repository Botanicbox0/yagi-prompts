'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

interface TrackEntry {
  id: string;
  pathname: string;
  track: string;
}

interface TrackContextValue {
  pathname: string;
  track: string | null;
  setTrack: (id: string, pathname: string, track: string) => void;
  clearTrack: (id: string) => void;
}

const CampaignOpsTrackContext = createContext<TrackContextValue | null>(null);

export function CampaignOpsTrackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const [entry, setEntry] = useState<TrackEntry | null>(null);

  const setTrack = useCallback((id: string, nextPath: string, nextTrack: string) => {
    setEntry((prev) =>
      prev && prev.id === id && prev.pathname === nextPath && prev.track === nextTrack
        ? prev
        : { id, pathname: nextPath, track: nextTrack },
    );
  }, []);

  const clearTrack = useCallback((id: string) => {
    setEntry((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const value = useMemo<TrackContextValue>(
    () => ({
      pathname,
      track: entry && entry.pathname === pathname ? entry.track : null,
      setTrack,
      clearTrack,
    }),
    [entry, pathname, setTrack, clearTrack],
  );

  return <CampaignOpsTrackContext.Provider value={value}>{children}</CampaignOpsTrackContext.Provider>;
}

export function CampaignOpsTrackMarker({ track }: { track: string }) {
  const id = useId();
  const ctx = useContext(CampaignOpsTrackContext);
  const pathname = ctx?.pathname ?? '';
  const setTrack = ctx?.setTrack;
  const clearTrack = ctx?.clearTrack;

  useEffect(() => {
    if (!setTrack || !clearTrack) return undefined;
    setTrack(id, pathname, track);
    return () => clearTrack(id);
  }, [id, pathname, track, setTrack, clearTrack]);

  return null;
}

export function useCampaignOpsTrack(): string | null {
  return useContext(CampaignOpsTrackContext)?.track ?? null;
}
