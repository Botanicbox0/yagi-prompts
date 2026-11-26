/**
 * Pure presentation and dismiss-state transitions for the home's news line
 * (docs/BRAND-PROJECT-SPINE.md §6, slice 3b). No React, DOM, or server imports.
 */
import type { BrandNewsShape, HomeAnnouncement } from '@/lib/brand-news/contracts';

export interface BrandNewsCopy {
  kickerDefault: string;
  ctaDefault: string;
  close: string;
}

export interface NewsLineLinkAttrs {
  href: string;
}

export interface NewsLineView {
  id: string;
  shape: BrandNewsShape;
  sectionLabel: string;
  kicker: string;
  title: string;
  ctaLabel: string;
  closeLabel: string;
  link: NewsLineLinkAttrs;
  image: HomeAnnouncement['image'];
}

export interface NewsLineDismissState {
  dismissedId: string | null;
}

export interface NewsLineCloseTransition {
  next: NewsLineDismissState;
  shouldSend: boolean;
}

export const INITIAL_DISMISS_STATE: NewsLineDismissState = { dismissedId: null };

export function resolveNewsLineShape(news: Pick<HomeAnnouncement, 'shape' | 'image'>): BrandNewsShape {
  return news.shape === 'banner' && news.image !== null ? 'banner' : 'line';
}

export function newsLineLinkAttrs(news: Pick<HomeAnnouncement, 'href' | 'external'>): NewsLineLinkAttrs {
  // Both internal (`/brand/...`) and external (`https://...twings.app`) links open in the same tab.
  void news.external;
  return { href: news.href };
}

export function buildNewsLineView(news: HomeAnnouncement, copy: BrandNewsCopy): NewsLineView {
  const shape = resolveNewsLineShape(news);
  return {
    id: news.id,
    shape,
    sectionLabel: copy.kickerDefault,
    kicker: news.kicker && news.kicker !== '' ? news.kicker : copy.kickerDefault,
    title: news.title,
    ctaLabel: news.ctaLabel && news.ctaLabel !== '' ? news.ctaLabel : copy.ctaDefault,
    closeLabel: copy.close,
    link: newsLineLinkAttrs(news),
    image: shape === 'banner' ? news.image : null,
  };
}

export function isNewsLineVisible(state: NewsLineDismissState, announcementId: string): boolean {
  return state.dismissedId !== announcementId;
}

export function closeNewsLine(state: NewsLineDismissState, announcementId: string): NewsLineCloseTransition {
  if (state.dismissedId === announcementId) {
    return { next: state, shouldSend: false };
  }
  return {
    next: { dismissedId: announcementId },
    shouldSend: true,
  };
}
