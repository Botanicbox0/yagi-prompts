"use client";
/**
 * Two small browser readings the studio's tiles and the model comparison size themselves with: a media query
 * (a coarse pointer, a phone-width screen) and an element's own width (one shared ResizeObserver for every
 * element watched). Both answer null / false on the server and until the first reading.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useIsoLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

type Listener = (box: { width: number; height: number }) => void;
let observer: ResizeObserver | null = null;
const listeners = new WeakMap<Element, Listener>();

function shared(): ResizeObserver | null {
  if (observer || typeof ResizeObserver === "undefined") return observer;
  observer = new ResizeObserver((records) => {
    for (const record of records) {
      // The border box, like the first reading (getBoundingClientRect), so a padded element never flips between two widths.
      const border = record.borderBoxSize?.[0];
      const box = border ? { width: border.inlineSize, height: border.blockSize } : { width: record.contentRect.width, height: record.contentRect.height };
      listeners.get(record.target)?.(box);
    }
  });
  return observer;
}

/** The element's border box, kept current (null until it is measured). */
export function useElementSize(ref: RefObject<Element | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    const ro = shared();
    if (!ro) return;
    listeners.set(el, (box) =>
      setSize((current) => (current && Math.abs(current.width - box.width) < 0.5 && Math.abs(current.height - box.height) < 0.5 ? current : box)),
    );
    ro.observe(el);
    return () => {
      ro.unobserve(el);
      listeners.delete(el);
    };
  }, [ref]);
  return size;
}
