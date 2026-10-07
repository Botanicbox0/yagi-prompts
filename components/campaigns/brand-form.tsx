'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * The brand enquiry form (founder, 2026-09-11) — a client island on a static page.
 *
 * It posts JSON to `endpoint` and swaps itself for the receipt; the page never reads a search
 * param, so the campaigns listing keeps its one-HTML-for-everyone cache mode. The honeypot is a
 * real input a person cannot see or tab to; a script that fills every field fills it too.
 */

export interface BrandFormLabels {
  inquiryTypeLabel: string;
  inquiryTypeOptions: Dictionary['campaigns']['brands']['inquiryTypeOptions'];
  useCaseLabel: string;
  useCaseOptions: Dictionary['campaigns']['brands']['useCaseOptions'];
  referenceLabel: string;
  formHeading: string;
  fieldCompany: string;
  fieldName: string;
  fieldEmail: string;
  fieldPhone: string;
  fieldBudget: string;
  budgetUnder3m: string;
  budget3mTo10m: string;
  budget10mTo30m: string;
  budgetOver30m: string;
  budgetUndecided: string;
  fieldTemplate: string;
  templateNew: string;
  templateUndecided: string;
  fieldTiming: string;
  timingPlaceholder: string;
  fieldMessage: string;
  messagePlaceholder: string;
  consent: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  /** Shown only when the route reports the receipt mail went out (audit Q7). */
  successReceipt: string;
  errInvalid: string;
  errRateLimited: string;
  errUnavailable: string;
}

export interface BrandFormTemplate {
  slug: string;
  title: string;
}

const INPUT = 'w-full border border-black/50 bg-transparent px-4 py-3 text-body focus:outline focus:outline-2 focus:outline-accent';
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

type Status = 'idle' | 'sending' | 'sent' | 'invalid' | 'rate_limited' | 'unavailable';

/** The success panel. The receipt sentence appears only when the receipt mail went out. */
export function BrandInquiryReceived({ labels, receipt }: { labels: Pick<BrandFormLabels, 'successTitle' | 'successBody' | 'successReceipt'>; receipt: boolean }) {
  return (
    <div data-brand-inquiry="sent" role="status" className="border border-accent p-6 sm:p-8">
      <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{labels.successTitle}</p>
      <p className="mt-4 max-w-detail text-body opacity-70">
        {labels.successBody}
        {receipt && <span data-brand-inquiry-receipt> {labels.successReceipt}</span>}
      </p>
    </div>
  );
}

export function BrandInquiryForm({
  endpoint,
  locale,
  labels,
  templates,
  privacy,
}: {
  endpoint: string;
  locale: 'en' | 'ko';
  labels: BrandFormLabels;
  templates: BrandFormTemplate[];
  privacy: { href: string; label: string };
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [field, setField] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const requestIdRef = useRef<HTMLInputElement>(null);
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [inquiryType, setInquiryType] = useState('campaign');
  const [useCase, setUseCase] = useState('undecided');

  // Keep old receipt links readable after the public IA move. New non-JS submissions use the
  // server-rendered /api/brands/inquiries/result route; hydrated submissions stay in this form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const useCaseSelected = (event: Event) => {
      const selected = (event as CustomEvent<string>).detail;
      if (selected && selected in labels.useCaseOptions) setUseCase(selected);
    };
    window.addEventListener('twings:use-case', useCaseSelected);
    if (params.get('type') && params.get('type')! in labels.inquiryTypeOptions) setInquiryType(params.get('type')!);
    if (params.get('useCase') && params.get('useCase')! in labels.useCaseOptions) setUseCase(params.get('useCase')!);
    // Persist only a random request key, never the visitor's form contents. A lost network
    // response can be retried without creating another enquiry or notification.
    try {
      const key = sessionStorage.getItem('twings.inquiry.request');
      const id = key && /^[0-9a-f-]{36}$/i.test(key) ? key : crypto.randomUUID();
      if (requestIdRef.current) requestIdRef.current.value = id;
      sessionStorage.setItem('twings.inquiry.request', id);
    } catch { /* Without storage or secure UUID support, the server accepts a blank request key. */ }
    const outcome = params.get('inquiry');
    if (!outcome) return () => window.removeEventListener('twings:use-case', useCaseSelected);
    if (outcome === 'sent') {
      setStatus('sent');
      setReceipt(params.get('receipt') === '1');
      const reference = params.get('id');
      setInquiryId(reference && /^[0-9a-f-]{36}$/i.test(reference) ? reference : null);
      try { sessionStorage.removeItem('twings.inquiry.request'); } catch { /* Storage may be disabled. */ }
    }
    else if (outcome === 'rate_limited' || outcome === 'invalid' || outcome === 'unavailable') {
      setStatus(outcome);
      setField(params.get('field'));
    }
    params.delete('inquiry');
    params.delete('field');
    params.delete('receipt');
    params.delete('id');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    return () => window.removeEventListener('twings:use-case', useCaseSelected);
  }, [labels.inquiryTypeOptions, labels.useCaseOptions]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'sending') return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '');
    const payload = {
      company: text('company'),
      contactName: text('contactName'),
      email: text('email'),
      phone: text('phone'),
      budgetBand: text('budgetBand'),
      templateSlug: text('templateSlug'),
      timing: text('timing'),
      message: text('message'),
      consent: form.get('consent') === 'on',
      locale,
      website: text('website'),
      requestId: text('requestId') || undefined,
      inquiryType: text('inquiryType'),
      useCase: text('useCase'),
    };
    setStatus('sending');
    setField(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; field?: string; receipt?: boolean; id?: string };
      if (response.ok && json.ok === true) {
        setReceipt(json.receipt === true);
        setStatus('sent');
        setInquiryId(typeof json.id === 'string' ? json.id : null);
        try { sessionStorage.removeItem('twings.inquiry.request'); } catch { /* Optional persistence. */ }
        return;
      }
      if (json.code === 'rate_limited') setStatus('rate_limited');
      else if (json.code === 'invalid') {
        setStatus('invalid');
        setField(typeof json.field === 'string' ? json.field : null);
      } else setStatus('unavailable');
    } catch {
      setStatus('unavailable');
    }
  };

  if (status === 'sent') {
    return (
      <div><BrandInquiryReceived labels={labels} receipt={receipt} />{inquiryId && <p className="mt-3 break-all text-xs opacity-60">{labels.referenceLabel}: {inquiryId}</p>}</div>
    );
  }

  const error = status === 'invalid' ? labels.errInvalid : status === 'rate_limited' ? labels.errRateLimited : status === 'unavailable' ? labels.errUnavailable : null;
  const invalid = (name: string) => (field === name ? 'true' : undefined);

  return (
    <form data-brand-inquiry="form" method="post" action={endpoint} onSubmit={submit} className="flex flex-col gap-5">
      <p className="font-label text-label uppercase">{labels.formHeading}</p>
      <input type="hidden" name="locale" value={locale} />
      <input ref={requestIdRef} type="hidden" name="requestId" />

      <div className="grid gap-5 sm:grid-cols-2">
        <label><span className={LABEL}>{labels.inquiryTypeLabel}</span><select name="inquiryType" value={inquiryType} onChange={event => setInquiryType(event.target.value)} className={`${INPUT} mt-2`}>{Object.entries(labels.inquiryTypeOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className={LABEL}>{labels.useCaseLabel}</span><select name="useCase" value={useCase} onChange={event => setUseCase(event.target.value)} className={`${INPUT} mt-2`}>{Object.entries(labels.useCaseOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label>
          <span className={LABEL}>{labels.fieldCompany}</span>
          <input name="company" required maxLength={120} autoComplete="organization" aria-invalid={invalid('company')} className={`${INPUT} mt-2`} />
        </label>
        <label>
          <span className={LABEL}>{labels.fieldName}</span>
          <input name="contactName" required maxLength={80} autoComplete="name" aria-invalid={invalid('contactName')} className={`${INPUT} mt-2`} />
        </label>
        <label>
          <span className={LABEL}>{labels.fieldEmail}</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" aria-invalid={invalid('email')} className={`${INPUT} mt-2`} />
        </label>
        <label>
          <span className={LABEL}>{labels.fieldPhone}</span>
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" inputMode="tel" className={`${INPUT} mt-2`} />
        </label>
        <label>
          <span className={LABEL}>{labels.fieldBudget}</span>
          <select name="budgetBand" defaultValue="undecided" aria-invalid={invalid('budgetBand')} className={`${INPUT} mt-2`}>
            <option value="under_3m">{labels.budgetUnder3m}</option>
            <option value="3m_10m">{labels.budget3mTo10m}</option>
            <option value="10m_30m">{labels.budget10mTo30m}</option>
            <option value="over_30m">{labels.budgetOver30m}</option>
            <option value="undecided">{labels.budgetUndecided}</option>
          </select>
        </label>
        <label>
          <span className={LABEL}>{labels.fieldTemplate}</span>
          <select name="templateSlug" defaultValue="undecided" className={`${INPUT} mt-2`}>
            <option value="undecided">{labels.templateUndecided}</option>
            <option value="new">{labels.templateNew}</option>
            {templates.map((template) => (
              <option key={template.slug} value={template.slug}>
                {template.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <span className={LABEL}>{labels.fieldTiming}</span>
        <input name="timing" maxLength={120} placeholder={labels.timingPlaceholder} className={`${INPUT} mt-2`} />
      </label>

      <label>
        <span className={LABEL}>{labels.fieldMessage}</span>
        <textarea name="message" required minLength={10} maxLength={4000} rows={5} placeholder={labels.messagePlaceholder} aria-invalid={invalid('message')} className={`${INPUT} mt-2`} />
      </label>

      {/* The honeypot. Hidden from people and assistive tech; a script sees a text field called "website". */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="flex items-start gap-3 text-[0.9rem] leading-relaxed">
        <input name="consent" type="checkbox" required aria-invalid={invalid('consent')} className="mt-1 h-4 w-4 shrink-0" style={{ accentColor: 'var(--accent)' }} />
        <span>
          {labels.consent}{' '}
          <a href={privacy.href} className="text-accent underline underline-offset-4">
            {privacy.label} →
          </a>
        </span>
      </label>

      {error && (
        <p data-brand-inquiry-error={status} role="alert" className="border border-accent px-4 py-3 text-[0.9rem] text-accent">
          {error}
        </p>
      )}

      <div>
        <button type="submit" disabled={status === 'sending'} className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase disabled:opacity-60">
          {status === 'sending' ? labels.submitting : `${labels.submit} →`}
        </button>
      </div>
    </form>
  );
}
