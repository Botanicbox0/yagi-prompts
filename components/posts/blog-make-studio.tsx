'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { TwingsStudio, type StudioLabels, type StudioStyle } from '@/components/twings/studio';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PublicTemplateLocks } from '@/lib/template-director/locks';
import type { PublicTemplateStyling } from '@/lib/template-director/styling';
import type { TemplatePartRow, TemplatePartsCopy } from '@/lib/template-director/parts-view';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { TemplateLook } from '@/lib/template-look/look';

export interface BlogMakeCardInfo {
  slug: string;
  title: string;
  authorHandle: string | null;
  mediumLabel: string;
  runtimeLabel: string | null;
  aspect: string;
  posterSrc: string | null;
  videoSrc: string | null;
}

export interface BlogMakeModalEntry {
  slug: string;
  title: string;
  style: StudioStyle;
  petOnly: boolean;
  signinHref: string;
  identityHref: string;
  locks?: PublicTemplateLocks;
  styling?: PublicTemplateStyling;
  editsClosed?: string;
  editRoom?: PromptCard['editRoom'];
  parts?: { rows: TemplatePartRow[]; all: boolean; copy: TemplatePartsCopy };
  templateLook?: { look: TemplateLook; note: string };
}

interface BlogMakeContextValue {
  openSlug: (slug: string) => void;
}

const BlogMakeContext = createContext<BlogMakeContextValue | null>(null);

const MAKE_FOCUS =
  '[data-selfie-use], [data-selfie-camera], [data-selfie-choose], [data-pay-cta]:not(:disabled), [data-studio-signin], [data-studio-interest]:not(:disabled)';

export function BlogMakeProvider({
  entries,
  locale,
  shopOpen,
  closeLabel,
  aiLimitNote,
  refundNote,
  photoGuideHeading,
  photoGuideBody,
  photoGuideExamples,
  studioLabels,
  selfieCopy,
  castCopy,
  subscriptionCopy,
  editorCopy,
  editSheetCopy,
  lockCopy,
  renderStudioCopy,
  children,
}: {
  entries: readonly BlogMakeModalEntry[];
  locale: string;
  shopOpen: boolean;
  closeLabel: string;
  aiLimitNote: string;
  refundNote: string;
  photoGuideHeading: string;
  photoGuideBody: string;
  photoGuideExamples: ReadonlyArray<{ id: string; src: string; label: string; crop: string }>;
  studioLabels: StudioLabels;
  selfieCopy: Dictionary['selfie'];
  castCopy: Dictionary['cast']['photo'];
  subscriptionCopy: Dictionary['creatorSubscription'];
  editorCopy: Dictionary['premiumEditor'];
  editSheetCopy?: Dictionary['editSheet'];
  lockCopy: Dictionary['editSheet'];
  renderStudioCopy: {
    badge: string;
    operatorBadge: string;
    freeCta: string;
    submitting: string;
    identityNotice: string;
    identityPending: string;
    identityCta: string;
    errors: Dictionary['renders']['studio']['errors'];
  };
  children: ReactNode;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const bySlug = useMemo(() => new Map(entries.map((entry) => [entry.slug, entry])), [entries]);
  const activeEntry = activeSlug ? (bySlug.get(activeSlug) ?? null) : null;

  const openSlug = useCallback(
    (slug: string) => {
      if (!bySlug.has(slug)) return;
      setActiveSlug(slug);
      if (typeof window !== 'undefined') {
        const nextHash = `#make-${slug}`;
        if (window.location.hash !== nextHash) {
          window.history.replaceState(null, '', nextHash);
        }
      }
    },
    [bySlug],
  );

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash;
      if (hash === '#make' && entries[0]) {
        setActiveSlug(entries[0].slug);
        return;
      }
      if (hash.startsWith('#make-')) {
        const slug = decodeURIComponent(hash.slice('#make-'.length));
        if (bySlug.has(slug)) setActiveSlug(slug);
      }
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [bySlug, entries]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activeEntry) {
      if (!dialog.open) dialog.showModal();
      const target = dialog.querySelector<HTMLElement>(MAKE_FOCUS);
      target?.focus({ preventScroll: true });
    } else if (dialog.open) {
      dialog.close();
    }
  }, [activeEntry]);

  const handleClose = () => {
    setActiveSlug(null);
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#make')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  return (
    <BlogMakeContext.Provider value={{ openSlug }}>
      {children}
      {entries.length > 0 ? (
        <dialog
          ref={dialogRef}
          data-blog-make-sheet
          aria-label={activeEntry?.title ?? ''}
          onClose={handleClose}
          onClick={(event) => {
            if (event.target === event.currentTarget) dialogRef.current?.close();
          }}
          className="fixed inset-x-0 bottom-0 m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[24px] bg-white p-0 text-[#09090B] shadow-[0_24px_60px_-24px_rgba(12,15,20,0.22),0_0_0_1px_rgba(12,15,20,0.08)] backdrop:bg-black/55 md:inset-0 md:m-auto md:max-h-[88vh] md:max-w-lg md:rounded-[24px]"
        >
          {activeEntry ? (
            <>
              <div className="sticky top-0 z-10 border-b border-[#09090B]/[0.08] bg-white/95 px-5 pt-2.5 pb-3 backdrop-blur">
                <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/15 md:hidden" />
                <div className="flex items-center justify-between gap-4">
                  <p className="truncate text-sm font-semibold text-[#09090B]">{activeEntry.title}</p>
                  <button
                    type="button"
                    data-blog-make-sheet-close
                    onClick={() => dialogRef.current?.close()}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-xl leading-none text-[#52525B] transition-colors hover:bg-[#F4F4F5] hover:text-[#09090B]"
                    aria-label={closeLabel}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <section data-blog-template-make={activeEntry.slug}>
                  <TwingsStudio
                    key={activeEntry.slug}
                    styles={[activeEntry.style]}
                    initialStyleId={activeEntry.style.id}
                    shopOpenHint={shopOpen}
                    stickyBar={false}
                    live={{
                      endpoint: '/api/renders',
                      accessEndpoint: '/api/renders/access',
                      interestEndpoint: '/api/notify/interest',
                      template: activeEntry.slug,
                      locale,
                      signinHref: activeEntry.signinHref,
                      identityHref: activeEntry.identityHref,
                      selfie: selfieCopy,
                      cast: castCopy,
                      subscription: { copy: subscriptionCopy, editorCopy },
                      ...(editSheetCopy ? { editSheet: editSheetCopy } : {}),
                      ...(activeEntry.locks ? { locks: activeEntry.locks, lockCopy } : {}),
                      ...(activeEntry.styling ? { styling: activeEntry.styling, lockCopy } : {}),
                      ...(activeEntry.editsClosed ? { editsClosed: activeEntry.editsClosed } : {}),
                      ...(activeEntry.editRoom ? { editRoom: activeEntry.editRoom } : {}),
                      ...(activeEntry.parts ? { parts: activeEntry.parts } : {}),
                      ...(activeEntry.templateLook ? { templateLook: activeEntry.templateLook } : {}),
                      labels: renderStudioCopy,
                    }}
                    labels={studioLabels}
                  />
                  <div className="mt-4 space-y-1 border-t border-[#09090B]/[0.08] pt-3.5 text-xs leading-relaxed text-[#52525B]">
                    <p className="font-medium text-[#09090B]">{refundNote}</p>
                    <p>{aiLimitNote}</p>
                  </div>
                  {!activeEntry.petOnly ? (
                    <section className="mt-5 rounded-[16px] bg-[#F4F4F5] p-4 sm:p-5">
                      <h2 className="text-xs font-semibold text-[#09090B]">{photoGuideHeading}</h2>
                      <p className="mt-2 text-xs leading-relaxed text-[#52525B]">{photoGuideBody}</p>
                      <ul className="mt-3 grid grid-cols-3 gap-2.5">
                        {photoGuideExamples.map((example) => (
                          <li key={example.id}>
                            <figure>
                              <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black/5">
                                {/* eslint-disable-next-line @next/next/no-img-element -- static portrait guide */}
                                <img
                                  src={example.src}
                                  alt=""
                                  width={160}
                                  height={200}
                                  loading="lazy"
                                  className={`h-full w-full object-cover ${example.crop}`}
                                />
                              </div>
                              <figcaption className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[#09090B]">
                                <span aria-hidden="true">✓</span>
                                {example.label}
                              </figcaption>
                            </figure>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </section>
              </div>
            </>
          ) : null}
        </dialog>
      ) : null}
    </BlogMakeContext.Provider>
  );
}

export function BlogMakeCard({
  item,
  subtitle,
  ctaLabel,
}: {
  item: BlogMakeCardInfo;
  subtitle: string;
  ctaLabel: string;
}) {
  const ctx = useContext(BlogMakeContext);
  const hashHref = `#make-${item.slug}`;

  return (
    <div
      id={`make-card-${item.slug}`}
      data-maker-blog-template={item.slug}
      data-maker-blog-make-card={item.slug}
      className="overflow-hidden rounded-[16px] bg-[#F4F4F5] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="w-full shrink-0 overflow-hidden rounded-[12px] bg-[#09090B] sm:w-44">
          {item.posterSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- public content poster
            <img
              src={item.posterSrc}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover object-[50%_20%]"
            />
          ) : item.videoSrc ? (
            <video
              src={`${item.videoSrc}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="aspect-[4/3] w-full bg-[#E4E4E7]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium tabular-nums text-[#71717A]">
            <span>{item.mediumLabel}</span>
            {item.runtimeLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.runtimeLabel}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{item.aspect}</span>
            {item.authorHandle ? (
              <>
                <span aria-hidden="true">·</span>
                <span>@{item.authorHandle}</span>
              </>
            ) : null}
          </div>

          <h3 className="mt-1.5 break-keep text-lg font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B]">
            {item.title}
          </h3>
          <p className="mt-1 break-keep text-sm leading-[1.55] text-[#52525B]">{subtitle}</p>

          <div className="mt-3.5">
            {ctx ? (
              <button
                type="button"
                data-blog-make-trigger={item.slug}
                onClick={() => ctx.openSlug(item.slug)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF58AE] px-5 text-sm font-semibold text-[#09090B] transition-colors duration-150 hover:bg-[#FF389F] active:bg-[#FF1A90]"
              >
                {ctaLabel}
              </button>
            ) : (
              <a
                href={hashHref}
                data-blog-make-trigger={item.slug}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF58AE] px-5 text-sm font-semibold text-[#09090B] transition-colors duration-150 hover:bg-[#FF389F] active:bg-[#FF1A90]"
              >
                {ctaLabel}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
