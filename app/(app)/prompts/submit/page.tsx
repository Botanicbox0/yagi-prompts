import { getViewer } from '@/lib/auth/viewer';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import {
  PROCESS_MAX,
  PROMPT_TEXT_MAX,
  USE_CASES,
  USE_CASE_MAX,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from '@/lib/prompts/schemas';
import { GoatMark } from '@/components/nav/goat-mark';
import { TextSwap } from '@/components/ui/text-swap';
import { useCaseLabel } from '@/components/prompts/labels';
import { submitPromptAction } from './actions';

/**
 * `/prompts/submit` — PLAN §13.1/E, §13.2.
 *
 * UNPREFIXED app surface: login-gated at the edge (`APP_PREFIXES` carries `/prompts/submit`),
 * `no-store` and `noindex` through the `(app)` layout and middleware. The gallery it feeds is
 * locale-prefixed and public; this is not, for the same reason `/account` is not.
 *
 * The form is deliberately plain: a multipart POST to one server action, `?ok/err` codes back, no
 * client JavaScript. Every cap the copy mentions is enforced on the server over the received bytes
 * (`lib/prompts/media.ts`), so what the reader is told and what the server does are the same rule.
 */
export const dynamic = 'force-dynamic';

const INPUT =
  'w-full border border-hairline bg-transparent px-3 py-2 font-mono text-code outline-none focus:border-accent';
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function SubmitPromptPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const [locale, viewer, params] = await Promise.all([
    getLocaleFromHeaders(),
    getViewer(),
    searchParams ?? Promise.resolve({} as SearchParams),
  ]);
  const dict = getDictionary(locale);
  const copy = dict.submit;

  const ok = one(params, 'ok') === '1';
  const err = one(params, 'err');
  const detail = one(params, 'detail');

  const errorMessage = (() => {
    switch (err) {
      case 'sign_in_required':
        return copy.errSignIn;
      case 'rate_limited':
        return copy.errRateLimited;
      case 'upload':
        return detail?.includes('too_large')
          ? copy.errUploadTooLarge
          : detail?.includes('too_long')
            ? interpolate(copy.errUploadTooLong, { seconds: String(VIDEO_MAX_SECONDS) })
            : copy.errUploadBadType;
      case 'invalid':
        return copy.errInvalid;
      default:
        return null;
    }
  })();

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center justify-between gap-4 px-gutter py-4">
          <a href={promptsHref(locale)} className="flex items-center gap-2.5">
            <GoatMark className="h-5 w-5" />
            <span className="font-display text-[1.05rem] leading-none font-black uppercase">
              {dict.meta.siteName}
            </span>
          </a>
          <a
            href={promptsHref(locale)}
            className="font-label text-eyebrow uppercase opacity-60"
          >
            <TextSwap>{dict.prompts.backToGallery}</TextSwap>
          </a>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-detail px-gutter py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <h1 className="mt-4 font-display text-[clamp(2rem,5vw,3.25rem)] leading-[0.95] font-black uppercase">
          {ok ? copy.successTitle : copy.title}
        </h1>
        <p className="mt-5 text-body opacity-70">{ok ? copy.successBody : copy.lede}</p>

        {ok ? (
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href={PROMPT_SUBMIT_PATH}
              className="text-accent inline-block border border-current px-5 py-2.5 font-label text-eyebrow uppercase"
            >
              <TextSwap>{copy.successAnother} →</TextSwap>
            </a>
            <a
              href="/account"
              className="inline-block border border-hairline px-5 py-2.5 font-label text-eyebrow uppercase"
            >
              <TextSwap>{copy.mySubmissions} →</TextSwap>
            </a>
          </div>
        ) : (
          <>
            {errorMessage && (
              <p
                role="status"
                data-submit-error={err}
                className="mt-8 border border-accent px-4 py-3 font-label text-eyebrow uppercase"
              >
                {errorMessage}
              </p>
            )}

            {viewer.userId === null && (
              <p className="mt-8 border border-hairline px-4 py-3 text-body opacity-70">
                {copy.errSignIn}
              </p>
            )}

            <form
              action={submitPromptAction}
              encType="multipart/form-data"
              className="mt-10 flex flex-col gap-8"
            >
              <label className="block">
                <span className={LABEL}>{copy.fieldTitle}</span>
                <input type="text" name="title" required maxLength={160} className={`${INPUT} mt-2`} />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldTitleHint}
                </span>
              </label>

              <label className="block">
                <span className={LABEL}>{copy.fieldPrompt}</span>
                <textarea
                  name="promptText"
                  required
                  rows={10}
                  maxLength={PROMPT_TEXT_MAX}
                  className={`${INPUT} mt-2`}
                />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {interpolate(copy.fieldPromptHint, { max: String(PROMPT_TEXT_MAX) })}
                </span>
              </label>

              <fieldset>
                <legend className={LABEL}>{copy.fieldUseCase}</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {USE_CASES.map((value) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 border border-hairline px-3 py-1.5 font-label text-[0.65rem] tracking-[0.12em] uppercase"
                    >
                      <input
                        type="checkbox"
                        name="useCase"
                        value={value}
                        className="h-3.5 w-3.5"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      {useCaseLabel(dict, value)}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 font-mono text-[0.72rem] opacity-50">
                  {interpolate(copy.fieldUseCaseHint, { max: String(USE_CASE_MAX) })}
                </p>
              </fieldset>

              {/* The making-of (founder direction, 2026-08-14): the half a submitter most wants
                  room for. Optional, markdown, any language — the detail page falls back. */}
              <label className="block">
                <span className={LABEL}>{copy.fieldProcess}</span>
                <textarea
                  name="processMd"
                  rows={10}
                  maxLength={PROCESS_MAX}
                  className={`${INPUT} mt-2`}
                />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldProcessHint}
                </span>
              </label>

              <label className="block">
                <span className={LABEL}>{copy.fieldHandle}</span>
                <input type="text" name="handle" maxLength={40} className={`${INPUT} mt-2`} />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldHandleHint}
                </span>
              </label>

              <div className="grid gap-6 sm:grid-cols-2">
                <label className="block">
                  <span className={LABEL}>{copy.fieldVideo}</span>
                  <input
                    type="file"
                    name="video"
                    accept="video/mp4,video/webm,video/quicktime"
                    className={`${INPUT} mt-2`}
                  />
                  <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                    {interpolate(copy.fieldVideoHint, {
                      seconds: String(VIDEO_MAX_SECONDS),
                      mb: String(Math.round(VIDEO_MAX_BYTES / (1024 * 1024))),
                    })}
                  </span>
                </label>

                <label className="block">
                  <span className={LABEL}>{copy.fieldPoster}</span>
                  <input
                    type="file"
                    name="poster"
                    accept="image/png,image/jpeg,image/webp,image/avif"
                    className={`${INPUT} mt-2`}
                  />
                  <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                    {copy.fieldPosterHint}
                  </span>
                </label>
              </div>

              {/* Audio results reached the admin on 2026-08-13; a community submitter can send
                  one too — same caps, same staging, same approval copy to the public bucket. */}
              <label className="block">
                <span className={LABEL}>{copy.fieldAudio}</span>
                <input type="file" name="audio" accept="audio/*" className={`${INPUT} mt-2`} />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldAudioHint}
                </span>
              </label>

              <div className="border border-hairline p-5">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="consent"
                    required
                    className="mt-1 h-4 w-4 shrink-0"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="text-[0.9375rem]">{copy.consentLabel}</span>
                </label>
                <p className="mt-4 border-t border-hairline pt-4 font-mono text-[0.72rem] opacity-55">
                  {copy.consentLicense}
                </p>
              </div>

              <div>
                <button
                  type="submit"
                  className="border border-accent bg-accent px-6 py-3 font-label text-label text-white uppercase"
                >
                  {copy.submitButton}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
