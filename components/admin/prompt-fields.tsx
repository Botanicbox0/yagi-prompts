import { PublicLink } from '@/components/admin/public-link';
import { IMAGE_ASPECTS, IMAGE_ENGINES, IMAGE_ENGINE_IDS, VIDEO_ASPECTS, VIDEO_ENGINE_IDS } from '@/lib/images/engines';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { suggestedKrw } from '@/lib/twings/products';
import { PROMPT_TEXT_MAX, PROMPT_TEXT_MIN, TEMPLATE_MEDIA } from '@/lib/prompts/schemas';
import { promptHref } from '@/lib/prompts/links';
import { visibilityLabel, visibilityOptions } from '@/components/admin/labels';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PromptRow } from '@/lib/prompts/repo';
import { adminMediaPath, promptAdminRef } from '@/lib/media/admin-authorize';
import {
  AUDIO_MAX_BYTES,
  DEFAULT_PROMPT_MODEL,
  VIDEO_MAX_BYTES,
  PROMPT_MODELS,
  USE_CASES,
  USE_CASE_MAX,
  USE_CASE_MIN,
  parsePromptMedia,
} from '@/lib/prompts/schemas';
import { Field, INPUT, LABEL, OpForm } from '@/components/admin/chrome';
import { MediaDrop, type MediaDropLabels } from '@/components/admin/media-drop';
import { useCaseLabel } from '@/components/prompts/labels';

/**
 * The prompt editor's field list, extracted so THREE screens can share one truth (2026-08-15).
 *
 * Founder direction: "관리자 페이지에서 프롬프트 등록하는 거 방식 불편함 — 스크롤 계속 내려서 추가
 * 등록해야 해서." The authoring form used to sit at the BOTTOM of a page that first rendered the
 * moderation queue and then a full inline editor for every published prompt, so adding one meant
 * scrolling past everything else on the site. The screen split into a BOARD (cards), a NEW page and
 * an ITEM page — and the moment a field list is rendered by more than one route it has to live in
 * one file, or the create form and the edit form drift apart silently.
 */

type Dict = Dictionary;

/** The drag/drop + frame-picker labels, shared by the authoring and the edit form. */
export function mediaDropLabels(a: Dictionary['admin']): MediaDropLabels {
  return {
    videoZone: a.mediaVideoZone,
    videoReplace: a.mediaVideoReplace,
    posterHeading: a.fieldPromptPoster,
    frameScrub: a.mediaFrameScrub,
    framePick: a.mediaFramePick,
    framePicked: a.mediaFramePicked,
    posterZone: a.mediaPosterZone,
    posterPicked: a.mediaPosterPicked,
    posterHint: a.mediaPosterHint,
    audioHeading: a.fieldPromptAudio,
    audioZone: a.mediaAudioZone,
    uploading: a.mediaUploading,
    uploaded: a.mediaUploaded,
    uploadFailed: a.mediaUploadFailed,
    // The same caps the signing route enforces, so the refusal names the real limit.
    uploadTooLarge: a.mediaUploadTooLarge
      .replace('{videoMb}', String(VIDEO_MAX_BYTES / (1024 * 1024)))
      .replace('{audioMb}', String(AUDIO_MAX_BYTES / (1024 * 1024))),
    uploadBadType: a.mediaUploadBadType,
    uploadSession: a.mediaUploadSession,
    blockedUploading: a.mediaBlockedUploading,
    blockedFailed: a.mediaBlockedFailed,
  };
}

export function UseCaseChecks({ dict, selected }: { dict: Dict; selected: readonly string[] }) {
  const set = new Set(selected);
  return (
    <div className="flex flex-wrap gap-2">
      {USE_CASES.map((value) => (
        <label
          key={value}
          className="flex items-center gap-1.5 border border-hairline px-2 py-1 font-label text-[0.62rem] tracking-[0.1em] uppercase"
        >
          <input
            type="checkbox"
            name="useCase"
            value={value}
            defaultChecked={set.has(value)}
            className="h-3 w-3"
            style={{ accentColor: 'var(--accent)' }}
          />
          {useCaseLabel(dict, value)}
        </label>
      ))}
    </div>
  );
}

/** Staged (unpublished) media, playable — the whole point of a moderation queue. */
export function StagedMedia({ row, dict }: { row: PromptRow; dict: Dict }) {
  const media = parsePromptMedia(row.media);
  const a = dict.admin;
  if (!media.poster && !media.video) {
    return <p className="font-mono text-[0.72rem] opacity-50">{a.noMedia}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>{a.previewMedia}</span>
      {media.video && (
        <video
          src={adminMediaPath(promptAdminRef(row.id, 'video'))}
          controls
          muted
          playsInline
          preload="metadata"
          className="w-full max-w-sm border border-hairline"
          {...(media.poster ? { poster: adminMediaPath(promptAdminRef(row.id, 'poster')) } : {})}
        />
      )}
      {!media.video && media.poster && (
        // eslint-disable-next-line @next/next/no-img-element -- staging object behind the admin gate
        <img
          src={adminMediaPath(promptAdminRef(row.id, 'poster'))}
          alt=""
          className="w-full max-w-sm border border-hairline"
        />
      )}
    </div>
  );
}

/**
 * Every editable field of a prompt, once.
 *
 * `row === null` is the CREATE case, and the only differences it makes are defaults: the model
 * pre-filled, the visibility at §13.3-2's `pro`, the slug placeholder explaining it derives from the
 * title. Nothing is conditionally hidden — a field that exists when editing and not when creating is
 * a field the author discovers only after publishing.
 */
export function PromptFields({ row, dict }: { row: PromptRow | null; dict: Dict }) {
  const a = dict.admin;
  const existing = row === null ? {} : parsePromptMedia(row.media);
  const creating = row === null;
  // Create-only: the two things `prompt.create` refuses without (a use case, a poster) say so up front.
  const labels = mediaDropLabels(a);
  if (creating) labels.posterHeading = `${a.fieldPromptPoster} · ${a.requiredMark}`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldPromptTitle}>
          <input type="text" name="title" required minLength={3} defaultValue={row?.title ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldPromptTitleKo}>
          <input type="text" name="titleKo" required minLength={1} defaultValue={row?.titleKo ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldPromptSlug} hint={a.promptSlugAutoHint}>
          <input
            type="text"
            name="slug"
            defaultValue={row?.slug ?? ''}
            placeholder="auto"
            className={INPUT}
          />
        </Field>
        <Field label={a.fieldPromptHandle}>
          <input
            type="text"
            name="handle"
            defaultValue={row?.authorHandle ?? ''}
            className={INPUT}
          />
        </Field>
      </div>

      {/* Models, as CHECKBOXES (founder, 2026-08-15: "seedance2.5랑 seedance2.0 둘 다 체크하고
          싶으면 어떻게 해?"). A free-text field could hold one answer and invited a typo into a
          public chip; the vocabulary lives in `lib/prompts/schemas.ts` and adding one is a line. */}
      <div>
        <span className={LABEL}>{a.fieldItemModel}</span>
        <p className="mt-1 font-mono text-[0.72rem] opacity-50">{a.promptModelsHint}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {PROMPT_MODELS.map((model) => (
            <label
              key={model.id}
              className="flex items-center gap-1.5 border border-hairline px-2 py-1 font-label text-[0.62rem] tracking-[0.1em] uppercase"
            >
              <input
                type="checkbox"
                name="models"
                value={model.id}
                defaultChecked={(row?.models ?? [DEFAULT_PROMPT_MODEL]).includes(model.id)}
                className="h-3 w-3"
                style={{ accentColor: 'var(--accent)' }}
              />
              {model.label}
            </label>
          ))}
        </div>
      </div>

      <Field label={a.fieldPromptBody}>
        <textarea
          name="promptText"
          rows={12}
          required
          minLength={PROMPT_TEXT_MIN}
          maxLength={PROMPT_TEXT_MAX}
          defaultValue={row?.promptText ?? ''}
          className={INPUT}
        />
      </Field>

      <Field label={a.fieldSourceUrl} hint={a.sourceUrlHint}>
        <input
          type="url"
          name="sourceUrl"
          defaultValue={row?.sourceUrl ?? ''}
          placeholder="https://"
          className={INPUT}
        />
      </Field>

      {/* The making-of (2026-08-14). Optional, markdown, and NOT a forced locale pair — a
          Korean-only write-up is honest content, not an incomplete translation. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={a.fieldProcess} hint={a.processHint}>
          <textarea
            name="processMd"
            rows={10}
            defaultValue={row?.processMd ?? ''}
            className={INPUT}
          />
        </Field>
        <Field label={a.fieldProcessKo}>
          <textarea
            name="processMdKo"
            rows={10}
            defaultValue={row?.processMdKo ?? ''}
            className={INPUT}
          />
        </Field>
      </div>

      <div {...(creating ? { 'data-required-field': 'useCase' } : {})}>
        <span className={LABEL}>
          {a.colUseCase}
          {creating && ` · ${a.requiredMark}`}
        </span>
        {creating && (
          <p className="mt-1 font-mono text-[0.72rem] opacity-50">
            {interpolate(a.useCaseRequiredHint, { min: USE_CASE_MIN, max: USE_CASE_MAX })}
          </p>
        )}
        <div className="mt-1.5">
          <UseCaseChecks dict={dict} selected={row?.useCase ?? []} />
        </div>
      </div>

      {/* docs/TEMPLATES-IA.md — what this template produces and what one render costs. */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={a.fieldTemplateMedium}>
          <select name="medium" defaultValue={row?.medium ?? 'video'} className={INPUT}>
            {TEMPLATE_MEDIA.map((medium) => (
              <option key={medium} value={medium}>
                {a.templateMedia[medium]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldTemplatePrice} hint={a.templatePriceHint}>
          <input type="number" name="priceCents" min={0} step={1} defaultValue={row?.priceCents ?? 0} className={INPUT} />
        </Field>
        {/* The won price a Korean page shows (0018). Empty/0 = the x,900 suggestion, offered as the placeholder. */}
        <Field label={a.fieldTemplatePriceKrw} hint={a.templatePriceKrwHint}>
          <input type="number" name="priceKrw" min={0} step={100} defaultValue={row?.priceKrw ?? 0} placeholder={String(suggestedKrw(row?.priceCents ?? 0))} className={INPUT} />
        </Field>
        <Field label={a.fieldTemplateRuntime} hint={a.templateRuntimeHint}>
          <input type="number" name="runtimeSeconds" min={1} step={1} defaultValue={row?.runtimeSeconds ?? ''} className={INPUT} />
        </Field>
      </div>

      {/* docs/TEMPLATES-IA.md §7 — the engine and the aspect the make step opens in. Both lists are
          the union across media; the operation refuses a pairing that does not match the output. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldTemplateEngine} hint={a.templateEngineHint}>
          <select name="engine" defaultValue={row?.engine ?? ''} className={INPUT}>
            <option value="">{a.templateEngineDefault}</option>
            {VIDEO_ENGINE_IDS.map((id) => (
              <option key={id} value={id}>
                {a.templateMedia.video} · {id}
              </option>
            ))}
            {IMAGE_ENGINE_IDS.map((id) => (
              <option key={id} value={id}>
                {a.templateMedia.image} · {IMAGE_ENGINES[id].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldTemplateAspect} hint={a.templateAspectHint}>
          <select name="aspectDefault" defaultValue={row?.aspectDefault ?? ''} className={INPUT}>
            <option value="">{a.templateAspectDefault}</option>
            {[...new Set([...IMAGE_ASPECTS, ...VIDEO_ASPECTS])].map((aspect) => (
              <option key={aspect} value={aspect}>
                {dict.templates.aspects[aspect as keyof typeof dict.templates.aspects] ?? aspect}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldPromptVisibility} hint={a.promptVisibilityHint}>
          {/* §13.3-2 — YAGI text defaults to `pro`; a public teaser is a deliberate choice. */}
          <select
            name="textVisibility"
            defaultValue={row?.textVisibility ?? 'pro'}
            className={INPUT}
          >
            {visibilityOptions(a).map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 font-label text-eyebrow uppercase">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={row?.featured ?? false}
              className="h-3.5 w-3.5"
              style={{ accentColor: 'var(--accent)' }}
            />
            {a.fieldPromptFeatured}
          </label>
        </div>
      </div>

      {/* Founder question (2026-08-14): re-picking a thumbnail frame must not require re-uploading
          the clip — the panel loads what this row already has. */}
      <Field label={a.fieldPromptVideo} hint={creating ? a.mediaCreateHint : a.promptMediaHint}>
        <MediaDrop
          videoName="video"
          posterName="poster"
          audioName="audio"
          labels={labels}
          {...(row && existing.video
            ? { existingVideoSrc: adminMediaPath(promptAdminRef(row.id, 'video')) }
            : {})}
          {...(row && existing.poster
            ? { existingPosterSrc: adminMediaPath(promptAdminRef(row.id, 'poster')) }
            : {})}
        />
      </Field>
    </>
  );
}

/**
 * One prompt as a CARD on the board (2026-08-15, modelled on the reference admin the founder sent).
 *
 * Poster-led, because that is how the founder recognises their own work — a list of slugs is a
 * database, a wall of thumbnails is a catalogue. Everything on it is a fact the board is filtered
 * by (status, visibility, source), and the title is the only link: an admin card carries no
 * stretched link, so a future button on it cannot become an anchor inside an anchor.
 */
export function PromptCard({
  row,
  dict,
  href,
  locale,
}: {
  row: PromptRow;
  dict: Dict;
  href: string;
  locale: string;
}) {
  const a = dict.admin;
  const media = parsePromptMedia(row.media);
  const poster = media.poster ? adminMediaPath(promptAdminRef(row.id, 'poster')) : null;
  const marker =
    row.status === 'pending'
      ? { 'data-prompt-queue': row.slug || row.id }
      : { 'data-prompt-published': row.slug };

  return (
    <li
      {...marker}
      data-prompt-card={row.id}
      data-status={row.status}
      className="flex flex-col border border-hairline"
    >
      <a href={href} className="block border-b border-hairline bg-black" aria-hidden={poster === null}>
        <div className="flex aspect-video items-center justify-center overflow-hidden">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- staging object behind the gate
            <img src={poster} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="px-4 text-center font-mono text-[0.7rem] break-all text-white/45">
              {row.slug || row.id.slice(0, 8)}
            </span>
          )}
        </div>
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5 font-label text-[0.6rem] tracking-[0.1em] uppercase">
          <span data-status-chip={row.status} className="border border-hairline px-1.5 py-0.5">
            {a.statusLabels[row.status]}
          </span>
          <span className="border border-hairline px-1.5 py-0.5 opacity-60">
            {visibilityLabel(a, row.textVisibility)}
          </span>
          {row.featured && <span className="text-accent">★</span>}
        </div>

        <a href={href} className="font-mono text-[0.8rem] leading-snug break-words">
          {row.titleKo || row.title}
        </a>

        <p className="mt-auto font-mono text-[0.68rem] opacity-45">
          {row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity}
          {' · '}
          {formatDate(row.publishedAt ?? row.createdAt, locale) ?? '—'}
        </p>

        {/* The two things an admin does from the wall without opening the editor (2026-09-03):
            see it live, and star it. An OpForm, not a link — a form inside an <li> is fine, an
            anchor inside an anchor is not. */}
        {row.status === 'published' && (
          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2 font-label text-[0.6rem] tracking-[0.1em] uppercase">
            <PublicLink href={promptHref(locale, row.slug)} className="opacity-60 hover:opacity-100" data-card-live={row.slug}>
              {a.viewLive} →
            </PublicLink>
            <OpForm op="prompt.feature" back="/admin/prompts">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="featured" value={row.featured ? 'false' : 'true'} />
              <button type="submit" data-card-feature={row.slug} className={row.featured ? 'text-accent' : 'opacity-60 hover:opacity-100'}>
                {row.featured ? a.unfeature : a.feature}
              </button>
            </OpForm>
          </div>
        )}
      </div>
    </li>
  );
}
