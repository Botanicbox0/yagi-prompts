import type { Dictionary } from '@/messages/en';
import type { Locale } from '@/lib/i18n/config';
import { templateHref } from '@/lib/prompts/links';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import type { CreatorWorkspace } from '@/lib/creator-platform/onboarding';
import { interpolate } from '@/lib/i18n/format';
import { BUTTON_OUTLINE, PANEL } from './styles';

/** The recipe editor (0059). Without it the workspace keeps the older one-prompt form. */
export const recipeEditorHref = (id: string, revise?: string) => `${CREATOR_WORKSPACE_PATH}/formats/${id}${revise ? `?revise=${revise}` : ''}`;

export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(value));
}

const chip = 'inline-flex min-h-7 items-center rounded-full border border-hairline px-3 text-xs';

/** The creator's own submissions: review state, the studio's creator-facing note and public catalog state. */
export function FormatList({ formats, dict, locale, canRevise, recipeEditor = false }: { formats: CreatorWorkspace['formats']; dict: Dictionary; locale: Locale; canRevise: boolean; recipeEditor?: boolean }) {
  const t = dict.creatorProgram, media = { image: dict.community.image, video: dict.community.video };
  if (!formats.length) return <p className="text-sm opacity-65">{t.formatsEmpty}</p>;
  return <ul className="space-y-4">{formats.map((f) => <li key={f.id} data-creator-format={f.id} data-status={f.status} className="space-y-3 border-t border-hairline pt-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h3 className="break-words text-base font-semibold">{f.title}</h3>
      <span className={chip}>{f.status === 'draft' ? dict.makerRecipe.draftState : t.formatState[f.status]}</span>
    </div>
    <p className="text-xs opacity-60">{media[f.medium]} · {interpolate(t.sentOn, { date: formatDate(f.createdAt, locale) })}{f.revisionOf ? ` · ${t.revision}` : ''}{f.exampleUrl ? <> · <a href={f.exampleUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">{t.exampleLink} ↗</a></> : null}</p>
    {f.reviewNote ? <div className="rounded-xl bg-on-surface/5 p-4"><p className="text-xs font-medium opacity-60">{t.noteFromStudio}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{f.reviewNote}</p></div> : null}
    {f.template ? <p data-template-state={f.template.state} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="opacity-60">{t.templateLabel}</span><span className={chip}>{t.templateState[f.template.state]}</span>
      {f.template.slug ? <a href={templateHref(locale, f.template.slug)} className="underline underline-offset-4">{t.viewTemplate} ↗</a> : null}
    </p> : null}
    {f.template?.state === 'published' ? <p className="text-xs opacity-60">{t.publishedHint}</p> : null}
    {f.status === 'draft' && recipeEditor ? <a href={recipeEditorHref(f.id)} data-recipe-continue className={BUTTON_OUTLINE}>{dict.makerRecipe.continueDraft}</a> : null}
    {canRevise && f.status === 'rejected' ? <a href={recipeEditor ? recipeEditorHref('new', f.id) : `${CREATOR_WORKSPACE_PATH}?revise=${f.id}#submit`} className={BUTTON_OUTLINE}>{t.resubmit}</a> : null}
  </li>)}</ul>;
}

/** Counts and recorded shares only: no costs, fees or customer data reach this table. */
export function EarningsTable({ earnings, dict, locale }: { earnings: CreatorWorkspace['earnings']; dict: Dictionary; locale: Locale }) {
  const t = dict.creatorProgram, number = (n: number) => n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');
  const payoutStatusLabel = locale === 'en'
    ? 'Estimated revenue accruing (payout setup pending)'
    : '예상 수익 적립 (출금 준비 중)';
  return <section data-creator-earnings className={PANEL}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">{t.earningsHeading}</h2>
      <span
        data-maker-payout-status="accruing"
        className="inline-flex items-center rounded-full border border-[#E4E4E7] bg-[#F4F4F5] px-3 py-1 text-xs font-medium text-[#52525B]"
      >
        {payoutStatusLabel}
      </span>
    </div>
    <p className="text-sm leading-relaxed opacity-70">{t.earningsHint}</p>
    {!earnings.length ? <p className="text-sm opacity-65">{t.earningsEmpty}</p> : <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs opacity-60"><tr><th scope="col" className="py-2 pr-4 font-medium">{t.colTemplate}</th><th scope="col" className="py-2 pr-4 text-right font-medium">{t.colOrders}</th><th scope="col" className="py-2 pr-4 text-right font-medium">{t.colPending}</th><th scope="col" className="py-2 pr-4 text-right font-medium">{t.colSettled}</th><th scope="col" className="py-2 text-right font-medium">{t.colDue}</th></tr></thead>
        <tbody>{earnings.map((row) => <tr key={row.templateId} data-creator-earnings-row={row.templateId} className="border-t border-hairline tabular-nums">
          <th scope="row" className="py-3 pr-4 font-normal break-words">{row.title}</th><td className="py-3 pr-4 text-right">{number(row.orders)}</td><td className="py-3 pr-4 text-right">{number(row.pending)}</td><td className="py-3 pr-4 text-right">{number(row.settled)}</td><td className="py-3 text-right">₩{number(row.creatorDue)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
