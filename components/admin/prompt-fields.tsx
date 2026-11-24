import { PublicLink } from '@/components/admin/public-link';
import { IMAGE_ASPECTS, IMAGE_ENGINES, IMAGE_ENGINE_IDS, VIDEO_ASPECTS, VIDEO_ENGINE_IDS, estimateImageUsd, isImageEngine, resolveEngine } from '@/lib/images/engines';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { formatKrw, suggestedKrw } from '@/lib/twings/products';
import { costFloor } from '@/lib/twings/cost-model';
import { baseKrw, makeEarning, providerKrw } from '@/lib/twings/template-price';
import { videoModelForEngine } from '@/lib/video/models';
import { PROMPT_TEXT_MAX, PROMPT_TEXT_MIN, TEMPLATE_CASTS, TEMPLATE_MEDIA } from '@/lib/prompts/schemas';
import { promptHref } from '@/lib/prompts/links';
import {
  TEMPLATE_LOCK_EXAMPLE,
  checkLockBlock,
  lockRefusalLines,
  lockRulesText,
  type PublicTemplateLocks,
} from '@/lib/template-director/locks';
import { checkStylingBlock, type PublicTemplateStyling } from '@/lib/template-director/styling';
import { LockRefusalNotice } from '@/components/admin/prompt-create-feedback';
import { visibilityLabel, visibilityOptions } from '@/components/admin/labels';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PromptRow } from '@/lib/prompts/repo';
import { TEMPLATE_AUDIENCES, type TemplateAudience } from '@/lib/template-look/look';
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
import { StatusPill } from '@/components/admin/patterns';
import { MediaDrop, type MediaDropLabels } from '@/components/admin/media-drop';
import { AdminPosterFrame } from '@/components/admin/poster-frame';
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
    frameLoading: a.mediaFrameLoading,
    frameUnavailable: a.mediaFrameUnavailable,
    posterZone: a.mediaPosterZone,
    posterPicked: a.mediaPosterPicked,
    posterHint: a.mediaPosterHint,
    cropHeading: a.mediaCropHeading,
    cropHint: a.mediaCropHint,
    cropPosition: a.mediaCropPosition,
    audioHeading: a.fieldPromptAudio,
    audioZone: a.mediaAudioZone,
    audioSaved: a.mediaAudioSaved,
    audioLoading: a.mediaAudioLoading,
    audioUnavailable: a.mediaAudioUnavailable,
    uploading: a.mediaUploading,
    uploaded: a.mediaUploaded,
    uploadedRetained: a.mediaUploadedRetained,
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
  if (!media.poster && !media.video && !media.audio) {
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
      {media.audio && (
        // `none`: the path redirects to a 60-second URL, so it is only asked for on play.
        <audio
          src={adminMediaPath(promptAdminRef(row.id, 'audio'))}
          controls
          preload="none"
          className="w-full max-w-sm"
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
/**
 * The base price of this template (lib/twings/template-price.ts, founder rule 2026-11-02), shown next
 * to the price fields so a price is never set blind. A proposal only: it writes nothing and blocks
 * nothing; the warning fires below the band's lower edge (images cost × 1.10, films a 5% margin).
 */
function CostFloorNote({ row, dict }: { row: PromptRow | null; dict: Dict }) {
  if (!row) return null;
  const a = dict.admin;
  // An image's cost is its ENGINE's, not a duration: each model has its own official per-image
  // price (lib/images/engines.ts), so the base follows whichever engine this template renders on.
  if (row.medium === 'image') {
    const engine = resolveEngine(row.engine, 'image');
    if (!isImageEngine(engine)) return null;
    // A set renders every frame on one order, so it is priced on all its frames together.
    const frames = Math.max(1, parsePromptMedia(row.media).gallery?.length ?? 1);
    const cost = { medium: 'image' as const, providerUsd: estimateImageUsd(engine, 1) * frames };
    const proposed = baseKrw(cost);
    const below = row.priceKrw > 0 && row.priceKrw < baseKrw(cost, 'min');
    return (
      <p data-cost-floor={String(proposed)} data-cost-floor-engine={engine} className="font-mono text-[0.72rem] opacity-70">
        {interpolate(a.templateImageCostFloor, { engine: IMAGE_ENGINES[engine].label, frames: String(frames), price: formatKrw(proposed) })}
        {below ? ` ${a.templateBelowFloor}` : ''}
      </p>
    );
  }
  if (row.medium !== 'video' || !row.runtimeSeconds) return null;
  const { model, seconds } = videoModelForEngine(row.engine, row.runtimeSeconds);
  const q720 = costFloor({ model, resolution: '720p', seconds, aspect: row.aspectDefault ?? '9:16' });
  const q1080 = costFloor({ model, resolution: '1080p', seconds, aspect: row.aspectDefault ?? '9:16' });
  if (!q720 || !q1080) return null;
  const film = (providerUsd: number, level?: 'min') => baseKrw({ medium: 'video', providerUsd }, level);
  const p720 = film(q720.providerUsd), p1080 = film(q1080.providerUsd);
  const below = (row.priceKrw > 0 && row.priceKrw < film(q720.providerUsd, 'min')) || (row.price1080Krw > 0 && row.price1080Krw < film(q1080.providerUsd, 'min'));
  return (
    <p data-cost-floor={`${p720}/${p1080}`} className="font-mono text-[0.72rem] opacity-70">
      {interpolate(a.templateCostFloor, { p720: formatKrw(p720), p1080: formatKrw(p1080) })}
      {below ? ` ${a.templateBelowFloor}` : ''}
    </p>
  );
}

// --- Template locks (docs/PERSONAL-STUDIO.md §3.3, C3) ------------------------------------------------------------

/** The locked parts in the customer screen's words (C2): named parts, closed slots (the product covers the prop), shots. */
function lockedPartLabels(locks: PublicTemplateLocks, dict: Dict): string[] {
  const e = dict.editSheet;
  const product = locks.named.includes('product');
  return [
    ...locks.named.map((kind) => e.locks[kind]),
    ...locks.slots.filter((slot) => !(slot === 'prop' && product)).map((slot) => e.slots[slot]),
    ...locks.shots.map((r) => (r.from === r.to ? interpolate(e.shotOne, { n: r.from }) : interpolate(e.shotRange, { from: r.from, to: r.to }))),
  ];
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the styling parts in the admin's words: "헤어 템플릿", "의상 사진". The template
 * styles a part (the buyer may keep their own hair or makeup) or takes it from the photo.
 */
export function stylingPartLabels(styling: PublicTemplateStyling, dict: Dict): string[] {
  const a = dict.admin;
  const e = dict.editSheet;
  return [
    ...styling.styled.map((part) => interpolate(a.templateStylingStyled, { part: e.slots[part] })),
    ...styling.photo.map((part) => interpolate(a.templateStylingPhoto, { part: e.slots[part] })),
  ];
}

/**
 * Under the prompt field: what the SAVED block locks (edit form only; nothing when there is no block), what its
 * styling block declares (§3.4.9: next to the lock line, with a warning when it does not read), and a collapsed example
 * an author can copy. Admin-only, so it names the parts; the block's own words stay in the field above.
 */
function TemplateLocksNote({ promptText, dict }: { promptText: string | null; dict: Dict }) {
  const a = dict.admin;
  const check = promptText === null ? null : checkLockBlock(promptText);
  const styling = promptText === null ? null : checkStylingBlock(promptText);
  return (
    <>
      {check?.state === 'ok' && (
        <p data-template-locks="ok" className="font-mono text-[0.72rem] opacity-70">
          {interpolate(a.templateLocksLine, { parts: lockedPartLabels(check.locks, dict).join(' · ') })}
        </p>
      )}
      {styling?.state === 'ok' && (
        <p data-template-styling="ok" className="font-mono text-[0.72rem] opacity-70">
          {interpolate(a.templateStylingLine, { parts: stylingPartLabels(styling.styling, dict).join(' · ') })}
        </p>
      )}
      {styling?.state === 'malformed' && (
        <p data-template-styling="malformed" className="font-mono text-[0.72rem] text-accent">
          {a.templateStylingMalformed}
        </p>
      )}
      {(check?.state === 'malformed' || check?.state === 'header_typo') && (
        <p data-template-locks={check.state} className="font-mono text-[0.72rem] text-accent">
          {check.state === 'malformed' ? a.templateLocksAll : a.templateLocksTypo}
        </p>
      )}
      <details data-template-locks-help className="border border-hairline p-3">
        <summary className="cursor-pointer font-label text-eyebrow">{a.templateLocksHelp}</summary>
        <p className="mt-2 font-mono text-[0.72rem] opacity-70">{lockRulesText(a.lockRules)}</p>
        <pre className="mt-2 overflow-auto border border-hairline p-3 font-mono text-[0.72rem] whitespace-pre-wrap select-all">
          {TEMPLATE_LOCK_EXAMPLE}
        </pre>
      </details>
    </>
  );
}

/**
 * A save the lock check refused (`?err=invalid&detail=promptText: template locks: …`), in sentences: which line, what
 * is wrong, and how a block is written. Nothing for any other detail. The new-template screen shows the same notice.
 */
export function LockBlockRefusalNote({ detail, dict }: { detail: string | undefined; dict: Dict }) {
  const lines = detail ? lockRefusalLines(detail, dict.admin) : null;
  if (lines === null) return null;
  return <LockRefusalNotice lines={lines} className="mt-3 rounded-[10px] border border-accent px-3.5 py-2.5 text-[13px] text-accent" />;
}

export function PromptFields({ row, dict, look }: {
  row: PromptRow | null;
  dict: Dict;
  /**
   * docs/PERSONAL-STUDIO.md §3.4.10 — the template's current style ('any' for a new one), handed in only once 0190 is
   * applied (`promptLookSchemaReady`), whatever `TWINGS_TEMPLATE_LOOK` says: templates are labelled BEFORE the switch
   * is turned on. Absent, the form has no select and the save leaves the style alone.
   */
  look?: TemplateAudience;
}) {
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
        {row && <Field label={a.fieldPromptSlug} hint={a.promptSlugAutoHint}>
          <input
            type="text"
            name="slug"
            defaultValue={row?.slug ?? ''}
            placeholder="auto"
            className={INPUT}
          />
        </Field>}
        {row && <Field label={a.fieldPromptHandle}>
          <input
            type="text"
            name="handle"
            defaultValue={row?.authorHandle ?? ''}
            className={INPUT}
          />
        </Field>}
      </div>

      {!row && <p className="font-mono text-[0.72rem] opacity-60">{a.promptAddressAutomatic}</p>}

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
      <TemplateLocksNote promptText={row?.promptText ?? null} dict={dict} />

      <details open={row !== null} className="border border-hairline p-3">
        <summary className="cursor-pointer font-label text-eyebrow">{a.promptOptionalDetails}</summary>
        <div className="mt-3 flex flex-col gap-3">
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

        </div>
      </details>

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
        {/* docs/CAST-CATEGORIES.md §1 — who is in it. A pet or couple template also needs a matching recipe to be made. */}
        <Field label={a.fieldTemplateCast} hint={a.templateCastHint}>
          <select name="cast" defaultValue={row?.cast ?? 'solo'} data-admin-cast className={INPUT}>
            {TEMPLATE_CASTS.map((cast) => (
              <option key={cast} value={cast}>
                {a.templateCasts[cast]}
              </option>
            ))}
          </select>
        </Field>
        {look !== undefined && (
          <Field label={dict.templateLook.adminLabel}>
            <select name="look" defaultValue={look} data-admin-look className={INPUT}>
              {TEMPLATE_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {value === 'any' ? dict.templateLook.adminAny : dict.templateLook[value]}
                </option>
              ))}
            </select>
          </Field>
        )}
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

      {/* Creator resolution (0039): 720p is the default; 1080p sells only with its own price in both currencies. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldTemplatePrice1080} hint={a.templatePrice1080Hint}>
          <input type="number" name="price1080Cents" min={0} step={1} defaultValue={row?.price1080Cents ?? 0} className={INPUT} />
        </Field>
        <Field label={a.fieldTemplatePrice1080Krw}>
          <input type="number" name="price1080Krw" min={0} step={100} defaultValue={row?.price1080Krw ?? 0} className={INPUT} />
        </Field>
      </div>
      <CostFloorNote row={row} dict={dict} />

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
          {...(row && existing.posterFocus ? { existingPosterFocus: existing.posterFocus } : {})}
          {...(row && existing.audio
            ? { existingAudioSrc: adminMediaPath(promptAdminRef(row.id, 'audio')) }
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
  const cardTitle = row.titleKo || row.title;
  const displayKrw =
    row.priceKrw > 0 ? row.priceKrw : suggestedKrw(row.priceCents ?? 0);
  const marker =
    row.status === 'pending'
      ? { 'data-prompt-queue': row.slug || row.id }
      : { 'data-prompt-published': row.slug };

  return (
    <li
      {...marker}
      data-prompt-card={row.id}
      data-status={row.status}
      className="flex flex-col overflow-hidden rounded-[14px] bg-white shadow-[var(--admin-ring)]"
    >
      <a
        href={href}
        className="block border-b border-hairline bg-black"
        aria-label={cardTitle}
        aria-hidden={poster === null}
        tabIndex={poster === null ? -1 : undefined}
      >
        {poster ? (
          <AdminPosterFrame src={poster} focus={media.posterFocus} />
        ) : (
          <div className="flex aspect-square items-center justify-center overflow-hidden">
            <span className="px-4 text-center font-mono text-[0.7rem] break-all text-white/45">
              {row.slug || row.id.slice(0, 8)}
            </span>
          </div>
        )}
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span
            data-status-chip={row.status}
            className="rounded-full border border-hairline px-2 py-0.5"
          >
            {a.statusLabels[row.status]}
          </span>
          <span className="rounded-full border border-hairline px-2 py-0.5 opacity-70">
            {visibilityLabel(a, row.textVisibility)}
          </span>
          <span className="rounded-full bg-[var(--admin-wash)] px-2 py-0.5 text-[11px] opacity-80">
            {a.templateMedia[row.medium]}
            {row.engine ? ` · ${row.engine}` : ''}
          </span>
          {row.featured && <span className="text-accent font-semibold">★</span>}
        </div>

        <a
          href={href}
          className="text-[13.5px] font-semibold leading-snug break-words"
        >
          {cardTitle}
        </a>

        <p className="mt-auto flex items-center justify-between gap-2 text-[11.5px] opacity-65">
          <span>
            {row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity}
            {' · '}
            {formatDate(row.publishedAt ?? row.createdAt, locale) ?? '—'}
          </span>
          {displayKrw > 0 && (
            <span className="admin-nowrap font-semibold">
              {formatKrw(displayKrw)}
            </span>
          )}
        </p>

        {/* The two things an admin does from the wall without opening the editor (2026-09-03):
            see it live, and star it. An OpForm, not a link — a form inside an <li> is fine, an
            anchor inside an anchor is not. */}
        {row.status === 'published' && (
          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2 text-[11.5px] font-medium">
            <PublicLink
              href={promptHref(locale, row.slug)}
              className="opacity-70 hover:opacity-100"
              data-card-live={row.slug}
            >
              {a.viewLive} →
            </PublicLink>
            <OpForm op="prompt.feature" back="/admin/prompts">
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="featured"
                value={row.featured ? 'false' : 'true'}
              />
              <button
                type="submit"
                data-card-feature={row.slug}
                className={
                  row.featured
                    ? 'text-accent font-semibold'
                    : 'opacity-70 hover:opacity-100'
                }
              >
                {row.featured ? a.unfeature : a.feature}
              </button>
            </OpForm>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Operate v2: Template Spec, Unit Economics & Zero-Leak Prompt Director Inspector Card
 * (`app/(admin)/admin/prompts/[id]/page.tsx`).
 */
export function TemplateSpecSummaryCard({
  row,
  dict,
}: {
  row: PromptRow;
  dict: Dict;
}) {
  const a = dict.admin;
  const p = dict.adminConsole.prompts;
  const price720 =
    row.priceKrw > 0 ? row.priceKrw : suggestedKrw(row.priceCents ?? 0);
  const price1080 =
    row.price1080Krw > 0
      ? row.price1080Krw
      : suggestedKrw(row.price1080Cents ?? 0);

  let cost720Usd = 0;
  let cost1080Usd = 0;
  let floor720Krw = 0;
  let floor1080Krw = 0;
  if (row.medium === 'image') {
    const engine = resolveEngine(row.engine, 'image');
    if (isImageEngine(engine)) {
      const frames = Math.max(
        1,
        parsePromptMedia(row.media).gallery?.length ?? 1
      );
      cost720Usd = estimateImageUsd(engine, 1) * frames;
      floor720Krw = baseKrw({ medium: 'image', providerUsd: cost720Usd });
    }
  } else if (row.runtimeSeconds) {
    const { model, seconds } = videoModelForEngine(
      row.engine,
      row.runtimeSeconds
    );
    const q720 = costFloor({
      model,
      resolution: '720p',
      seconds,
      aspect: row.aspectDefault ?? '9:16',
    });
    const q1080 = costFloor({
      model,
      resolution: '1080p',
      seconds,
      aspect: row.aspectDefault ?? '9:16',
    });
    if (q720) {
      cost720Usd = q720.providerUsd;
      floor720Krw = baseKrw({ medium: 'video', providerUsd: cost720Usd });
    }
    if (q1080) {
      cost1080Usd = q1080.providerUsd;
      floor1080Krw = baseKrw({ medium: 'video', providerUsd: cost1080Usd });
    }
  }

  const earning720 =
    price720 > 0 && cost720Usd > 0
      ? makeEarning({
          medium: row.medium,
          providerUsd: cost720Usd,
          priceKrw: price720,
          company: row.source === 'yagi',
        })
      : null;
  const earning1080 =
    price1080 > 0 && cost1080Usd > 0
      ? makeEarning({
          medium: row.medium,
          providerUsd: cost1080Usd,
          priceKrw: price1080,
          company: row.source === 'yagi',
        })
      : null;
  const zeroLeakProtected = row.textVisibility !== 'public';

  return (
    <section className="admin-spec-card" data-template-spec-summary>
      <div className="admin-spec-head">
        <div>
          <h2>{p.specHeading}</h2>
          <p className="admin-field-hint mt-1">{p.specLede}</p>
        </div>
        <StatusPill tone={zeroLeakProtected ? 'action' : 'hold'}>
          {zeroLeakProtected ? 'Zero-Leak Protected' : 'Public Prompt'}
        </StatusPill>
      </div>

      <div className="admin-card-grid">
        <div className="admin-subcard">
          <h3>{p.price720}</h3>
          <p className="admin-nowrap font-semibold">
            {price720 > 0 ? formatKrw(price720) : '—'}
            {earning720 ? ` · net ${formatKrw(earning720.margin)}` : ''}
          </p>
          <p>
            {p.providerCost}:{' '}
            {cost720Usd > 0
              ? `~${formatKrw(Math.ceil(providerKrw(cost720Usd)))} (base ${formatKrw(floor720Krw)})`
              : '—'}
          </p>
        </div>

        <div className="admin-subcard">
          <h3>{p.price1080}</h3>
          <p className="admin-nowrap font-semibold">
            {price1080 > 0 ? formatKrw(price1080) : '—'}
            {earning1080 ? ` · net ${formatKrw(earning1080.margin)}` : ''}
          </p>
          <p>
            {p.providerCost}:{' '}
            {cost1080Usd > 0
              ? `~${formatKrw(Math.ceil(providerKrw(cost1080Usd)))} (base ${formatKrw(floor1080Krw)})`
              : '—'}
          </p>
        </div>

        <div className="admin-subcard">
          <h3>{p.zeroLeakVault}</h3>
          <p>{zeroLeakProtected ? p.zeroLeakActive : p.zeroLeakPublic}</p>
          <p>
            {a.templateMedia[row.medium]} · {row.engine ?? 'default'} ·{' '}
            {row.aspectDefault ?? 'auto'}
            {row.runtimeSeconds ? ` · ${row.runtimeSeconds}s` : ''}
          </p>
        </div>

        <div className="admin-subcard">
          <h3>{p.photoCleanup}</h3>
          <p>{p.photoCleanupDesc}</p>
          <p>
            {row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity} ·{' '}
            {visibilityLabel(a, row.textVisibility)}
          </p>
        </div>
      </div>
    </section>
  );
}
