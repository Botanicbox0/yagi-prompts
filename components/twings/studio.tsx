'use client';

import { useEffect, useRef, useState } from 'react';
import { createSubmitGuard } from './submit-guard';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { SelfieUploader } from '@/components/identity/selfie-uploader';
import { SelfieSheet, type SheetChoice } from '@/components/identity/selfie-sheet';
import type { SelfieLibrary, SelfieView } from '@/lib/identity/selfie-service';
import { PremiumEditor } from './premium-editor';
import { shrinkPhoto } from '@/lib/images/client-photo';
export { shrinkPhoto } from '@/lib/images/client-photo';
import type { EditScope } from '@/lib/premium-editing/contract';
import { useStoreClient } from '@/components/pwa/display-mode';
import { STORE_CLIENT_HEADER, storeClientHeaderValue } from '@/lib/mobile/store-bridge';

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
  closedTitle: string;
  closedBody: string;
  closedCta: string;
  closedDone: string;
  /**
   * The shop is open but nobody is signed in: offer the sale, not a waitlist — three example photos,
   * one line and one button (PLATFORM-2.0 §15.3-1; no drop zone before sign-in).
   */
  signedOutBody?: string;
  signedOutCta?: string;
  photoExamples?: { front: string; bright: string; solo: string };
  /** Said (to screen readers) while the access call has not answered; the skeleton shows the rest. */
  pending: string;
  /** The template page's one CTA and its closed twin, used by the phone's sticky bar. */
  makeCta?: string;
  makeCtaClosed?: string;
  /** The aspect folds to the template's default; this opens the rest. */
  otherAspect?: string;
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
  /** The one photo, uploaded inline and reused by every order (docs/IDENTITY-SELFIE.md). */
  selfie?: Dictionary['selfie'];
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

/** A monthly request never carries a raw prompt or client-selected output format. */
export function buildSubscriptionRenderForm(input: {
  requestId: string; template: string; locale: string; selfieId?: string | null; photo?: Blob | null;
  editText: string; references: Blob[]; referencesConsent: boolean;
}) {
  const form = new FormData();
  form.set('requestId', input.requestId);
  form.set('template', input.template);
  form.set('locale', input.locale);
  form.set('ownFaceConsent', '1');
  if (input.selfieId) form.set('selfieId', input.selfieId);
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
      <legend className="text-sm text-black/65">{labels.resolutionLabel}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            data-resolution-option={option.id}
            aria-pressed={option.id === current}
            onClick={() => onSelect(option.id)}
            className={[
              'flex min-h-11 items-center gap-2 border px-3 font-label text-[0.72rem] tracking-[0.12em] uppercase transition-colors',
              option.id === current ? 'border-accent text-accent' : 'border-hairline text-black/70 hover:text-black',
            ].join(' ')}
          >
            <span>{index === 0 && labels.resolutionDefault ? `${option.id} · ${labels.resolutionDefault}` : option.id}</span>
            <span className="font-mono normal-case tracking-normal">{option.price}</span>
          </button>
        ))}
      </div>
      {labels.resolutionNote && <p className="mt-2 text-sm text-black/65">{labels.resolutionNote}</p>}
    </fieldset>
  );
}

/** What the access call settles; a test seam can hand it in so the server markup shows that state. */
export interface StudioAccessSnapshot {
  open: boolean;
  live: boolean;
  signedIn: boolean;
}

/** Where the phone's sticky CTA hands the focus: the first thing to press in the make card, in page order. */
const MAKE_FOCUS = '[data-selfie-use], [data-selfie-camera], [data-selfie-choose], [data-pay-cta]:not(:disabled), [data-studio-signin], [data-studio-interest]:not(:disabled)';

export function TwingsStudio({
  styles,
  labels,
  initialStyleId,
  live,
  shopOpenHint = false,
  initialAccess,
}: {
  styles: StudioStyle[];
  labels: StudioLabels;
  /** Pre-chosen style (the template page); with exactly one style the picking step disappears. */
  initialStyleId?: string;
  /** The live make loop; absent (tests, the catalogue shape) the studio is closed. */
  live?: StudioLive;
  /**
   * `storefrontOpen()` from the server: only what the sticky bar says before the access call answers
   * ("내 사진으로 만들기" or "열리면 알림 받기"). Never opens anything by itself.
   */
  shopOpenHint?: boolean;
  initialAccess?: StudioAccessSnapshot;
}) {
  const single = styles.length === 1;
  // docs/PLATFORM-2.0.md §3.1: the static page used to paint "closed" and flip once the access call
  // answered. Until it answers (or fails — closed is still the fallback), a neutral skeleton.
  const [accessKnown, setAccessKnown] = useState(initialAccess !== undefined || !live);
  const [phase, setPhase] = useState<Phase>('photo');
  // The saved photos are the photo (founder, 2026-10-22): `selfie` is the one the sheet offers (the
  // default), `chosenSelfie` the face this order uses once the person answers "이 얼굴로 만들까요?".
  const [selfie, setSelfie] = useState<SelfieView | null>(null);
  const [chosenSelfie, setChosenSelfie] = useState<SelfieView | null>(null);
  const [selfieJustSaved, setSelfieJustSaved] = useState(false);
  const [selfieEditing, setSelfieEditing] = useState(false);
  const photo = chosenSelfie?.imageUrl ?? null;
  const [liveMode, setLiveMode] = useState(initialAccess?.live ?? false);
  const [charge, setCharge] = useState(true);
  const [signedIn, setSignedIn] = useState(initialAccess?.signedIn ?? false);
  // The shop's own state, separate from this viewer's: see /api/renders/access.
  const [shopOpen, setShopOpen] = useState(initialAccess?.open ?? false);
  const [aspectOpen, setAspectOpen] = useState(false);
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
  const payRef = useRef<HTMLButtonElement>(null);
  const selfiePanelRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLElement>(null);
  const submitGuard = useRef(createSubmitGuard());
  const subscriptionRequestId = useRef<string | null>(null);
  const selfieEditingRef = useRef(false);
  const previousSelfieId = useRef<string | null>(null);
  // Bumped only when the access call reports a selfie this screen did not save itself (another tab).
  const [selfieEpoch, setSelfieEpoch] = useState(0);

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
      .then((json: { open?: boolean; live?: boolean; charge?: boolean; identityRequired?: boolean; identity?: string; signedIn?: boolean; interest?: boolean; selfie?: SelfieView | null; subscription?: typeof subscription; subscriptionEligible?: boolean; editing?: boolean; subscriptionUsePercent?: number | null; editFields?: string[]; premiumEditBudget?: unknown }) => {
        if (cancelled || request !== latest) return;
        setAccessKnown(true);
        setLiveMode(json.live === true);
        setShopOpen(json.open === true);
        setCharge(json.charge !== false);
        setIdentityRequired(json.identityRequired === true);
        setIdentity(typeof json.identity === 'string' ? json.identity : 'not_needed');
        setSignedIn(json.signedIn === true);
        // While the person is choosing a photo, a refresh must not yank the panel out from under them.
        // A different default (changed in another tab) asks the question again.
        const nextSelfie = json.selfie ?? null;
        if (!selfieEditingRef.current && (nextSelfie?.id ?? null) !== previousSelfieId.current) {
          previousSelfieId.current = nextSelfie?.id ?? null;
          subscriptionRequestId.current = null;
          setOwnFaceConsent(false);
          setSelfie(nextSelfie);
          setChosenSelfie(null);
          setSelfieJustSaved(false);
          setSelfieEpoch(epoch => epoch + 1);
          setPhase('photo');
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
        // Closed is the fallback — but a settled one: the skeleton must not wait forever.
        if (!cancelled && request === latest) setAccessKnown(true);
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

  // The face for this order is settled (answered, picked, or just uploaded) and the pay button is
  // next: on a phone it sits below the photo, so bring it into view and hand it the focus.
  const settleSelfie = (face: SelfieView, offered: SelfieView | null, justSaved: boolean) => {
    selfieEditingRef.current = false;
    setSelfieEditing(false);
    if (face.id !== chosenSelfie?.id) { subscriptionRequestId.current = null; setOwnFaceConsent(false); }
    if (offered) { previousSelfieId.current = offered.id; setSelfie(offered); }
    setChosenSelfie(face);
    setSelfieJustSaved(justSaved);
    setLiveError(null);
    setPhase(current => current === 'photo' ? single ? 'pay' : 'style' : current);
    requestAnimationFrame(() => {
      payRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      payRef.current?.focus({ preventScroll: true });
    });
  };
  // The first photo, uploaded right here: this order's face, no question asked (and the default, unless another tab got there first).
  const onSelfieSaved = (saved: SelfieView, _replaced: boolean, library: SelfieLibrary | null) =>
    settleSelfie(saved, library?.items.find(item => item.id === library.defaultId) ?? saved, true);
  // "이 얼굴로 만들까요?" answered: the offered face, another saved one, or a new one from the sheet.
  // A new upload may have replaced the default; the library (or the photo itself) says what to offer next.
  const onSelfieChosen = (face: SelfieView, how: SheetChoice, library: SelfieLibrary | null) => {
    const offered = library?.items.find(item => item.id === library.defaultId) ?? (face.isDefault ? face : null);
    settleSelfie(face, offered, how === 'upload');
  };
  // The sheet's chooser and the first upload report here; the pay button waits while they are open.
  const onSelfieEditing = (editing: boolean) => {
    selfieEditingRef.current = editing;
    setSelfieEditing(editing);
  };
  // The chosen photo is gone (deleted or replaced in another tab): ask again with what is saved now.
  const reloadSelfies = async (): Promise<SelfieView | null> => {
    previousSelfieId.current = null;
    setChosenSelfie(null);
    setSelfieJustSaved(false);
    setPhase('photo');
    let next: SelfieView | null = null;
    try {
      const response = await fetch('/api/identity/selfie', { cache: 'no-store', credentials: 'same-origin' });
      const data = (await response.json()) as Partial<SelfieLibrary> & { ok?: boolean };
      if (response.ok && data.ok === true && Array.isArray(data.items)) next = data.items.find(item => item.id === data.defaultId) ?? data.items[0] ?? null;
    } catch { /* no library: the uploader asks for a first photo */ }
    previousSelfieId.current = next?.id ?? null;
    setSelfie(next);
    setSelfieEpoch(epoch => epoch + 1);
    requestAnimationFrame(() => selfiePanelRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
    return next;
  };

  const submitLive = async () => {
    if (!live || !chosenSelfie || !chosen) return;
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
        const references = await Promise.all(edit.references.map(file => shrinkPhoto(file, 700_000)));
        if (references.reduce((sum, file) => sum + file.size, 0) > 3_700_000) {
          setLiveError(subscriptionCopy?.studioReferenceLarge ?? live.labels.errors.generic ?? null);
          return;
        }
        form = buildSubscriptionRenderForm({ requestId, template: live.template, locale: live.locale, selfieId: chosenSelfie.id, editText: edit.editText, references, referencesConsent: edit.referencesConsent });
      } else {
        form = new FormData();
        form.set('template', live.template);
        form.set('aspect', aspect);
        if (chosenResolution) form.set('resolution', chosenResolution.id);
        form.set('locale', live.locale);
        form.set('selfieId', chosenSelfie.id);
      }
      // Behind the face check: hold the job with its photo and go verify — the callback starts it.
      if (identityBlocked && !monthly) form.set('hold', '1');
      // A store binary's TWA has Chrome's own user agent; the header is how the server knows it.
      const store = storeClientHeaderValue(document.documentElement);
      const response = await fetch(monthly ? '/api/creator-subscriptions/renders' : charge ? '/api/billing/toss/orders' : live.endpoint, { method: 'POST', body: form, credentials: 'same-origin', headers: store ? { [STORE_CLIENT_HEADER]: store } : undefined });
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
      // The chosen photo was deleted or replaced elsewhere: ask again right here, keeping the order's choices.
      if (json.code === 'selfie_required') {
        const remaining = await reloadSelfies();
        setLiveError((remaining ? live.selfie?.libraryChanged : undefined) ?? live.labels.errors.selfie_required ?? live.labels.errors.generic ?? 'error');
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

  // The template page on a phone: price and the one CTA stay at the thumb until the card is in view.
  const sticky = single && live && chosen ? (
    <MakeStickyBar
      price={monthly ? null : chosenPrice}
      label={!accessKnown ? (shopOpenHint ? labels.makeCta : labels.makeCtaClosed) : liveMode ? labels.makeCta : shopOpen && !signedIn ? labels.signedOutCta : labels.makeCtaClosed}
      studioRef={studioRef}
      phaseKey={`${accessKnown}:${liveMode}:${shopOpen}:${signedIn}`}
    />
  ) : null;

  // Before the access call answers: where the photo and the button will be, nothing more. Same
  // footprint as the signed-out card (three 4:5 tiles, a line, a 48px button), so nothing jumps.
  if (!accessKnown) {
    return (
      <section ref={studioRef} data-twings-studio data-phase="pending" data-single={single ? 'true' : 'false'} data-live="false" aria-busy="true" className="mt-5 scroll-mt-24">
        <p role="status" className="sr-only">{labels.pending}</p>
        <div data-studio-pending aria-hidden="true" className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-black/[0.06] motion-reduce:animate-none" />
            ))}
          </div>
          <div className="h-4 w-3/4 animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
          <div className="h-12 w-full animate-pulse rounded bg-black/[0.08] motion-reduce:animate-none" />
        </div>
        {sticky}
      </section>
    );
  }

  // 토스 심사 체크리스트의 "판매 가능한 상품 1개 이상"은 로그인 전 화면에서 판정된다. 상점이 열려
  // 있는데 이 방문자가 로그인하지 않았을 뿐이라면, 대기자 명단이 아니라 판매를 제안한다 — 어떤 사진이
  // 필요한지 먼저 보여주고(가이드 이미지 3장), 버튼은 하나.
  if (!liveMode && live && shopOpen && !signedIn && labels.signedOutCta) {
    const examples = labels.photoExamples
      ? [
          { id: 'front', src: '/images/portrait-guide/front-facing.webp', label: labels.photoExamples.front, crop: 'object-[50%_30%]' },
          { id: 'bright', src: '/images/portrait-guide/clear-face.webp', label: labels.photoExamples.bright, crop: 'object-[50%_20%]' },
          { id: 'solo', src: '/images/portrait-guide/front-facing.webp', label: labels.photoExamples.solo, crop: 'object-[50%_18%] scale-150' },
        ]
      : [];
    return (
      <section ref={studioRef} data-twings-studio data-phase="signed-out" data-single={single ? 'true' : 'false'} data-live="false" data-shop-open="true" className="mt-5 scroll-mt-24">
        {examples.length > 0 && (
          <ul data-studio-photo-examples className="grid grid-cols-3 gap-2">
            {examples.map((example) => (
              <li key={example.id} data-studio-photo-example={example.id}>
                <figure>
                  <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black/5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the public photo guide */}
                    <img src={example.src} alt="" width={160} height={200} loading="lazy" className={`h-full w-full object-cover ${example.crop}`} />
                  </div>
                  <figcaption className="mt-1.5 flex items-center gap-1 text-sm">
                    <span aria-hidden="true" className="text-accent">✓</span>{example.label}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
        <p data-studio-signed-out className="mt-4 text-[0.95rem] leading-relaxed">{labels.signedOutBody}</p>
        <a
          data-studio-signin
          data-make-cta="card"
          href={live.signinHref}
          className="mt-4 flex min-h-12 w-full items-center justify-center bg-accent px-5 font-label text-[0.85rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85"
        >
          {labels.signedOutCta}
        </a>
        {sticky}
      </section>
    );
  }

  // Closed: generation is not open to this reader. One honest sentence pair and the one thing it can
  // offer — an email the day it opens.
  if (!liveMode || !live) {
    return (
      <section ref={studioRef} data-twings-studio data-phase="closed" data-single={single ? 'true' : 'false'} data-live="false" className="mt-5 scroll-mt-24">
        <div data-studio-closed className="rounded-xl bg-black/[0.04] p-4">
          <p className="text-[0.95rem] font-semibold">{labels.closedTitle}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-black/75">{labels.closedBody}</p>
        </div>
        <button
          type="button"
          data-studio-interest={interest ? 'done' : 'open'}
          data-make-cta="card"
          disabled={!live || interest || interestBusy}
          onClick={() => void registerInterest()}
          className="mt-4 flex min-h-12 w-full items-center justify-center border border-current px-5 font-label text-[0.85rem] tracking-[0.1em] uppercase transition-opacity hover:opacity-70 disabled:opacity-60"
        >
          {interest ? labels.closedDone : labels.closedCta}
        </button>
        {sticky}
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
    <section data-twings-studio data-phase={phase} data-single={single ? 'true' : 'false'} data-aspect={monthly ? undefined : aspect} data-resolution={monthly ? undefined : chosenResolution?.id ?? ''} data-live={liveMode ? 'true' : 'false'} data-live-charge={liveMode && charge && !monthly ? 'true' : 'false'} data-subscription-render={monthly ? 'true' : 'false'} ref={studioRef} className="mt-5 scroll-mt-24">
      {/* The one honest label the whole screen hangs on: where the result goes, and whether a payment is taken. */}
      <p
        data-live-badge
        className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase"
      >
        {monthly && subscriptionCopy ? subscriptionCopy.studioBadge : charge ? live.labels.badge : live.labels.operatorBadge}
      </p>

      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-label text-[0.72rem] tracking-[0.12em] uppercase">
        {steps.map((label, index) => (
          <li
            key={label}
            data-step={index}
            aria-current={index === stepIndex ? 'step' : undefined}
            className={index <= stepIndex ? 'text-accent' : 'text-black/55'}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {/* The template page stacks photo over pay: the make card is one column wide (PLATFORM-2.0 §15.3-1). */}
      <div className={single ? 'mt-5 flex flex-col gap-5' : 'mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'}>
        {/* The photo column: "이 얼굴로 만들까요?" over the saved photos, or the uploader when there is none. */}
        <div ref={selfiePanelRef} data-selfie-panel data-selfie-present={selfie ? 'true' : 'false'} className={single ? 'scroll-mt-24' : 'scroll-mt-6 border border-hairline p-5'}>
          <h3 className="text-sm font-semibold">{live.selfie?.panelTitle ?? labels.stepPhoto}</h3>
          {live.selfie ? (
            <div className="mt-3">
              {selfie ? (
                <SelfieSheet
                  key={`${selfieEpoch}:${selfie.id}`}
                  copy={live.selfie}
                  locale={live.locale}
                  suggested={selfie}
                  chosen={chosenSelfie}
                  justSaved={selfieJustSaved}
                  signinHref={live.signinHref}
                  onChoose={onSelfieChosen}
                  onEditingChange={onSelfieEditing}
                />
              ) : (
                <SelfieUploader
                  key={selfieEpoch}
                  copy={live.selfie}
                  locale={live.locale}
                  initial={null}
                  signinHref={live.signinHref}
                  onSaved={onSelfieSaved}
                  onEditingChange={onSelfieEditing}
                />
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-relaxed opacity-70">{labels.dropHint}</p>
          )}
        </div>
        <div className="flex flex-col">
          {(phase === 'photo' || phase === 'style' || phase === 'pay') && (
            <>
              {/* The template page: the choice is made, and the make card above states its price and facts. */}
              {single && chosen ? null : (
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

              {/* The aspect: the template's own by default, folded; the rest one press away ("다른 비율"). */}
              {!monthly && chosen && chosen.aspects.length > 1 && (
                <fieldset data-aspect-picker data-aspect-open={aspectOpen ? 'true' : 'false'} className="mt-1">
                  <legend className="sr-only">{labels.aspectLabel}</legend>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p><span aria-hidden="true" className="text-black/65">{labels.aspectLabel}</span> <strong data-aspect-current className="font-semibold">{chosen.aspects.find((option) => option.id === aspect)?.label ?? aspect}</strong></p>
                    {labels.otherAspect && (
                      <button type="button" data-aspect-toggle aria-expanded={aspectOpen} aria-controls="studio-aspect-options" onClick={() => setAspectOpen((value) => !value)} className="inline-flex min-h-11 shrink-0 items-center text-sm underline underline-offset-4">
                        {labels.otherAspect}
                      </button>
                    )}
                  </div>
                  <div id="studio-aspect-options" hidden={Boolean(labels.otherAspect) && !aspectOpen} className="mt-2 flex flex-wrap gap-2">
                    {chosen.aspects.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-aspect-option={option.id}
                        aria-pressed={option.id === aspect}
                        onClick={() => setAspect(option.id)}
                        className={[
                          'inline-flex min-h-11 items-center border px-3 font-label text-[0.72rem] tracking-[0.12em] uppercase transition-colors',
                          option.id === aspect ? 'border-accent text-accent' : 'border-hairline text-black/70 hover:text-black',
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
                  ref={payRef}
                  type="button"
                  data-pay-cta
                  disabled={!chosenSelfie || selfieEditing || !chosen || submitting || (subscriptionAvailable && !ownFaceConsent) || (monthly && (edit.references.length > 0 && (!edit.referencesConsent || !edit.editText.trim())))}
                  aria-describedby={photo ? undefined : 'studio-cta-hint'}
                  onClick={() => void submitLive()}
                  data-make-cta="card"
                  className="flex min-h-12 w-full items-center justify-center bg-accent px-5 py-3 font-label text-[0.9rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85 disabled:bg-black/10 disabled:text-black/55"
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
                <p className="mt-3 text-sm leading-relaxed text-black/70">{monthly && subscriptionCopy ? subscriptionCopy.studioNote : labels.payNote}</p>
                {liveError && (
                  <p data-live-error role="alert" className="mt-2 text-sm text-accent">
                    {liveError}
                  </p>
                )}
                {!chosenSelfie && (
                  <p id="studio-cta-hint" data-studio-hint className="mt-2 text-sm text-accent">
                    {selfie ? live.selfie?.needChoice ?? labels.needPhoto : live.selfie?.needSelfie ?? labels.needPhoto}
                  </p>
                )}
                {subscriptionAvailable && photo && !ownFaceConsent && subscriptionCopy && <p className="mt-2 text-xs text-accent">{subscriptionCopy.studioConsentHint}</p>}
                {monthly && edit.references.length > 0 && !edit.editText.trim() && subscriptionCopy && <p className="mt-2 text-xs text-accent">{subscriptionCopy.studioNeedEditText}</p>}
              </div>
            </>
          )}
        </div>
      </div>
      {sticky}
    </section>
  );
}

/**
 * The phone's sticky make bar (docs/PLATFORM-2.0.md §3.2-2, §15.3-1): price and the one CTA at the
 * thumb while the make card is off screen. Under 768px only, clear of the home indicator (`pb-safe`),
 * and it declares `data-hide-tabs` so the installed app's bottom tabs step aside for it
 * (components/app/bottom-tabs.tsx). It slides away while the studio (the card's photo and button
 * area) is on screen, so it never covers the card's own buttons (the 2026-10-07 rule: nothing fixed
 * over the pay button) yet still shows on a first screen that reaches only the price. Pressing it
 * scrolls the studio into view and hands the focus to the first thing to press there.
 */
function MakeStickyBar({ price, label, studioRef, phaseKey }: { price: string | null; label: string | undefined; studioRef: React.RefObject<HTMLElement | null>; phaseKey: string }) {
  const [cardInView, setCardInView] = useState(false);
  // The studio element changes with the phase (skeleton → signed out / closed / live): `phaseKey`
  // re-runs this after each commit, when the ref already points at the current one.
  useEffect(() => {
    const target = studioRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCardInView(entry?.isIntersecting ?? false), { rootMargin: '0px 0px -72px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [studioRef, phaseKey]);

  const go = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const area = studioRef.current;
    if (!area) return;
    event.preventDefault();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    area.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' });
    const target = area.querySelector<HTMLElement>(MAKE_FOCUS) ?? area;
    target?.focus({ preventScroll: true });
    if (window.location.hash !== '#make') window.history.replaceState(null, '', '#make');
  };

  // A store binary sells nothing (lib/mobile/store-bridge.ts): CSS hides the bar from first paint,
  // and dropping it here also drops its `data-hide-tabs`, so the app's bottom tabs come back.
  const store = useStoreClient();
  if (!label || store) return null;
  return (
    <div
      data-make-sticky
      data-hide-tabs
      data-make-sticky-state={cardInView ? 'away' : 'shown'}
      aria-hidden={cardInView ? 'true' : undefined}
      inert={cardInView ? true : undefined}
      className={[
        'fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/95 px-4 pt-3 pb-safe backdrop-blur md:hidden',
        'transition-transform duration-200 ease-out motion-reduce:transition-none',
        cardInView ? 'translate-y-full' : 'translate-y-0',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-xl items-center gap-4">
        {price && <p data-make-sticky-price className="shrink-0 font-display text-[1.35rem] leading-none font-black">{price}</p>}
        <a href="#make" data-make-cta="sticky" onClick={go} className="flex min-h-12 flex-1 items-center justify-center bg-accent px-4 font-label text-[0.85rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85">{label}</a>
      </div>
    </div>
  );
}
