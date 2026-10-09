'use client';

import { useEffect, useRef, useState } from 'react';
import { createSubmitGuard } from './submit-guard';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { PortraitPhotoGuide } from '@/components/identity/portrait-photo-guide';
import { PremiumEditor } from './premium-editor';
import type { EditScope } from '@/lib/premium-editing/contract';

/**
 * TWINGS — the make loop, as a four-step demo (founder, 2026-08-16: "사진만 넣으면 완성도 높은
 * 영상으로 변환된다는 걸 잘 보이게"), re-homed onto the template page (docs/TEMPLATES-IA.md).
 *
 * This is a MOCKUP and says so on screen. No file leaves the browser, no payment is taken, and the
 * film that plays at the end is the template's own published example rather than a render of the
 * uploaded face. Every one of those is stated in the UI, because a demo that lets someone believe
 * their photo was processed is not a demo — it is a lie with a progress bar.
 *
 * Two shapes: the catalogue shape (several styles, pick one) and the TEMPLATE shape (one style,
 * already chosen — the page you are on IS the choice), which skips the picking step entirely.
 * When the real render pipeline lands, only the rendering step changes.
 */

export interface StudioStyle {
  id: string;
  title: string;
  price: string;
  runtime: string;
  blurb: string;
  posterSrc: string | null;
  videoSrc: string | null;
  /** Where "see more" goes from the result — the catalogue this template belongs to. */
  moreHref: string;
  /** The aspects a visitor may pick for this style, and the one it opens in (founder, 2026-09-06). */
  aspects: Array<{ id: string; label: string }>;
  defaultAspect: string;
  /**
   * The resolutions this template sells, each with its server-set price (lib/twings/resolution.ts).
   * The first is the default (720p). Absent or one entry = no choice to make, nothing is shown.
   * The price here is display only — the server prices the order from the row, not from this.
   */
  resolutions?: Array<{ id: string; price: string }>;
}

export interface StudioLabels {
  stepPhoto: string;
  stepStyle: string;
  stepPay: string;
  stepResult: string;
  dropZone: string;
  dropHint: string;
  changePhoto: string;
  chooseStyle: string;
  payCta: string;
  payNote: string;
  /** The template page before payment is wired: no mock, a promise with a date attached (founder, 2026-09-11). */
  closedBadge: string;
  closedTitle: string;
  closedBody: string;
  closedCta: string;
  closedDone: string;
  /** What AI-made means, said before the money changes hands (founder, 2026-09-11). */
  aiNote: string;
  runtimeLabel: string;
  needPhoto: string;
  noStyles: string;
  moreTemplates: string;
  aspectLabel: string;
  resolutionLabel?: string;
  resolutionDefault?: string;
  resolutionNote?: string;
}

/**
 * The live make loop (docs/TEMPLATES-IA.md §8). When the server says this viewer may render for
 * real (`accessEndpoint` → `{ live: true }`), the pay step posts the photo to `endpoint` and the
 * browser moves to the result page. Otherwise the studio is CLOSED: it says payment opens soon and
 * offers one thing — an email the day it does (`interestEndpoint`). There is no demo any more
 * (founder, 2026-09-11): a mock progress bar on a paid product reads as a product that does not work.
 */
export interface StudioLive {
  endpoint: string;
  accessEndpoint: string;
  /** `POST` — records "tell me when it opens" for the signed-in viewer. */
  interestEndpoint: string;
  template: string;
  locale: string;
  /** Where a `sign_in_required` answer sends the reader (back to this template afterwards). */
  signinHref: string;
  /** Where an `identity_required` answer sends them: the one-time face check (docs §8.2). */
  identityHref: string;
  portrait?: { manage: string; change: string; useSaved: string };
  photoGuide?: Dictionary['portrait'];
  subscription?: { copy: Dictionary['creatorSubscription']; editorCopy: Dictionary['premiumEditor'] };
  labels: {
    badge: string;
    /** Operators render for real without a charge (founder, 2026-09-10). */
    operatorBadge: string;
    freeCta: string;
    submitting: string;
    identityNotice: string;
    identityPending: string;
    identityCta: string;
    errors: Record<string, string>;
  };
}

type Phase = 'photo' | 'style' | 'pay';

/** The longest edge the photo is sent at. Vercel refuses request bodies above ~4.5MB before any of our code runs. */
const PHOTO_MAX_EDGE = 1600;
const PHOTO_PASSTHROUGH_BYTES = 3_000_000;

/**
 * Downscale in the browser: a phone photo is 3–8MB and the request limit is the platform's, not
 * ours. Anything that cannot be decoded here (HEIC on a non-Apple browser) goes up as it is and
 * the server says what it wants instead.
 */
export async function shrinkPhoto(file: File, maxBytes = PHOTO_PASSTHROUGH_BYTES): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= maxBytes && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.65, 0.5, 0.35]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) break;
    }
    if (!blob) throw new Error('encode failed');
    return blob;
  } catch {
    return file;
  }
}

/** A monthly request never carries a raw prompt or client-selected output format. */
export function buildSubscriptionRenderForm(input: {
  requestId: string; template: string; locale: string; portraitId?: string | null; photo?: Blob | null;
  editText: string; references: Blob[]; referencesConsent: boolean;
}) {
  const form = new FormData();
  form.set('requestId', input.requestId);
  form.set('template', input.template);
  form.set('locale', input.locale);
  form.set('ownFaceConsent', '1');
  if (input.portraitId) form.set('portraitId', input.portraitId);
  else if (input.photo) form.set('photo', input.photo, input.photo.type === 'image/png' ? 'photo.png' : 'photo.jpg');
  if (input.editText.trim()) form.set('editText', input.editText.trim());
  if (input.references.length && input.referencesConsent) {
    form.set('referenceConsent', '1');
    input.references.forEach((reference, index) => form.append('references', reference, `reference-${index + 1}.${reference.type === 'image/png' ? 'png' : 'jpg'}`));
  }
  return form;
}

export interface PublicPremiumEditBudget { limit: number; attempted: number; remaining: number }

/** Display only the period budget returned by the server; absent or inconsistent values stay unknown. */
export function parsePremiumEditBudget(value: unknown): PublicPremiumEditBudget | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000 ||
    typeof input.attempted !== 'number' || !Number.isSafeInteger(input.attempted) || input.attempted < 0 ||
    typeof input.remaining !== 'number' || !Number.isSafeInteger(input.remaining) || input.remaining !== Math.max(0, input.limit - input.attempted)) return null;
  return { limit: input.limit, attempted: input.attempted, remaining: input.remaining };
}

export function PremiumEditBudgetNotice({ budget, limitReached = false, locale, copy }: {
  budget: PublicPremiumEditBudget | null; limitReached?: boolean; locale: string; copy: Dictionary['creatorSubscription'];
}) {
  const exhausted = limitReached || budget?.remaining === 0;
  const displayedBudget = budget && (!limitReached || budget.remaining === 0) ? budget : null;
  return <div data-premium-edit-budget={exhausted ? 'exhausted' : budget ? 'available' : 'unknown'} className="mt-5 space-y-2 rounded-xl border border-hairline p-4">
    {displayedBudget && <p data-premium-edit-remaining className="text-sm font-medium">{interpolate(copy.premiumEditRemaining, { remaining: formatCount(displayedBudget.remaining, locale), limit: formatCount(displayedBudget.limit, locale) })}</p>}
    {exhausted ? <p className="text-sm leading-relaxed">{copy.premiumEditLimitReached}</p> : !budget && <p className="text-sm leading-relaxed">{copy.premiumEditBudgetUnavailable}</p>}
    <p className="text-xs leading-relaxed opacity-65">{copy.premiumEditCountNotice}</p>
  </div>;
}

/** Selecting a payment mode changes this screen only. Payment starts at the separate pay button. */
export function SubscriptionPaymentChoice({ available, selected, price, copy, onSelect, disabled = false }: {
  available: boolean; selected: boolean; price: string; copy: Dictionary['creatorSubscription'];
  onSelect: (mode: 'monthly' | 'single') => void; disabled?: boolean;
}) {
  if (!available && !selected) return null;
  return <div data-subscription-payment-choice={selected ? 'single' : 'monthly'} className="mt-5 rounded-xl border border-hairline p-4">
    <p className="text-sm font-medium">{selected ? interpolate(copy.singlePaymentSelected, { price }) : interpolate(copy.singlePaymentBody, { price })}</p>
    <p className="mt-2 text-xs leading-relaxed opacity-70">{copy.singlePaymentOriginal}</p>
    <button data-subscription-payment-switch type="button" disabled={disabled} aria-pressed={selected} onClick={() => onSelect(selected ? 'monthly' : 'single')} className="mt-3 min-h-11 text-sm underline underline-offset-4 disabled:opacity-40">{selected ? copy.backToMonthly : copy.singlePaymentCta}</button>
  </div>;
}

/**
 * 720p or 1080p, each button naming its own price (docs/CREATOR-RESOLUTION.md). Nothing renders
 * with fewer than two options: a template without a 1080p price shows no choice at all.
 */
export function ResolutionPicker({
  options,
  selected,
  onSelect,
  labels,
}: {
  options: ReadonlyArray<{ id: string; price: string }>;
  selected: string | null;
  onSelect: (id: string) => void;
  labels: Pick<StudioLabels, 'resolutionLabel' | 'resolutionDefault' | 'resolutionNote'>;
}) {
  if (options.length < 2) return null;
  const current = selected ?? options[0]!.id;
  return (
    <fieldset data-resolution-picker className="mt-5">
      <legend className="font-label text-eyebrow uppercase opacity-60">{labels.resolutionLabel}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            data-resolution-option={option.id}
            aria-pressed={option.id === current}
            onClick={() => onSelect(option.id)}
            className={[
              'flex items-baseline gap-2 border px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] uppercase transition-opacity',
              option.id === current ? 'border-accent text-accent' : 'border-hairline opacity-60 hover:opacity-100',
            ].join(' ')}
          >
            <span>{index === 0 && labels.resolutionDefault ? `${option.id} · ${labels.resolutionDefault}` : option.id}</span>
            <span className="font-mono normal-case tracking-normal">{option.price}</span>
          </button>
        ))}
      </div>
      {labels.resolutionNote && <p className="mt-2 font-mono text-[0.72rem] opacity-55">{labels.resolutionNote}</p>}
    </fieldset>
  );
}

export function TwingsStudio({
  styles,
  labels,
  initialStyleId,
  live,
}: {
  styles: StudioStyle[];
  labels: StudioLabels;
  /** Pre-chosen style (the template page); with exactly one style the picking step disappears. */
  initialStyleId?: string;
  /** The live make loop; absent (tests, the catalogue shape) the studio is closed. */
  live?: StudioLive;
}) {
  const single = styles.length === 1;
  const [phase, setPhase] = useState<Phase>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savedPortrait, setSavedPortrait] = useState<string | null>(null);
  const [portraitRequired, setPortraitRequired] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [charge, setCharge] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [interest, setInterest] = useState(false);
  const [interestBusy, setInterestBusy] = useState(false);
  const [identityRequired, setIdentityRequired] = useState(false);
  const [identity, setIdentity] = useState('not_needed');
  const [submitting, setSubmitting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string>(initialStyleId ?? styles[0]?.id ?? '');
  const [aspect, setAspect] = useState<string>(styles.find((item) => item.id === (initialStyleId ?? styles[0]?.id))?.defaultAspect ?? styles[0]?.defaultAspect ?? '');
  const [resolution, setResolution] = useState<string>(styles.find((item) => item.id === (initialStyleId ?? styles[0]?.id))?.resolutions?.[0]?.id ?? '');
  const [subscription, setSubscription] = useState<{ id?: string; periodStart?: string | null; hasAccess: boolean; planId: 'creator' | 'premium' | null; remainingPercent: number; status: string } | null>(null);
  const [subscriptionEligible, setSubscriptionEligible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<EditScope[]>([]);
  const [subscriptionUsePercent, setSubscriptionUsePercent] = useState<number | null>(null);
  const [premiumEditBudget, setPremiumEditBudget] = useState<PublicPremiumEditBudget | null>(null);
  const [editRequestLimitReached, setEditRequestLimitReached] = useState(false);
  const [ownFaceConsent, setOwnFaceConsent] = useState(false);
  const [edit, setEdit] = useState({ editText: '', references: [] as File[], referencesConsent: false });
  const [paymentMode, setPaymentMode] = useState<'monthly' | 'single'>('monthly');
  const [usageExhausted, setUsageExhausted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submitGuard = useRef(createSubmitGuard());
  const subscriptionRequestId = useRef<string | null>(null);
  const hasManualPhoto = useRef(false);
  const previousPortraitId = useRef<string | null>(null);

  const chosen = styles.find((item) => item.id === styleId) ?? styles[0] ?? null;
  // The price the button names: the chosen resolution's, else the style's base price.
  const chosenResolution = chosen?.resolutions?.find((option) => option.id === resolution) ?? chosen?.resolutions?.[0] ?? null;
  const chosenPrice = chosenResolution?.price ?? chosen?.price ?? '';
  const subscriptionAvailable = Boolean(live?.subscription && subscription?.hasAccess && subscriptionEligible);
  const monthly = subscriptionAvailable && paymentMode === 'monthly';
  const subscriptionCopy = live?.subscription?.copy;
  const editorAvailable = monthly && subscription?.planId === 'premium' && editing && editFields.length > 0;
  const editBudgetExhausted = editRequestLimitReached || premiumEditBudget?.remaining === 0;
  const editorOpen = editorAvailable && premiumEditBudget !== null && premiumEditBudget.remaining > 0 && !editRequestLimitReached;
  const insufficientUsage = subscriptionUsePercent !== null && (subscription?.remainingPercent ?? 0) < subscriptionUsePercent;

  useEffect(() => {
    const nextStyle = styles.find(item => item.id === initialStyleId) ?? styles[0];
    setStyleId(nextStyle?.id ?? '');
    setAspect(nextStyle?.defaultAspect ?? '');
    setResolution(nextStyle?.resolutions?.[0]?.id ?? '');
    setPaymentMode('monthly');
    setUsageExhausted(false);
    setEditRequestLimitReached(false);
    setOwnFaceConsent(false);
    setEdit({ editText: '', references: [], referencesConsent: false });
    subscriptionRequestId.current = null;
  }, [live?.template, initialStyleId, subscription?.id, subscription?.periodStart, subscription?.planId, subscription?.hasAccess, subscriptionEligible]);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  // Static page, per-viewer answer: ask once whether this reader renders for real, whether a
  // payment is taken, and whether this template needs their verified face first.
  const accessUrl = live ? `${live.accessEndpoint}?template=${encodeURIComponent(live.template)}` : null;
  useEffect(() => {
    if (accessUrl === null) return;
    let cancelled = false;
    let latest = 0;
    const refresh = () => {
      const request = ++latest;
      return fetch(accessUrl, { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : { live: false }))
      .then((json: { live?: boolean; charge?: boolean; identityRequired?: boolean; identity?: string; signedIn?: boolean; interest?: boolean; portraitEnabled?: boolean; portraitId?: string | null; subscription?: typeof subscription; subscriptionEligible?: boolean; editing?: boolean; subscriptionUsePercent?: number | null; editFields?: string[]; premiumEditBudget?: unknown }) => {
        if (cancelled || request !== latest) return;
        setLiveMode(json.live === true);
        setCharge(json.charge !== false);
        setIdentityRequired(json.identityRequired === true);
        setIdentity(typeof json.identity === 'string' ? json.identity : 'not_needed');
        setSignedIn(json.signedIn === true);
        setPortraitRequired(json.portraitEnabled === true);
        if (!hasManualPhoto.current && (json.portraitId ?? null) !== previousPortraitId.current) {
          previousPortraitId.current = json.portraitId ?? null;
          subscriptionRequestId.current = null;
          setOwnFaceConsent(false);
          setSavedPortrait(json.portraitId ?? null);
          setPhoto(json.portraitId ? `/api/identity/portrait/${json.portraitId}/image` : null);
          setPhase(json.portraitId ? single ? 'pay' : 'style' : 'photo');
        }
        setInterest(json.interest === true);
        setSubscription(json.subscription ?? null);
        setSubscriptionEligible(json.subscriptionEligible === true);
        setEditing(json.editing === true);
        setSubscriptionUsePercent(typeof json.subscriptionUsePercent === 'number' && Number.isFinite(json.subscriptionUsePercent) ? json.subscriptionUsePercent : null);
        setEditFields((json.editFields ?? []).filter((field): field is EditScope => ['wardrobe_color', 'prop_color', 'background_palette', 'lighting_mood'].includes(field)));
        const editBudget = parsePremiumEditBudget(json.premiumEditBudget);
        setPremiumEditBudget(editBudget);
        if (editBudget) setEditRequestLimitReached(editBudget.remaining === 0);
      })
      .catch(() => {
        /* closed is the fallback */
      });
    };
    const onFocus = () => { void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [accessUrl, single]);

  const identityBlocked = liveMode && identityRequired && identity !== 'active';

  const takePhoto = (file: File | null | undefined) => {
    if (submitting || !file || !file.type.startsWith('image/')) return;
    hasManualPhoto.current = true;
    setSavedPortrait(null);
    setOwnFaceConsent(false);
    subscriptionRequestId.current = null;
    setPhotoFile(file);
    setLiveError(null);
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setPhase(single ? 'pay' : 'style');
  };

  const submitLive = async () => {
    if (!live || (!photoFile && !savedPortrait) || !chosen) return;
    if (subscriptionAvailable && !ownFaceConsent) return;
    if (monthly && (edit.editText.trim() || edit.references.length) && !editorOpen) {
      setLiveError((editorAvailable ? editBudgetExhausted ? subscriptionCopy?.premiumEditLimitReached : subscriptionCopy?.premiumEditBudgetUnavailable : subscriptionCopy?.studioEditUnavailable) ?? live.labels.errors.generic ?? null);
      return;
    }
    if (monthly && edit.references.length && !edit.referencesConsent) { setLiveError(subscriptionCopy?.studioReferencesConsent ?? live.labels.errors.generic ?? null); return; }
    // H3: a ref, not state — a second click in the same tick still sees the first one in flight.
    const guard = submitGuard.current;
    if (!guard.begin()) return;
    const go = (href: string) => {
      guard.leave();
      window.location.assign(href);
    };
    setSubmitting(true);
    setLiveError(null);
    try {
      let form: FormData;
      if (monthly) {
        const requestId = subscriptionRequestId.current ??= crypto.randomUUID();
        const image = !savedPortrait && photoFile ? await shrinkPhoto(photoFile, 1_200_000) : null;
        const references = await Promise.all(edit.references.map(file => shrinkPhoto(file, 700_000)));
        if ((image?.size ?? 0) + references.reduce((sum, file) => sum + file.size, 0) > 3_700_000) {
          setLiveError(subscriptionCopy?.studioReferenceLarge ?? live.labels.errors.generic ?? null);
          return;
        }
        form = buildSubscriptionRenderForm({ requestId, template: live.template, locale: live.locale, portraitId: savedPortrait, photo: image, editText: edit.editText, references, referencesConsent: edit.referencesConsent });
      } else {
        form = new FormData();
        form.set('template', live.template);
        form.set('aspect', aspect);
        if (chosenResolution) form.set('resolution', chosenResolution.id);
        form.set('locale', live.locale);
        if (savedPortrait) form.set('portraitId', savedPortrait);
        else if (photoFile) { const blob = await shrinkPhoto(photoFile); form.set('photo', blob, blob.type === 'image/png' ? 'photo.png' : 'photo.jpg'); }
      }
      // Behind the face check: hold the job with its photo and go verify — the callback starts it.
      if (identityBlocked && !monthly) form.set('hold', '1');
      const response = await fetch(monthly ? '/api/creator-subscriptions/renders' : charge ? '/api/billing/toss/orders' : live.endpoint, { method: 'POST', body: form, credentials: 'same-origin' });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; href?: string; code?: string; held?: boolean; verifyHref?: string };
      if (response.ok && json.ok === true && json.held === true) {
        go(typeof json.verifyHref === 'string' ? json.verifyHref : live.identityHref);
        return;
      }
      if (response.ok && json.ok === true && typeof json.href === 'string') {
        subscriptionRequestId.current = null;
        go(json.href);
        return;
      }
      if (json.code === 'sign_in_required') {
        go(live.signinHref);
        return;
      }
      if (json.code === 'identity_required') {
        go(live.identityHref);
        return;
      }
      if (monthly && ['insufficient_usage', 'usage_exhausted'].includes(json.code ?? '')) setUsageExhausted(true);
      if (monthly && json.code === 'edit_request_limit') setEditRequestLimitReached(true);
      const monthlyErrors: Record<string, string | undefined> = {
        insufficient_usage: subscriptionCopy?.studioExhausted, usage_exhausted: subscriptionCopy?.studioExhausted,
        edit_unavailable: subscriptionCopy?.studioEditUnavailable, editing_unavailable: subscriptionCopy?.studioEditUnavailable,
        invalid_edit: subscriptionCopy?.studioEditInvalid, edit_rejected: subscriptionCopy?.studioEditInvalid,
        edit_refused: subscriptionCopy?.studioEditInvalid, bad_edit: subscriptionCopy?.studioEditInvalid,
        edit_in_progress: subscriptionCopy?.studioEditPending,
        edit_request_limit: subscriptionCopy?.premiumEditLimitReached,
        bad_reference: subscriptionCopy?.studioReferenceInvalid, too_many_references: subscriptionCopy?.studioReferenceInvalid,
        references_too_large: subscriptionCopy?.studioReferenceLarge, edit_too_large: subscriptionCopy?.studioReferenceLarge,
        unsupported_template: subscriptionCopy?.studioNotIncluded,
        reference_consent_required: subscriptionCopy?.studioReferencesConsent,
        request_too_large: subscriptionCopy?.studioReferenceLarge,
        consent_required: subscriptionCopy?.studioConsentHint,
      };
      setLiveError((monthly ? monthlyErrors[json.code ?? ''] : undefined) ?? live.labels.errors[json.code ?? ''] ?? subscriptionCopy?.error ?? live.labels.errors.generic ?? 'error');
    } catch {
      setLiveError(live.labels.errors.generic ?? 'error');
    } finally {
      // Navigating away: keep the button disabled until the next page replaces this one.
      if (guard.finish()) setSubmitting(false);
    }
  };

  // "Tell me when it opens": signed out, the door; signed in, one POST and the button says so.
  const registerInterest = async () => {
    if (!live || interest || interestBusy) return;
    if (!signedIn) {
      window.location.assign(live.signinHref);
      return;
    }
    setInterestBusy(true);
    try {
      const response = await fetch(live.interestEndpoint, { method: 'POST', credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign(live.signinHref);
        return;
      }
      if (response.ok) setInterest(true);
    } catch {
      /* the button simply stays; nothing was promised */
    } finally {
      setInterestBusy(false);
    }
  };

  // A style whose template is unpublished is dropped upstream; with none left, an empty grid and a
  // permanently disabled button would read as a broken page rather than a closed one.
  if (styles.length === 0) {
    return (
      <section data-twings-studio data-phase="empty" className="mt-10 border-t border-hairline pt-8">
        <p className="max-w-detail text-body opacity-70">{labels.noStyles}</p>
      </section>
    );
  }

  // Closed until the server says otherwise: the static HTML every visitor gets is this panel, and
  // an operator's page swaps to the live loop the moment the access call answers.
  if (!liveMode || !live) {
    return (
      <section data-twings-studio data-phase="closed" data-single={single ? 'true' : 'false'} data-live="false" className="mt-10">
        <p data-studio-closed className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase">
          {labels.closedBadge}
        </p>
        <div className="mt-6 max-w-detail border border-hairline p-6 sm:p-8">
          <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{labels.closedTitle}</p>
          <p className="mt-4 text-body opacity-70">{labels.closedBody}</p>
          {portraitRequired && live?.portrait && <a className="mt-5 inline-block underline" href={`/identity/portrait?next=${encodeURIComponent(`/${live.locale}/t/${live.template}#make`)}`}>{live.portrait.manage}</a>}
          <p data-studio-ai-note className="mt-4 font-mono text-[0.72rem] leading-relaxed opacity-45">{labels.aiNote}</p>
          <button
            type="button"
            data-studio-interest={interest ? 'done' : 'open'}
            disabled={!live || interest || interestBusy}
            onClick={() => void registerInterest()}
            className="mt-7 inline-block border border-current px-6 py-3 font-label text-label uppercase transition-opacity hover:opacity-70 disabled:opacity-60"
          >
            {interest ? labels.closedDone : `${labels.closedCta} →`}
          </button>
        </div>
      </section>
    );
  }

  // The step bar: three steps on a template page (the choice is the page), four in the catalogue.
  const steps = single
    ? [labels.stepPhoto, monthly && subscriptionCopy ? subscriptionCopy.studioReview : labels.stepPay, labels.stepResult]
    : [labels.stepPhoto, labels.stepStyle, monthly && subscriptionCopy ? subscriptionCopy.studioReview : labels.stepPay, labels.stepResult];
  const stepIndex = (() => {
    if (phase === 'photo') return 0;
    if (single) return 1;
    return phase === 'style' ? 1 : 2;
  })();

  return (
    <section data-twings-studio data-phase={phase} data-single={single ? 'true' : 'false'} data-aspect={monthly ? undefined : aspect} data-resolution={monthly ? undefined : chosenResolution?.id ?? ''} data-live={liveMode ? 'true' : 'false'} data-live-charge={liveMode && charge && !monthly ? 'true' : 'false'} data-subscription-render={monthly ? 'true' : 'false'} className="mt-10">
      {/* The one honest label the whole screen hangs on: where the result goes, and whether a payment is taken. */}
      <p
        data-live-badge
        className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase"
      >
        {monthly && subscriptionCopy ? subscriptionCopy.studioBadge : charge ? live.labels.badge : live.labels.operatorBadge}
      </p>

      <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-label text-[0.68rem] tracking-[0.12em] uppercase">
        {steps.map((label, index) => (
          <li
            key={label}
            data-step={index}
            aria-current={index === stepIndex ? 'step' : undefined}
            className={index <= stepIndex ? 'text-accent' : 'opacity-35'}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {portraitRequired && live.portrait ? <div className="border border-hairline p-5">
          {savedPortrait ? <img src={`/api/identity/portrait/${savedPortrait}/image`} alt={live.portrait.useSaved} className="mx-auto aspect-[2/3] max-h-96 w-full object-contain"/> : <p>{live.portrait.manage}</p>}
          <a className="mt-5 inline-block underline" href={`/identity/portrait?next=${encodeURIComponent(`/${live.locale}/t/${live.template}#make`)}`}>{savedPortrait?live.portrait.change:live.portrait.manage}</a>
        </div> : <div className="border border-hairline">
          <div data-studio-photo-guide className="border-b border-hairline p-5">
            {subscriptionCopy && <h3 className="text-sm font-semibold">{subscriptionCopy.studioPhotoTitle}</h3>}
            <p className="mt-2 text-sm leading-relaxed opacity-75">{subscriptionCopy?.studioPhotoGuidance ?? labels.dropHint}</p>
            {live.photoGuide && <PortraitPhotoGuide copy={live.photoGuide} />}
          </div>
          <label
            htmlFor="studio-photo"
            className="flex aspect-[3/4] cursor-pointer items-center justify-center overflow-hidden bg-black focus-within:outline focus-within:outline-2 focus-within:outline-accent"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              takePhoto(event.dataTransfer.files?.[0]);
            }}
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="px-6 text-center text-white/70">
                <p className="font-label text-label uppercase">{labels.dropZone}</p>
                <p className="mt-2 font-mono text-[0.72rem] text-white/45">{labels.dropHint}</p>
              </div>
            )}
          </label>
          <input
            ref={fileRef}
            id="studio-photo"
            type="file"
            accept="image/*"
            disabled={submitting}
            aria-label={labels.dropZone}
            className="sr-only"
            onChange={(event) => takePhoto(event.currentTarget.files?.[0])}
          />
          {photo && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => fileRef.current?.click()}
              className="w-full border-t border-hairline px-4 py-3 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
            >
              {labels.changePhoto}
            </button>
          )}
        </div>

        }
        <div className="flex flex-col">
          {(phase === 'photo' || phase === 'style' || phase === 'pay') && (
            <>
              {single && chosen ? (
                // The template page: the choice is made, so the panel states it instead of asking.
                <div data-chosen-style={chosen.id} className="flex items-baseline justify-between gap-4 border-b border-hairline pb-4">
                  <span className="font-display text-[1.3rem] leading-[1] font-black uppercase">{chosen.title}</span>
                  <span className="flex items-baseline gap-3 font-label text-[0.7rem] tracking-[0.12em] uppercase">
                    {!monthly && <span className="text-accent">{chosenPrice}</span>}
                    {chosen.runtime !== '0' && (
                      <span className="opacity-45">{labels.runtimeLabel.replace('{seconds}', chosen.runtime)}</span>
                    )}
                  </span>
                </div>
              ) : (
                <>
                  <p className="font-label text-label uppercase">{labels.chooseStyle}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {styles.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        disabled={submitting}
                        data-style-option={style.id}
                        aria-pressed={style.id === styleId}
                        onClick={() => {
                          setStyleId(style.id);
                          setAspect(style.defaultAspect);
                          setResolution(style.resolutions?.[0]?.id ?? '');
                          subscriptionRequestId.current = null;
                          if (photo) setPhase('pay');
                        }}
                        className={[
                          'flex flex-col border text-left transition-opacity',
                          style.id === styleId ? 'border-accent' : 'border-hairline opacity-70 hover:opacity-100',
                        ].join(' ')}
                      >
                        <span className="block aspect-video overflow-hidden bg-black">
                          {style.posterSrc && (
                            // eslint-disable-next-line @next/next/no-img-element -- public bucket object
                            <img src={style.posterSrc} alt="" className="h-full w-full object-cover" />
                          )}
                        </span>
                        <span className="flex flex-col gap-1 p-3">
                          <span className="font-display text-[1.15rem] leading-[1] font-black uppercase">{style.title}</span>
                          <span className="font-mono text-[0.72rem] opacity-55">{style.blurb}</span>
                          <span className="mt-1 flex items-baseline justify-between font-label text-[0.7rem] tracking-[0.12em] uppercase">
                            {!monthly && <span className="text-accent">{style.price}</span>}
                            <span className="opacity-45">{labels.runtimeLabel.replace('{seconds}', style.runtime)}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* The aspect: Instagram's feed (4:5) by default, the rest one press away. */}
              {!monthly && chosen && chosen.aspects.length > 1 && (
                <fieldset data-aspect-picker className="mt-5">
                  <legend className="font-label text-eyebrow uppercase opacity-60">{labels.aspectLabel}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chosen.aspects.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-aspect-option={option.id}
                        aria-pressed={option.id === aspect}
                        onClick={() => setAspect(option.id)}
                        className={[
                          'border px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] uppercase transition-opacity',
                          option.id === aspect ? 'border-accent text-accent' : 'border-hairline opacity-60 hover:opacity-100',
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              {/* The resolution: 720p unless the reader asks for 1080p, each with the price it costs. */}
              {!monthly && chosen && (
                <ResolutionPicker options={chosen.resolutions ?? []} selected={chosenResolution?.id ?? null} onSelect={setResolution} labels={labels} />
              )}

              {monthly && subscriptionCopy && <div data-subscription-studio-summary className="mt-5 space-y-3">
                <p className="text-sm font-medium">{interpolate(subscriptionCopy.studioRemaining, { percent: String(Math.max(0, Math.min(100, Math.round(subscription?.remainingPercent ?? 0)))) })}</p>
                {subscriptionUsePercent !== null && <p className="text-sm opacity-70">{interpolate(subscriptionCopy.studioEstimate, { percent: String(Math.round(subscriptionUsePercent * 10) / 10) })}</p>}
              </div>}
              {subscriptionAvailable && subscriptionCopy && <SubscriptionPaymentChoice
                available={charge && (insufficientUsage || usageExhausted)}
                selected={paymentMode === 'single'}
                price={chosenPrice}
                copy={subscriptionCopy}
                disabled={submitting}
                onSelect={mode => {
                  setPaymentMode(mode);
                  setEdit({ editText: '', references: [], referencesConsent: false });
                  subscriptionRequestId.current = null;
                  setLiveError(null);
                }}
              />}
              {editorAvailable && subscriptionCopy && <PremiumEditBudgetNotice budget={premiumEditBudget} limitReached={editRequestLimitReached} locale={live.locale} copy={subscriptionCopy} />}
              {editorOpen && live.subscription && <PremiumEditor
                copy={live.subscription.editorCopy}
                allowedFields={editFields}
                value={edit}
                disabled={submitting}
                onChange={value => {
                  subscriptionRequestId.current = null;
                  setLiveError(null);
                  setEdit(value);
                }}
              />}
              {monthly && subscription?.planId === 'premium' && !editorAvailable && subscriptionCopy && <p className="mt-5 text-sm leading-relaxed opacity-65">{editing ? subscriptionCopy.studioTemplateEditsUnavailable : subscriptionCopy.studioPreparingEdits}</p>}
              {monthly && !editorOpen && (edit.editText || edit.references.length > 0) && subscriptionCopy && <button type="button" className="mt-3 self-start text-sm underline underline-offset-4" onClick={() => { setEdit({ editText: '', references: [], referencesConsent: false }); subscriptionRequestId.current = null; }}>{subscriptionCopy.studioRemoveChanges}</button>}

              <div className="mt-auto pt-6">
                {subscriptionAvailable && subscriptionCopy && <label className="mb-5 flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input data-subscription-own-face-consent type="checkbox" checked={ownFaceConsent} disabled={submitting} onChange={event => setOwnFaceConsent(event.target.checked)} className="mt-1 size-4 shrink-0 accent-black" /><span>{subscriptionCopy.studioConsent}</span></label>}
                {identityBlocked && live && (
                  <p data-identity-notice={identity} className="mb-3 border border-accent px-4 py-3 text-[0.9rem] leading-relaxed">
                    {identity === 'pending' ? live.labels.identityPending : live.labels.identityNotice}
                  </p>
                )}
                <button
                  type="button"
                  data-pay-cta
                  disabled={!photo || !chosen || submitting || (subscriptionAvailable && !ownFaceConsent) || (monthly && (edit.references.length > 0 && (!edit.referencesConsent || !edit.editText.trim())))}
                  aria-describedby={photo ? undefined : 'studio-cta-hint'}
                  onClick={() => {
                    // With a photo the press stores it and goes to the check (held job); without one, just the check.
                    if (identityBlocked && !photoFile) window.location.assign(live.identityHref);
                    else void submitLive();
                  }}
                  className="w-full border border-current px-5 py-4 font-label text-[0.95rem] tracking-[0.1em] text-accent uppercase transition-opacity hover:opacity-70 disabled:opacity-25"
                >
                  {submitting
                    ? live.labels.submitting
                    : identityBlocked
                      ? live.labels.identityCta
                      : monthly && subscriptionCopy
                        ? subscriptionCopy.studioCreate
                      : !charge
                        ? live.labels.freeCta
                        : chosen
                          ? labels.payCta.replace('{price}', chosenPrice)
                          : labels.payCta}
                </button>
                <p className="mt-3 text-xs leading-relaxed opacity-55">{monthly && subscriptionCopy ? subscriptionCopy.studioNote : labels.payNote}</p>
                <p data-studio-ai-note className="mt-2 font-mono text-[0.72rem] leading-relaxed opacity-45">{labels.aiNote}</p>
                {liveError && (
                  <p data-live-error role="alert" className="mt-2 font-mono text-[0.72rem] text-accent">
                    {liveError}
                  </p>
                )}
                {!photo && (
                  <p id="studio-cta-hint" data-studio-hint className="mt-2 font-mono text-[0.72rem] text-accent">
                    {labels.needPhoto}
                  </p>
                )}
                {subscriptionAvailable && photo && !ownFaceConsent && subscriptionCopy && <p className="mt-2 text-xs text-accent">{subscriptionCopy.studioConsentHint}</p>}
                {monthly && edit.references.length > 0 && !edit.editText.trim() && subscriptionCopy && <p className="mt-2 text-xs text-accent">{subscriptionCopy.studioNeedEditText}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
