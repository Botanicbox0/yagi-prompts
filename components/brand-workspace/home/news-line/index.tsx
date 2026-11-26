'use client';
/**
 * The home's news line (docs/BRAND-PROJECT-SPINE.md §6, slice 3b): renders one announcement
 * between the top row and the prompt bar in either `line` or `banner` shape, hides at once
 * when closed, moves focus to the prompt bar field, and sends `news.dismiss` once.
 */
import { useRef, useState, type MouseEvent } from 'react';
import { StudioIcon } from '@/components/brand-studio/icons';
import { dismissBrandAnnouncement, type BrandNewsDismissResult } from '@/components/brand-workspace/news-api';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import {
  INITIAL_DISMISS_STATE,
  buildNewsLineView,
  closeNewsLine,
  isNewsLineVisible,
  type BrandNewsCopy,
} from './model';
import s from './news-line.module.css';

export type { BrandNewsCopy } from './model';

export interface HomeNewsLineProps {
  organizationId?: string;
  news: HomeAnnouncement;
  copy: BrandNewsCopy;
  /** Optional override for tests (defaults to `dismissBrandAnnouncement` when `organizationId` is set). */
  dismiss?: (organizationId: string, announcementId: string) => Promise<BrandNewsDismissResult>;
  /** Admin preview mode (Batch B): renders the real frame without dismissing or calling the network. */
  preview?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function moveFocusAfterClose(section: HTMLElement | null) {
  if (typeof document === 'undefined') return;
  const parent = section?.parentElement ?? null;
  const field = (parent?.querySelector('[data-home-prompt-field]') ??
    document.querySelector('[data-home-prompt-field]')) as (HTMLElement & { disabled?: boolean }) | null;
  if (field && !field.disabled) {
    field.focus();
    return;
  }
  if (!parent || !section) return;

  const children = Array.from(parent.children);
  const lineIndex = children.indexOf(section);
  if (lineIndex < 0) return;

  const ignored = new Set<Element>();
  for (let i = 0; i <= lineIndex; i += 1) {
    const child = children[i];
    if (!child) continue;
    ignored.add(child);
    for (const nested of Array.from(child.querySelectorAll(FOCUSABLE_SELECTOR))) {
      ignored.add(nested);
    }
  }

  for (const candidate of Array.from(parent.querySelectorAll(FOCUSABLE_SELECTOR))) {
    if (ignored.has(candidate)) continue;
    const target = candidate as HTMLElement & { disabled?: boolean };
    if (target.disabled || target.getAttribute('aria-hidden') === 'true') continue;
    target.focus();
    return;
  }
}

export function HomeNewsLine({ organizationId, news, copy, dismiss, preview = false }: HomeNewsLineProps) {
  const [dismissState, setDismissState] = useState(INITIAL_DISMISS_STATE);
  const sentIdRef = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  if (!preview && !isNewsLineVisible(dismissState, news.id)) {
    return null;
  }

  const view = buildNewsLineView(news, copy);
  const handlePreviewLinkClick = preview ? (event: MouseEvent<HTMLAnchorElement>) => event.preventDefault() : undefined;

  const handleClose = () => {
    if (preview) return;
    const transition = closeNewsLine(dismissState, view.id);
    if (!transition.shouldSend || sentIdRef.current === view.id) return;
    sentIdRef.current = view.id;

    moveFocusAfterClose(sectionRef.current);

    setDismissState(transition.next);

    if (organizationId) {
      const send = dismiss ?? dismissBrandAnnouncement;
      void send(organizationId, view.id).catch(() => {});
    }
  };

  if (view.shape === 'banner' && view.image) {
    return (
      <section ref={sectionRef} className={s.banner} data-home-news={view.id} data-shape="banner" aria-label={view.sectionLabel}>
        <div className={s.bannerMedia} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={s.bannerImage}
            src={view.image.url}
            width={view.image.width}
            height={view.image.height}
            alt=""
            loading="eager"
            decoding="async"
          />
        </div>
        <div className={s.bannerCopy}>
          <span className={s.kicker}>{view.kicker}</span>
          <p className={s.bannerTitle} title={view.title}>
            {view.title}
          </p>
          <div className={s.bannerActions}>
            <a
              href={view.link.href}
              className={`bs-btn ${s.link}`}
              data-variant="soft"
              data-size="sm"
              data-home-news-link=""
              onClick={handlePreviewLinkClick}
            >
              {view.ctaLabel}
            </a>
          </div>
        </div>
        <button
          type="button"
          className={s.bannerClose}
          aria-label={view.closeLabel}
          data-home-news-close=""
          onClick={handleClose}
        >
          <StudioIcon name="close" />
        </button>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className={s.line} data-home-news={view.id} data-shape="line" aria-label={view.sectionLabel}>
      <span className={s.kicker}>{view.kicker}</span>
      <p className={s.title} title={view.title}>
        {view.title}
      </p>
      <a
        href={view.link.href}
        className={`bs-btn ${s.link}`}
        data-variant="soft"
        data-size="sm"
        data-home-news-link=""
        onClick={handlePreviewLinkClick}
      >
        {view.ctaLabel}
      </a>
      <button
        type="button"
        className={s.lineClose}
        aria-label={view.closeLabel}
        data-home-news-close=""
        onClick={handleClose}
      >
        <StudioIcon name="close" />
      </button>
    </section>
  );
}
