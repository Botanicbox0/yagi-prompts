import type { ReactNode } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { ReviewEntry } from '@/lib/recipes/review';
import { OpForm, INPUT, BUTTON_PRIMARY } from '@/components/admin/chrome';

/**
 * The v2 half of a submitted format in `/admin/community` (docs/PLATFORM-2.0.md §7.4): what the recipe
 * does (steps, engines, inputs, files), three review renders side by side, and the accept form with
 * the final price prefilled from the proposal (floor + royalty). The JS-free admin form language.
 */
export function RecipeReviewPanel({ entry, copy, mediums, reason, note, submitted, locale, acceptLabel, rejectLabel }: {
  entry: ReviewEntry; copy: Dictionary['makerRecipe']; mediums: { video: string; image: string; carousel: string }; acceptLabel: string; rejectLabel: string;
  reason: ReactNode; note: ReactNode; submitted: boolean; locale: string;
}) {
  const r = copy.review;
  const won = (n: number) => interpolate(copy.royaltyValue, { amount: n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') });
  const fileLabel = (handle: string | null) => {
    const at = entry.files.filter((f) => f.role === 'reference').findIndex((f) => f.id === handle);
    return at >= 0 ? interpolate(copy.referenceLabel, { n: String(at + 1) }) : '?';
  };
  return <div data-recipe-review={entry.id} className="space-y-4 rounded-xl bg-on-surface/5 p-4">
    <p className="text-sm font-semibold">{r.heading}{entry.medium ? ` · ${mediums[entry.medium]}` : ''}{entry.titleKo ? ` · ${entry.titleKo}` : ''}</p>
    {!entry.valid ? <p role="alert" className="text-sm">{r.invalid}</p> : null}
    <ol className="space-y-3">{entry.steps.map((step, i) => <li key={step.id} data-recipe-review-step={step.id} className="space-y-1 text-sm">
      <p className="font-medium">{interpolate(copy.stepLabel, { n: String(i + 1) })} · {step.kind === 'image' ? copy.stepImage : copy.stepVideo} · {step.engine} · {step.aspect}{step.duration ? ` · ${step.duration}s · ${step.resolution}` : ''}</p>
      <p className="text-xs opacity-70">{r.slots}: {step.inputs.join(', ')}</p>
      <pre className="whitespace-pre-wrap break-words text-xs">{step.prompt}</pre>
    </li>)}</ol>
    <p className="text-xs">{r.slots}: {entry.slots.map((slot) => `${slot.name} (${slot.source === 'user' ? r.customerInput : `${r.makerFile} ${fileLabel(slot.asset)}`})`).join(' · ')}</p>
    {entry.files.length ? <ul className="flex flex-wrap gap-2" aria-label={r.files}>{entry.files.map((f) => <li key={f.id}>
      <a href={`/api/makers/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="block text-xs underline">{f.role === 'example' ? copy.exampleUploaded : fileLabel(f.id)} · {f.kind === 'image' ? copy.fileImage : copy.fileVideo} ↗</a>
    </li>)}</ul> : null}
    <p className="text-xs opacity-70">{r.disclosure}: {[entry.disclosure.prompts ? copy.disclosurePrompts : null, entry.disclosure.assets ? copy.disclosureAssets : null].filter(Boolean).join(' · ') || r.off} · {r.presentation}: {entry.presentation === 'story-first' ? copy.storyFirst : copy.makeFirst} · {r.royalty}: {entry.royaltyKrw ? won(entry.royaltyKrw) : '—'} · {interpolate(r.testsUsed, { n: String(entry.testRendersUsed) })}</p>

    <section data-recipe-review-renders className="space-y-2">
      <p className="text-sm font-medium">{r.renders}</p>
      {entry.renders.length ? <ul className="grid gap-3 sm:grid-cols-3">{entry.renders.map((render) => <li key={render.id} data-status={render.status} className="space-y-1 rounded-lg border border-hairline p-2 text-xs">
        <p>{copy.testStatus[render.status as keyof typeof copy.testStatus] ?? render.status}{render.errorCode ? ` · ${render.errorCode}` : ''}</p>
        {render.status === 'succeeded' ? Array.from({ length: Math.max(1, render.outputs) }, (_, n) => <a key={n} href={`/api/makers/renders/${render.id}/${n}`} target="_blank" rel="noopener noreferrer" className="block underline">{interpolate(copy.testFrame, { n: String(n + 1) })} ↗</a>) : null}
      </li>)}</ul> : <p className="text-xs opacity-60">{r.none}</p>}
      {submitted && entry.valid ? <OpForm op="platform.review" back="/admin/community" className="space-y-2">
        <input type="hidden" name="action" value="render" /><input type="hidden" name="id" value={entry.id} />
        <p className="text-xs opacity-70">{r.renderHint}</p>
        {reason}
        <button className={`${BUTTON_PRIMARY} min-h-10`}>{r.render}</button>
      </OpForm> : null}
    </section>

    {submitted ? <OpForm op="platform.manage" back="/admin/community" className="space-y-3 rounded-xl border border-hairline p-4">
      <input type="hidden" name="action" value="format" /><input type="hidden" name="id" value={entry.id} />
      <label className="block text-sm">{r.price}<input className={`${INPUT} mt-1 min-h-10`} name="priceKrw" type="number" step="100" min={entry.quote?.floorKrw ?? 100} max={entry.quote?.ceilingKrw ?? undefined} defaultValue={entry.quote?.proposedKrw ?? ''} /></label>
      {entry.quote ? <p className="text-xs opacity-70">{interpolate(r.priceHint, { floor: won(entry.quote.floorKrw), royalty: won(entry.quote.royaltyKrw), proposed: won(entry.quote.proposedKrw) })}</p> : null}
      {entry.quote?.ceilingKrw ? <p data-recipe-price-ceiling={entry.quote.ceilingKrw} className="text-xs opacity-70">{interpolate(r.priceCeiling, { ceiling: won(entry.quote.ceilingKrw) })}</p> : null}
      {note}
      {reason}
      <div className="flex flex-wrap gap-3"><button className={`${BUTTON_PRIMARY} min-h-10`} name="accept" value="true" disabled={!entry.valid}>{acceptLabel}</button><button className={`${BUTTON_PRIMARY} min-h-10`} name="accept" value="false">{rejectLabel}</button></div>
    </OpForm> : null}
  </div>;
}
