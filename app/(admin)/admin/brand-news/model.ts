import {
  announcementAnswer,
  BRAND_NEWS_LIMITS,
  charCount,
  isUuid,
  judgeBrandNewsLink,
  type BrandNewsAdminItem,
  type BrandNewsAudience,
  type BrandNewsMode,
  type BrandNewsPlan,
  type BrandNewsPublishRefusal,
  type BrandNewsShape,
  type BrandNewsSlot,
  type HomeAnnouncement,
} from '@/lib/brand-news/contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';

export type BrandNewsAdminCopy = Dictionary['brandNewsAdmin'];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_DAYS = 14;

/** Convert a stored UTC ISO instant into exact KST `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function isoToKstLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Human-readable KST window for the admin list. */
export function formatKstPeriod(startsAt: string, endsAt: string): string {
  const start = isoToKstLocalInput(startsAt).replace('T', ' ');
  const end = isoToKstLocalInput(endsAt).replace('T', ' ');
  return start && end ? `${start} ~ ${end} KST` : `${startsAt} ~ ${endsAt}`;
}

export interface BrandNewsFormValues {
  id: string | null;
  slot: BrandNewsSlot;
  kickerKo: string;
  kickerEn: string;
  titleKo: string;
  titleEn: string;
  ctaLabelKo: string;
  ctaLabelEn: string;
  ctaHref: string;
  shape: BrandNewsShape;
  startsAtLocal: string;
  endsAtLocal: string;
  modes: BrandNewsMode[];
  plans: BrandNewsPlan[];
  orgsText: string;
  storedImageUrl: string | null;
}

export function emptyDraftForm(now: Date = new Date(), slot: BrandNewsSlot = 'home'): BrandNewsFormValues {
  const startMs = Math.floor(now.getTime() / 60_000) * 60_000;
  const endMs = startMs + Math.min(DEFAULT_PERIOD_DAYS, BRAND_NEWS_LIMITS.periodMaxDays) * DAY_MS;
  return {
    id: null,
    slot,
    kickerKo: '',
    kickerEn: '',
    titleKo: '',
    titleEn: '',
    ctaLabelKo: '',
    ctaLabelEn: '',
    ctaHref: '',
    shape: 'line',
    startsAtLocal: isoToKstLocalInput(new Date(startMs).toISOString()),
    endsAtLocal: isoToKstLocalInput(new Date(endMs).toISOString()),
    modes: [],
    plans: [],
    orgsText: '',
    storedImageUrl: null,
  };
}

export function formValuesFromItem(item: BrandNewsAdminItem): BrandNewsFormValues {
  return {
    id: item.id,
    slot: item.slot,
    kickerKo: item.kickerKo,
    kickerEn: item.kickerEn,
    titleKo: item.titleKo,
    titleEn: item.titleEn,
    ctaLabelKo: item.ctaLabelKo,
    ctaLabelEn: item.ctaLabelEn,
    ctaHref: item.ctaHref,
    shape: item.shape,
    startsAtLocal: isoToKstLocalInput(item.startsAt),
    endsAtLocal: isoToKstLocalInput(item.endsAt),
    modes: item.audience?.modes ? [...item.audience.modes] : [],
    plans: item.audience?.plans ? [...item.audience.plans] : [],
    orgsText: item.audience?.orgs ? item.audience.orgs.join('\n') : '',
    storedImageUrl: item.imageUrl,
  };
}

/** Summarise audience rules in words without revealing author identity or listing raw org ids. */
export function describeBrandNewsAudience(
  audience: BrandNewsAudience | null,
  copy: BrandNewsAdminCopy,
  slot?: BrandNewsSlot,
): string {
  if (audience === null) return copy.audienceSummary.invalid;
  const parts: string[] = [];
  if (audience.modes?.length) {
    parts.push(
      interpolate(copy.audienceSummary.modes, {
        modes: audience.modes.map((m) => copy.modeNames[m]).join(', '),
      }),
    );
  }
  if (audience.plans?.length) {
    parts.push(
      interpolate(copy.audienceSummary.plans, {
        plans: audience.plans.map((p) => copy.planNames[p]).join(', '),
      }),
    );
  }
  if (audience.orgs?.length) {
    parts.push(interpolate(copy.audienceSummary.orgsCount, { count: String(audience.orgs.length) }));
  }
  const fallback =
    slot === 'team_home'
      ? copy.audienceSummary.defaultTeamAll
      : slot === 'home'
        ? copy.audienceSummary.defaultMakeAll
        : copy.audienceSummary.defaultAll;
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

export type BrandNewsOutcomeField =
  | 'slot'
  | 'kickerKo'
  | 'kickerEn'
  | 'titleKo'
  | 'titleEn'
  | 'ctaLabelKo'
  | 'ctaLabelEn'
  | 'ctaHref'
  | 'shape'
  | 'image'
  | 'startsAt'
  | 'endsAt'
  | 'period'
  | 'audience';

export interface ResolvedBrandNewsOutcome {
  kind: 'ok' | 'err';
  bannerMessage: string | null;
  fieldMessages: Partial<Record<BrandNewsOutcomeField, string>>;
}

const TEXT_FIELDS = new Set<BrandNewsOutcomeField>([
  'kickerKo',
  'kickerEn',
  'titleKo',
  'titleEn',
  'ctaLabelKo',
  'ctaLabelEn',
]);

const PUBLISH_REASONS = new Set<BrandNewsPublishRefusal>([
  'notDraft',
  'titleKo',
  'titleEn',
  'link',
  'image',
  'period',
  'over',
  'audience',
  'audienceModes',
]);

function fieldResult(field: BrandNewsOutcomeField, message: string): ResolvedBrandNewsOutcome {
  return { kind: 'err', bannerMessage: null, fieldMessages: { [field]: message } };
}

function bannerResult(kind: 'ok' | 'err', bannerMessage: string, fieldMessages: Partial<Record<BrandNewsOutcomeField, string>> = {}): ResolvedBrandNewsOutcome {
  return { kind, bannerMessage, fieldMessages };
}

/**
 * Translate every `/admin/do` redirect query for `brandNews.*` operations into dedicated admin copy,
 * placing field refusals directly beside the named field and other outcomes above the form.
 */
export function resolveBrandNewsOutcome(
  query: { ok?: string; err?: string; detail?: string },
  copy: BrandNewsAdminCopy,
): ResolvedBrandNewsOutcome | null {
  if (query.ok) {
    switch (query.ok) {
      case 'created':
        return bannerResult('ok', copy.outcomes.created);
      case 'saved':
        return bannerResult('ok', copy.outcomes.saved);
      case 'published':
        return bannerResult('ok', copy.outcomes.published);
      case 'unpublished':
        return bannerResult('ok', copy.outcomes.unpublished);
      case 'deleted':
        return bannerResult('ok', copy.outcomes.deleted);
      default:
        return bannerResult('ok', copy.outcomes.saved);
    }
  }
  if (!query.err) return null;

  const detail = query.detail ?? '';
  const code = query.err;

  if (code === 'forbidden') return bannerResult('err', copy.outcomes.forbidden);
  if (code === 'csrf') return bannerResult('err', copy.outcomes.csrf);
  if (code === 'staleReview') return bannerResult('err', copy.outcomes.staleReview);

  if (code === 'disabled') {
    return bannerResult('err', detail.startsWith('brandNews:migration') ? copy.migrationMissing : copy.disabled);
  }

  if (code === 'notFound') return bannerResult('err', copy.outcomes.notFound);

  if (code === 'notDraft') {
    return bannerResult('err', detail === 'brandNews:ended' ? copy.outcomes.notDraftEnded : copy.outcomes.notDraftLive);
  }

  if (code === 'badTransition') {
    if (detail === 'brandNews:notLive') return bannerResult('err', copy.outcomes.badTransitionNotLive);
    if (detail === 'brandNews:slotBusy') return bannerResult('err', copy.outcomes.badTransitionSlotBusy);
    return bannerResult('err', copy.outcomes.genericError);
  }

  if (code === 'notPublishable') {
    const raw = detail.startsWith('brandNews:') ? detail.slice('brandNews:'.length) : detail;
    const keys = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is BrandNewsPublishRefusal => PUBLISH_REASONS.has(item as BrandNewsPublishRefusal));
    const labels = keys.map((reason) => copy.publishReadiness.reasons[reason]);
    const fields: Partial<Record<BrandNewsOutcomeField, string>> = {};
    for (const reason of keys) {
      if (reason === 'titleKo') fields.titleKo = copy.publishReadiness.reasons.titleKo;
      else if (reason === 'titleEn') fields.titleEn = copy.publishReadiness.reasons.titleEn;
      else if (reason === 'link') fields.ctaHref = copy.publishReadiness.reasons.link;
      else if (reason === 'image') fields.image = copy.publishReadiness.reasons.image;
      else if (reason === 'period') fields.period = copy.publishReadiness.reasons.period;
      else if (reason === 'over') fields.endsAt = copy.publishReadiness.reasons.over;
      else if (reason === 'audience') fields.audience = copy.publishReadiness.reasons.audience;
      else if (reason === 'audienceModes') fields.audience = copy.publishReadiness.reasons.audienceModes;
    }
    const reasonText = labels.length > 0 ? labels.join(', ') : detail || copy.outcomes.genericError;
    return bannerResult('err', interpolate(copy.outcomes.notPublishable, { reasons: reasonText }), fields);
  }

  if (code === 'invalid') {
    if (detail === 'brandNews:id') return bannerResult('err', copy.outcomes.invalidId);
    if (detail === 'brandNews:slot') return fieldResult('slot', copy.outcomes.invalidSlot);
    if (detail === 'brandNews:slot:immutable') return fieldResult('slot', copy.outcomes.slotImmutable);
    if (detail === 'brandNews:expectedUpdatedAt') return bannerResult('err', copy.outcomes.invalidExpectedUpdatedAt);
    if (detail === 'brandNews:shape') return fieldResult('shape', copy.outcomes.invalidShape);
    if (detail === 'brandNews:startsAt') return fieldResult('startsAt', copy.outcomes.invalidStartsAt);
    if (detail === 'brandNews:endsAt') return fieldResult('endsAt', copy.outcomes.invalidEndsAt);
    if (detail === 'brandNews:period') {
      return fieldResult('period', interpolate(copy.outcomes.invalidPeriod, { days: String(BRAND_NEWS_LIMITS.periodMaxDays) }));
    }
    if (detail === 'brandNews:audience') {
      return fieldResult('audience', interpolate(copy.outcomes.invalidAudience, { max: String(BRAND_NEWS_LIMITS.audienceOrgsMax) }));
    }
    if (detail === 'brandNews:audience:modes') return fieldResult('audience', copy.outcomes.invalidAudienceModes);
    if (detail === 'brandNews:audience:json') return fieldResult('audience', copy.outcomes.invalidAudienceJson);
    if (detail === 'brandNews:audience:twoWays') return fieldResult('audience', copy.outcomes.invalidAudienceTwoWays);
    if (detail === 'brandNews:audience:unknownKey') return fieldResult('audience', copy.outcomes.invalidAudienceUnknownKey);
    if (detail === 'brandNews:image:notBanner') return fieldResult('image', copy.outcomes.imageNotBanner);

    if (detail === 'brandNews:ctaHref:tooLong') {
      return fieldResult('ctaHref', interpolate(copy.outcomes.hrefTooLong, { max: String(BRAND_NEWS_LIMITS.hrefChars) }));
    }
    if (detail === 'brandNews:ctaHref:characters') return fieldResult('ctaHref', copy.outcomes.hrefCharacters);
    if (detail === 'brandNews:ctaHref:notAllowed') return fieldResult('ctaHref', copy.outcomes.hrefNotAllowed);
    if (detail === 'brandNews:ctaHref:traversal') return fieldResult('ctaHref', copy.outcomes.hrefTraversal);

    const textMatch = /^brandNews:([a-zA-Z]+):(tooLong|characters)$/.exec(detail);
    if (textMatch) {
      const field = textMatch[1] as BrandNewsOutcomeField;
      const reason = textMatch[2];
      if (TEXT_FIELDS.has(field)) {
        const label = copy.fields[field as keyof BrandNewsAdminCopy['fields']];
        const template = reason === 'tooLong' ? copy.outcomes.textTooLong : copy.outcomes.textBadChars;
        return fieldResult(field, interpolate(template, { field: label }));
      }
    }
  }

  if (code === 'upload') {
    const I = BRAND_NEWS_LIMITS.image;
    const uploadMb = String(Math.round(BRAND_NEWS_LIMITS.imageUploadMaxBytes / (1024 * 1024)));
    const maxKb = String(Math.round(I.maxBytes / 1024));
    if (detail === 'brandNews:image:tooLarge') return fieldResult('image', interpolate(copy.outcomes.imageTooLarge, { uploadMb }));
    if (detail === 'brandNews:image:type') return fieldResult('image', copy.outcomes.imageType);
    if (detail === 'brandNews:image:unreadable') return fieldResult('image', copy.outcomes.imageUnreadable);
    if (detail.startsWith('brandNews:image:size ')) {
      const actual = detail.slice('brandNews:image:size '.length).trim();
      return fieldResult(
        'image',
        interpolate(copy.outcomes.imageSize, { actual, width: String(I.width), height: String(I.height) }),
      );
    }
    if (detail.startsWith('brandNews:image:bytes ')) {
      const bytes = Number(detail.slice('brandNews:image:bytes '.length).trim());
      const kb = Number.isFinite(bytes) ? String(Math.ceil(bytes / 1024)) : '?';
      return fieldResult('image', interpolate(copy.outcomes.imageBytes, { kb, maxKb }));
    }
  }

  if (code === 'storage' && detail === 'brandNews:image:store') {
    return fieldResult('image', copy.outcomes.imageStore);
  }

  return bannerResult('err', copy.outcomes.genericError);
}

/** Resolve which item (if any) the admin page should select for edit or read-only inspection. */
export function resolveSelectedAnnouncementId(
  query: { edit?: string; ok?: string; detail?: string },
): string | null {
  if (query.edit === 'new') return null;
  if (isUuid(query.edit)) return query.edit.toLowerCase();
  if (query.ok && query.ok !== 'deleted' && isUuid(query.detail)) return query.detail.toLowerCase();
  return null;
}

/** Parse a KST `YYYY-MM-DDTHH:mm` string cleanly with calendar verification. */
export function kstLocalToMs(raw: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}:${match[2] ?? '00'}+09:00`);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16) === match[1]
    ? date.getTime()
    : null;
}

/** Normalize the textarea organization IDs the exact way `brandNews.save` does: split by whitespace/comma, lowercase, deduplicate. */
export function normalizedOrgSet(orgsText: string): Set<string> {
  return new Set(
    orgsText
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== ''),
  );
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** True when current form values (including pending image upload or repaired null audience) differ from what is stored. */
export function isDirty(
  values: BrandNewsFormValues,
  initialValues: BrandNewsFormValues,
  options: { hasPendingImage?: boolean; storedAudienceNull?: boolean } = {},
): boolean {
  if (options.hasPendingImage) return true;
  if (options.storedAudienceNull) return true;
  if (values.slot !== initialValues.slot) return true;
  if (values.kickerKo.trim() !== initialValues.kickerKo.trim()) return true;
  if (values.kickerEn.trim() !== initialValues.kickerEn.trim()) return true;
  if (values.titleKo.trim() !== initialValues.titleKo.trim()) return true;
  if (values.titleEn.trim() !== initialValues.titleEn.trim()) return true;
  if (values.ctaLabelKo.trim() !== initialValues.ctaLabelKo.trim()) return true;
  if (values.ctaLabelEn.trim() !== initialValues.ctaLabelEn.trim()) return true;
  // Server checks `ctaHref` untrimmed, so any spacing change must require saving before publishing.
  if (values.ctaHref !== initialValues.ctaHref) return true;
  if (values.shape !== initialValues.shape) return true;
  if (values.startsAtLocal.trim() !== initialValues.startsAtLocal.trim()) return true;
  if (values.endsAtLocal.trim() !== initialValues.endsAtLocal.trim()) return true;
  if (!setsEqual(new Set(values.modes), new Set(initialValues.modes))) return true;
  if (!setsEqual(new Set(values.plans), new Set(initialValues.plans))) return true;
  if (!setsEqual(normalizedOrgSet(values.orgsText), normalizedOrgSet(initialValues.orgsText))) return true;
  return false;
}

/** True while the stored audience could not parse (`null`) and the operator has not explicitly picked a plan, org list, or everyone control yet. */
export function audienceNeedsExplicitChoice(
  storedAudienceNull: boolean,
  values: BrandNewsFormValues,
  explicitAllSelected: boolean,
): boolean {
  if (!storedAudienceNull) return false;
  if (explicitAllSelected) return false;
  return values.plans.length === 0 && normalizedOrgSet(values.orgsText).size === 0;
}

/** Client-side pre-submit checks for conditions visible on the form so invalid saves do not reload and lose typed input. */
export function validateDraftClient(
  values: BrandNewsFormValues,
  copy: BrandNewsAdminCopy,
  options: { hasPendingImage: boolean; storedAudienceNull: boolean; explicitAllSelected: boolean },
): Partial<Record<BrandNewsOutcomeField, string>> {
  const errors: Partial<Record<BrandNewsOutcomeField, string>> = {};
  const L = BRAND_NEWS_LIMITS;

  const textChecks: Array<['kickerKo' | 'kickerEn' | 'titleKo' | 'titleEn' | 'ctaLabelKo' | 'ctaLabelEn', number]> = [
    ['kickerKo', L.kickerChars],
    ['kickerEn', L.kickerChars],
    ['titleKo', L.titleChars],
    ['titleEn', L.titleChars],
    ['ctaLabelKo', L.ctaLabelChars],
    ['ctaLabelEn', L.ctaLabelChars],
  ];
  for (const [field, max] of textChecks) {
    if (charCount(values[field]) > max) {
      errors[field] = interpolate(copy.outcomes.textTooLong, { field: copy.fields[field] });
    }
  }

  const hasBannerImage = Boolean(values.storedImageUrl) || options.hasPendingImage;
  if (values.ctaHref === '') {
    if (values.shape === 'banner' && !hasBannerImage) {
      errors.ctaHref = copy.outcomes.hrefEmptyForBanner;
    }
  } else {
    const link = judgeBrandNewsLink(values.ctaHref);
    if (!link.ok) {
      if (link.reason === 'tooLong') {
        errors.ctaHref = interpolate(copy.outcomes.hrefTooLong, { max: String(L.hrefChars) });
      } else if (link.reason === 'characters') {
        errors.ctaHref = copy.outcomes.hrefCharacters;
      } else if (link.reason === 'traversal') {
        errors.ctaHref = copy.outcomes.hrefTraversal;
      } else {
        errors.ctaHref = copy.outcomes.hrefNotAllowed;
      }
    }
  }

  const startsMs = kstLocalToMs(values.startsAtLocal);
  const endsMs = kstLocalToMs(values.endsAtLocal);
  if (startsMs === null) {
    errors.startsAt = copy.outcomes.invalidStartsAt;
  }
  if (endsMs === null) {
    errors.endsAt = copy.outcomes.invalidEndsAt;
  } else if (startsMs !== null && (endsMs <= startsMs || endsMs - startsMs > L.periodMaxDays * DAY_MS)) {
    errors.period = interpolate(copy.outcomes.invalidPeriod, { days: String(L.periodMaxDays) });
  }

  if (audienceNeedsExplicitChoice(options.storedAudienceNull, values, options.explicitAllSelected)) {
    errors.audience = copy.audienceSummary.invalid;
  } else if (values.slot === 'home' && values.modes.some((mode) => mode !== 'make')) {
    errors.audience = copy.outcomes.invalidAudienceModes;
  }

  return errors;
}

/** Publish confirmation sentence: replaces any live row immediately while stating exact KST visibility start when ahead. */
export function formatPublishConfirmation(params: {
  liveItem: BrandNewsAdminItem | null;
  selectedId: string;
  startsAtIso: string;
  nowMs: number;
  copy: BrandNewsAdminCopy;
  slot?: BrandNewsSlot;
}): string {
  const startsMs = Date.parse(params.startsAtIso);
  const isFuture = Number.isFinite(startsMs) && startsMs > params.nowMs;
  const startsAt = isoToKstLocalInput(params.startsAtIso).replace('T', ' ');
  const replacesLive = params.liveItem !== null && params.liveItem.id !== params.selectedId;
  const title = params.liveItem?.titleKo || params.liveItem?.titleEn || params.liveItem?.id || '';

  if (params.slot) {
    const slot = params.copy.slots[params.slot].short;
    if (replacesLive) {
      return isFuture
        ? interpolate(params.copy.actions.confirmPublishReplaceFutureSlotLabel, { slot, title, startsAt })
        : interpolate(params.copy.actions.confirmPublishReplaceSlotLabel, { slot, title });
    }
    return isFuture
      ? interpolate(params.copy.actions.confirmPublishFutureSlotLabel, { slot, startsAt })
      : interpolate(params.copy.actions.confirmPublishSlotLabel, { slot });
  }

  if (replacesLive) {
    return isFuture
      ? interpolate(params.copy.actions.confirmPublishReplaceFutureLabel, { title, startsAt })
      : interpolate(params.copy.actions.confirmPublishReplaceLabel, { title });
  }
  return isFuture
    ? interpolate(params.copy.actions.confirmPublishFutureLabel, { startsAt })
    : params.copy.actions.confirmPublishLabel;
}

/** Build a zero-network real-size preview answer using the shared contract helper. */
export function buildPreviewAnnouncement(
  values: BrandNewsFormValues,
  locale: 'ko' | 'en',
  localImageUrl: string | null = null,
): HomeAnnouncement | null {
  const effectiveImageUrl = values.shape === 'banner' ? (localImageUrl ?? values.storedImageUrl) : null;
  return announcementAnswer(
    {
      id: values.id ?? '00000000-0000-0000-0000-000000000000',
      kickerKo: values.kickerKo,
      kickerEn: values.kickerEn,
      titleKo: values.titleKo,
      titleEn: values.titleEn,
      ctaLabelKo: values.ctaLabelKo,
      ctaLabelEn: values.ctaLabelEn,
      ctaHref: values.ctaHref,
      shape: values.shape,
      imageKey: effectiveImageUrl ? 'preview' : null,
      imageWidth: effectiveImageUrl ? BRAND_NEWS_LIMITS.image.width : null,
      imageHeight: effectiveImageUrl ? BRAND_NEWS_LIMITS.image.height : null,
    },
    locale,
    {
      imageUrl: () => effectiveImageUrl,
      scope: (path) => path,
    },
  );
}
