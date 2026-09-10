'use client';

import { useEffect, useState, type FormEvent } from 'react';

/**
 * The brand enquiry form (founder, 2026-09-11) — a client island on a static page.
 *
 * It posts JSON to `endpoint` and swaps itself for the receipt; the page never reads a search
 * param, so the campaigns listing keeps its one-HTML-for-everyone cache mode. The honeypot is a
 * real input a person cannot see or tab to; a script that fills every field fills it too.
 */

export interface BrandFormLabels {
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
  errInvalid: string;
  errRateLimited: string;
  errUnavailable: string;
}

export interface BrandFormTemplate {
  slug: string;
  title: string;
}

const INPUT = 'w-full border border-hairline bg-transparent px-4 py-3 text-body focus:outline focus:outline-2 focus:outline-accent';
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

type Status = 'idle' | 'sending' | 'sent' | 'invalid' | 'rate_limited' | 'unavailable';

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

  // Progressive enhancement: a submit that lands before hydration (slow phone, slow network) is a
  // plain POST to the same endpoint, which answers with a redirect back here carrying `?inquiry=`.
  // Read it once, show the same state the fetch path would, and take it off the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('inquiry');
    if (!outcome) return;
    if (outcome === 'sent') setStatus('sent');
    else if (outcome === 'rate_limited' || outcome === 'invalid' || outcome === 'unavailable') {
      setStatus(outcome);
      setField(params.get('field'));
    }
    params.delete('inquiry');
    params.delete('field');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }, []);

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
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; field?: string };
      if (response.ok && json.ok === true) {
        setStatus('sent');
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
      <div data-brand-inquiry="sent" role="status" className="border border-accent p-6 sm:p-8">
        <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{labels.successTitle}</p>
        <p className="mt-4 max-w-detail text-body opacity-70">{labels.successBody}</p>
      </div>
    );
  }

  const error = status === 'invalid' ? labels.errInvalid : status === 'rate_limited' ? labels.errRateLimited : status === 'unavailable' ? labels.errUnavailable : null;
  const invalid = (name: string) => (field === name ? 'true' : undefined);

  return (
    <form data-brand-inquiry="form" method="post" action={endpoint} onSubmit={submit} className="flex flex-col gap-5">
      <p className="font-label text-label uppercase">{labels.formHeading}</p>
      <input type="hidden" name="locale" value={locale} />

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
