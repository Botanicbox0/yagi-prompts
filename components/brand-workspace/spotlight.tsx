'use client';
import { useEffect } from 'react';

/** The cards that carry the cursor light (workspace.css "Cursor spotlight"). */
const CARDS = '.bw-campaign-card, .bw-post-card, .bw-production-template, .bw-shortlist-card, .bw-format-card';

/**
 * One delegated pointermove for the whole workspace: the card under the cursor gets `--mouse-x` and
 * `--mouse-y`, written once per frame. Mouse and trackpad only, and never with reduced motion.
 */
export function WorkspaceSpotlight() {
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const event = last;
      if (!event || !(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>(CARDS);
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', `${Math.round(event.clientX - box.left)}px`);
      card.style.setProperty('--mouse-y', `${Math.round(event.clientY - box.top)}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !fine.matches || still.matches) return;
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => {
      document.removeEventListener('pointermove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
