'use client';

import { useState } from 'react';
import { interpolate } from '@/lib/i18n/format';
import type { getDictionary } from '@/lib/i18n/dictionaries';

export interface SubscriptionUsageOption { id: string; label: string; credits: number }
export interface SubscriptionPreviewPlan { id: string; label: string; monthlyCredits: number }
type Copy = ReturnType<typeof getDictionary>['pricing'];

/** A local estimate only; selecting a plan does not enroll or charge anyone. */
export function SubscriptionUsagePreview({ options, plans, copy }: { options: SubscriptionUsageOption[]; plans: SubscriptionPreviewPlan[]; copy: Copy }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find(plan => plan.id === planId) ?? plans[0];
  const [rows, setRows] = useState([{ id: options[0]?.id ?? '', count: 4 }, { id: options[1]?.id ?? options[0]?.id ?? '', count: 0 }]);
  const credits = rows.reduce((sum, row) => sum + (options.find(option => option.id === row.id)?.credits ?? 0) * row.count, 0);
  const total = plan ? credits / plan.monthlyCredits * 100 : 0;
  const exceeds = total > 100 + 1e-9;
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  return (
    <div data-subscription-preview className="mt-8 border-t border-hairline pt-6">
      <h3 className="font-display text-xl font-black">{copy.subscriptionCompare}</h3>
      <label htmlFor="subscription-preview-plan" className="mt-5 block font-label text-eyebrow">{copy.subscriptionPlanLabel}</label>
      <select id="subscription-preview-plan" value={planId} onChange={event => setPlanId(event.target.value)} className="mt-2 w-full border border-hairline bg-surface p-3 text-sm">
        {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
      </select>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {rows.map((row, index) => (
          <fieldset key={index} className="min-w-0 border border-hairline p-4">
            <legend className="px-1 font-mono text-xs">{index + 1}</legend>
            <label htmlFor={`subscription-film-${index}`} className="block font-label text-eyebrow opacity-60">{copy.subscriptionTemplate}</label>
            <select id={`subscription-film-${index}`} value={row.id} onChange={event => update(index, { id: event.target.value })} className="mt-2 w-full min-w-0 border border-hairline bg-surface p-2 text-sm">
              {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <label htmlFor={`subscription-count-${index}`} className="mt-4 block font-label text-eyebrow opacity-60">{copy.subscriptionQuantity}</label>
            <input id={`subscription-count-${index}`} type="number" min={0} max={20} step={1} value={row.count} onChange={event => {
              const count = Number(event.target.value);
              update(index, { count: Number.isFinite(count) ? Math.max(0, Math.min(20, Math.floor(count))) : 0 });
            }} className="mt-2 w-24 border border-hairline bg-surface p-2 font-mono text-sm" />
          </fieldset>
        ))}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-5">
        <p className="font-display text-2xl font-black">{interpolate(copy.subscriptionCreditTotal, { used: String(credits), total: String(plan?.monthlyCredits ?? 0) })}</p>
        <p className="mt-2 text-sm opacity-70">{interpolate(copy.subscriptionTotal, { percent: String(Math.round(total * 10) / 10) })}</p>
        <div aria-hidden="true" className="mt-3 h-1 bg-hairline"><div className="h-full bg-accent" style={{ width: `${Math.min(total, 100)}%` }} /></div>
        <p data-subscription-estimate={exceeds ? 'exceeds' : 'fits'} className="mt-3 text-sm leading-relaxed">{exceeds ? copy.subscriptionExceeds : copy.subscriptionFits}</p>
      </div>
      <p className="mt-4 text-xs leading-relaxed opacity-60">{copy.subscriptionPreviewNote}</p>
    </div>
  );
}
