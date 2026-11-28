import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TwingsMark } from '@/components/brand/twings-mark';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { templateHref } from '@/lib/prompts/links';
import { cachedPromptCardsBySlugs } from '@/lib/prompts/cached-by-slugs';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { loadSharedRender, type RenderView } from '@/lib/renders/service';
import { loadRenderExtras } from '@/lib/renders/extras';
import { loadRenderFrames } from '@/lib/renders/frames';
import { renderHref, renderMediaHref, shareHref, shareImageSource } from '@/lib/renders/share';
import { absoluteUrl } from '@/lib/seo/site-url';
import { siteOgImage } from '@/lib/seo/og';
import { ResultMedia } from '@/components/renders/result-media';
import { ResultFrames } from '@/components/renders/result-frames';
import { SaveFrames } from '@/components/renders/save-frames';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/r/[id]/[token]` — the 3-day link from the completion message (docs/TEMPLATES-IA.md §8).
 *
 * No session, no locale prefix, no middleware (excluded like `/auth/*`): the token IS the
 * capability, and the page speaks the language the render was ordered in. It shows the object,
 * offers the download, and ends on "나도 만들기" for whoever the link was sent to. Expired: it says
 * so and sends the owner to sign in — the render is still theirs on `/renders/{id}`.
 *
 * The share card (TEMPLATES-IA §12 "공유 카드": their frame + make yours): an image result is its
 * own OG image; a film uses the frame its owner's browser captured on the result page (0055
 * `poster_key`, served behind this same token), and the template's poster until there is one
 * (`shareImageSource`). A set shows every picture behind the same token (lib/renders/frames.ts); its
 * card is the first. The page stays `noindex` — a capability URL must not
 * enter a search index — while chat apps still unfurl it from the OG tags.
 */
export const dynamic = 'force-dynamic';

interface RouteProps {
  params: Promise<{ id: string; token: string }>;
}

async function resolve(props: RouteProps) {
  const { id, token } = await props.params;
  const sql = await getSqlRunner();
  if (sql === null) return null;
  const shared = await loadSharedRender(sql, id, token);
  if (shared.status === 'not_found') return null;
  const { posterKey } = shared.status === 'ok' ? await loadRenderExtras(sql, id) : { posterKey: null };
  const frames = shared.status === 'ok' ? await loadRenderFrames(sql, shared.view.job, token) : [];
  return { ...shared, dict: getDictionary(shared.view.job.locale), id, token, posterKey, frames };
}

function titleOf(view: RenderView): string {
  return view.job.locale === 'ko' && view.templateTitleKo ? view.templateTitleKo : view.templateTitle;
}

/** The template's own poster — the closest honest frame for a film whose owner has not sent one. */
async function templatePoster(slug: string): Promise<string | null> {
  const catalog = await getPromptCatalog().catch(() => null);
  let card = catalog ? [...(catalog.video ?? []), ...(catalog.image ?? [])].find((item) => item.slug === slug) : undefined;
  if (!card) {
    const unlisted = await cachedPromptCardsBySlugs([slug]).catch(() => []);
    card = unlisted[0];
  }
  return card?.poster ? absoluteUrl(card.poster.src) : null;
}

const NO_INDEX = { index: false, follow: false } as const;

export async function generateMetadata(props: RouteProps): Promise<Metadata> {
  const resolved = await resolve(props);
  if (resolved === null) return { robots: NO_INDEX };
  const { dict, view, id, token, posterKey } = resolved;
  if (resolved.status !== 'ok') return { title: dict.renders.expiredTitle, robots: NO_INDEX };

  const { job } = view;
  const title = interpolate(dict.renders.shareCard.title, { template: titleOf(view) });
  const description = dict.renders.shareCard.description;
  const source = shareImageSource(job.resultMime, posterKey);
  const image = source === 'result'
    ? absoluteUrl(renderMediaHref(id, { share: token }))
    : source === 'frame'
      ? absoluteUrl(renderMediaHref(id, { share: token, poster: true }))
      : await templatePoster(job.templateSlug);
  const images = image ? [{ url: image, alt: title }] : [{ ...siteOgImage(job.locale), url: absoluteUrl(siteOgImage(job.locale).url) }];

  return {
    title,
    description,
    robots: NO_INDEX,
    openGraph: {
      type: 'website',
      locale: job.locale === 'ko' ? 'ko_KR' : 'en_US',
      url: absoluteUrl(shareHref(id, token)),
      siteName: dict.meta.siteName,
      title,
      description,
      images,
    },
    twitter: { card: 'summary_large_image', title, description, images: images.map((item) => item.url) },
  };
}

export default async function SharedRenderPage(props: RouteProps) {
  const resolved = await resolve(props);
  if (resolved === null) notFound();
  const { dict, view, id, token, posterKey, frames } = resolved;
  const r = dict.renders;
  const { job } = view;
  const locale = job.locale;
  const templateUrl = templateHref(locale, job.templateSlug);
  const set = frames.length > 1;

  return (
    <main data-shared-render={job.id} data-share-status={resolved.status} className="mx-auto min-h-svh w-full max-w-shell px-gutter py-6 lg:py-10">
      <a href={`/${locale}`} className="inline-flex min-h-11 items-center gap-2.5">
        <TwingsMark className="h-7" />
        <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">{dict.meta.siteName}</span>
      </a>

      {resolved.status === 'expired' ? (
        <section data-share-expired className="mt-16 max-w-detail">
          <p className="text-accent font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
          <h1 className="mt-4 font-display text-[clamp(1.8rem,4vw,3rem)] leading-[0.95] font-black uppercase">{r.expiredTitle}</h1>
          <p className="mt-5 text-body opacity-70">{r.expiredBody}</p>
          <a href={signInHref(renderHref(id), locale)} className="mt-8 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
            <TextSwap>{r.signInToView} →</TextSwap>
          </a>
        </section>
      ) : (
        <section className={set ? 'mt-4 [--result-chrome:14rem] lg:[--result-chrome:15rem]' : 'mt-4 [--result-chrome:12rem] lg:flex lg:items-end lg:gap-12 lg:[--result-cap:40rem] lg:[--result-chrome:9rem]'}>
          {/* The object first (§3.2-5), sized to the screen; on a desktop the words sit beside it. */}
          <div className={set ? undefined : 'lg:shrink-0'}>
            {set && <ResultFrames frames={frames} aspect={job.aspect} alt={titleOf(view)} labels={r.frames} />}
            {!set && job.resultMime && <ResultMedia src={renderMediaHref(job.id, { share: token })} mime={job.resultMime} aspect={job.aspect} alt={titleOf(view)} poster={shareImageSource(job.resultMime, posterKey) === 'frame' ? renderMediaHref(job.id, { share: token, poster: true }) : null} />}
          </div>

          <div className={set ? 'min-w-0' : 'min-w-0 lg:max-w-detail lg:pb-1'}>
            <h1 className="mt-6 max-w-[40rem] text-[clamp(1.4rem,3.2vw,2.2rem)] leading-tight font-black break-keep">
              {interpolate(r.shareCard.title, { template: titleOf(view) })}
            </h1>
            <p className="mt-2 font-mono text-[0.78rem] text-black/70">
              {set ? interpolate(r.frames.count, { n: frames.length }) : dict.nav[job.medium]} · {job.aspect} · {formatDate(job.finishedAt ?? job.createdAt, locale) ?? ''}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              {set ? (
                <SaveFrames frames={frames} label={interpolate(r.frames.saveAll, { n: frames.length })} againLabel={r.frames.saveAgain} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" />
              ) : (
                <a href={renderMediaHref(job.id, { share: token, download: true })} data-render-download className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                  {r.download} ↓
                </a>
              )}
            </div>
            {job.shareExpiresAt && (
              <p className="mt-3 max-w-detail font-mono text-[0.75rem] opacity-70">
                {interpolate(r.shareNote, { date: formatDate(job.shareExpiresAt, locale) ?? '' })}
              </p>
            )}

            {/* §12 "공유 카드": whoever opens this link leaves with a way to be in the scene too. */}
            <div className="mt-10 max-w-[40rem] border-t border-hairline pt-6">
              <p className="text-body">{r.shareCard.description}</p>
              <a
                href={templateUrl}
                data-make-yours
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-white sm:w-auto"
              >
                {r.makeYours} →
              </a>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
