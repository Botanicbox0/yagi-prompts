'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ClipIndexItem {
  id: string;
  n: number;
  title: string;
}

export const CLIP_INDEX_MIN = 3;

export function useActiveClip(ids: readonly string[]) {
  const firstId = ids[0] ?? null;
  const [activeId, setActiveId] = useState<string | null>(firstId);
  const lockUntilRef = useRef(0);
  const idsKey = ids.join('|');

  useEffect(() => {
    const idList = idsKey ? idsKey.split('|') : [];
    if (idList.length === 0) {
      setActiveId(null);
      return;
    }

    const hashId = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    if (hashId && idList.includes(hashId)) {
      setActiveId(hashId);
    } else {
      setActiveId((current) => (current && idList.includes(current) ? current : idList[0]!));
    }

    if (typeof IntersectionObserver === 'undefined') return;
    const elements = idList
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        if (Date.now() < lockUntilRef.current) return;
        const firstVisible = idList.find((id) => visible.has(id));
        if (firstVisible) setActiveId(firstVisible);
      },
      { rootMargin: '-12% 0px -65% 0px', threshold: 0 },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [idsKey]);

  const jumpTo = useCallback((id: string) => {
    setActiveId(id);
    lockUntilRef.current = Date.now() + 700;
    if (typeof document === 'undefined') return;
    const target = document.getElementById(id);
    if (target) {
      const reduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', `#${id}`);
    }
  }, []);

  return { activeId, jumpTo };
}

export interface ClipIndexProps {
  items: readonly ClipIndexItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  label: string;
  variant: 'chips' | 'rail';
}

/**
 * Numbered clip index:
 *   - Hidden when fewer than 3 cards (per brief).
 *   - `chips`: horizontal scrollable strip sticky at top on viewports < lg.
 *   - `rail`: vertical sticky list on the right on viewports >= lg.
 */
export function ClipIndex({ items, activeId, onSelect, label, variant }: ClipIndexProps) {
  const stripRef = useRef<HTMLUListElement | null>(null);
  const activeChipRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (variant !== 'chips') return;
    const strip = stripRef.current;
    const chip = activeChipRef.current;
    if (!strip || !chip) return;
    const chipLeft = chip.offsetLeft;
    const chipRight = chipLeft + chip.offsetWidth;
    if (chipLeft < strip.scrollLeft) {
      strip.scrollTo({ left: Math.max(0, chipLeft - 8), behavior: 'smooth' });
    } else if (chipRight > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: chipRight - strip.clientWidth + 8, behavior: 'smooth' });
    }
  }, [activeId, variant]);

  if (items.length < CLIP_INDEX_MIN) return null;

  if (variant === 'chips') {
    return (
      <nav
        data-recipe-clip-index="chips"
        aria-label={label}
        className="sticky top-16 z-20 -mx-1 mt-4 border-b border-[#09090B]/[0.08] bg-white/95 px-1 py-2.5 backdrop-blur-md lg:hidden"
      >
        <ul
          ref={stripRef}
          className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  ref={active ? activeChipRef : undefined}
                  href={`#${item.id}`}
                  data-clip-index-item={item.n}
                  data-active={active ? 'true' : undefined}
                  aria-current={active ? 'location' : undefined}
                  aria-label={`${item.n}. ${item.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(item.id);
                  }}
                  className={`inline-flex min-h-10 items-center rounded-full px-3 text-xs font-semibold tabular-nums transition-colors ${
                    active
                      ? 'bg-[#09090B] text-white'
                      : 'bg-[#F4F4F5] text-[#52525B] hover:bg-[#E4E4E7] hover:text-[#09090B]'
                  }`}
                >
                  {String(item.n).padStart(2, '0')}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      data-recipe-clip-index="rail"
      aria-label={label}
      className="hidden border-l border-[#09090B]/[0.08] pl-4 lg:sticky lg:top-24 lg:block"
    >
      <p className="text-xs font-semibold tracking-[-0.01em] text-[#71717A]">{label}</p>
      <ol className="mt-2.5 max-h-[calc(100vh-8rem)] space-y-1 overflow-y-auto pr-1">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                data-clip-index-item={item.n}
                data-active={active ? 'true' : undefined}
                aria-current={active ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(item.id);
                }}
                className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  active
                    ? 'bg-[#F4F4F5] font-semibold text-[#09090B]'
                    : 'font-medium text-[#71717A] hover:bg-[#F4F4F5]/70 hover:text-[#09090B]'
                }`}
              >
                <span className="shrink-0 tabular-nums">{String(item.n).padStart(2, '0')}</span>
                <span className="min-w-0 truncate break-keep">{item.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
