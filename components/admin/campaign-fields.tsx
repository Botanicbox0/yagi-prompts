import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { CampaignRow } from '@/lib/campaigns/repo';
import {
  CAMPAIGN_PLATFORMS,
  DELIVERABLES,
  DEFAULT_HOLD_DAYS,
  PAYOUT_MODELS,
  SLOTS_MAX,
} from '@/lib/campaigns/schemas';
import { HOST_KINDS } from '@/lib/contests/schemas';
import { toKstDateTimeLocal } from '@/lib/campaigns/dates';
import { campaignLabels } from '@/components/campaigns/labels';
import { Field, INPUT, LABEL, LocalePair } from '@/components/admin/chrome';

/**
 * The campaign form body (docs/CAMPAIGNS.md §5) — shared by "new campaign" and the editor, so the
 * field list has exactly one spelling and `lib/admin/campaign-operations.ts#campaignFields` reads
 * what this renders. Money is typed in whole 원 (the schema's integer "cents" ARE 원 for KRW).
 */
export function CampaignFields({
  row,
  dict,
  styleSlugs,
}: {
  row: CampaignRow | null;
  dict: Dictionary;
  /** Published studio styles, for the format picker's datalist. */
  styleSlugs: string[];
}) {
  const a = dict.admin;
  const labels = campaignLabels(dict);
  const payout = row?.payout ?? null;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldCampaignSlug} hint={a.campaignSlugHint}>
          <input type="text" name="slug" required defaultValue={row?.slug ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldStyleSlug} hint={a.styleSlugHint}>
          <input type="text" name="styleSlug" list="campaign-style-slugs" defaultValue={row?.styleSlug ?? ''} className={INPUT} />
          <datalist id="campaign-style-slugs">
            {styleSlugs.map((slug) => (
              <option key={slug} value={slug} />
            ))}
          </datalist>
        </Field>
        <Field label={a.fieldHostName}>
          <input type="text" name="hostName" required defaultValue={row?.hostName ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldHostKind} hint={a.hostKindHint}>
          <select name="hostKind" defaultValue={row?.hostKind ?? 'brand'} className={INPUT}>
            {HOST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {a.hostKinds[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldHostUrl}>
          <input type="url" name="hostUrl" placeholder="https://" defaultValue={row?.hostUrl ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldBudget} hint={a.budgetHint}>
          <input type="number" name="budgetCents" min={0} step={1} defaultValue={row?.budgetCents ?? ''} className={INPUT} />
        </Field>
      </div>

      <LocalePair label={a.fieldCampaignTitle} name="title" value={row?.title ?? null} multiline rows={2} />
      <LocalePair label={a.fieldCampaignSummary} name="summary" value={row?.summary ?? null} multiline />
      <LocalePair label={a.fieldCampaignBrief} name="brief" value={row?.brief ?? null} hint={a.campaignBriefHint} multiline rows={8} />

      {/* The deliverable: where, what, how many, by when. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset>
          <legend className={LABEL}>{a.fieldPlatforms}</legend>
          <div className="mt-1.5 flex flex-wrap gap-4">
            {CAMPAIGN_PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-2 font-mono text-code">
                <input
                  type="checkbox"
                  name="platforms"
                  value={platform}
                  defaultChecked={row ? row.platforms.includes(platform) : platform === 'instagram'}
                />
                {labels.platform[platform]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={a.fieldDeliverable}>
          <select name="deliverable" defaultValue={row?.deliverable ?? 'reel'} className={INPUT}>
            {DELIVERABLES.map((deliverable) => (
              <option key={deliverable} value={deliverable}>
                {labels.deliverable[deliverable]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldSlots} hint={a.slotsHint}>
          <input type="number" name="slots" required min={1} max={SLOTS_MAX} step={1} defaultValue={row?.slots ?? 5} className={INPUT} />
        </Field>
        <div />
        <Field label={a.fieldApplicationsCloseAt} hint={a.campaignDatesHint}>
          <input type="datetime-local" name="applicationsCloseAt" defaultValue={toKstDateTimeLocal(row?.applicationsCloseAt)} className={INPUT} />
        </Field>
        <Field label={a.fieldPostDeadlineAt}>
          <input type="datetime-local" name="postDeadlineAt" defaultValue={toKstDateTimeLocal(row?.postDeadlineAt)} className={INPUT} />
        </Field>
      </div>

      {/* The fee rule (§4). Whole 원; the schema refuses a hybrid whose cap is below its flat part. */}
      <fieldset className="grid gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
        <legend className={LABEL}>{a.fieldPayoutModel}</legend>
        <p className="font-mono text-[0.72rem] opacity-50 sm:col-span-3">{a.payoutHint}</p>
        <Field label={a.fieldPayoutModel}>
          <select name="payoutModel" defaultValue={payout?.model ?? 'hybrid'} className={INPUT}>
            {PAYOUT_MODELS.map((model) => (
              <option key={model} value={model}>
                {a.payoutModels[model]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldPayoutFlat}>
          <input type="number" name="payoutFlat" min={0} step={1} defaultValue={payout?.flatCents ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldPayoutPerK}>
          <input type="number" name="payoutPerK" min={0} step={1} defaultValue={payout?.perThousandViewsCents ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldPayoutMin}>
          <input type="number" name="payoutMin" min={0} step={1} defaultValue={payout?.minCents ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldPayoutMax}>
          <input type="number" name="payoutMax" min={0} step={1} defaultValue={payout?.maxCents ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldHoldDays}>
          <input type="number" name="holdDays" min={0} max={60} step={1} defaultValue={payout?.holdDays ?? DEFAULT_HOLD_DAYS} className={INPUT} />
        </Field>
      </fieldset>

      {/* What the post must carry. */}
      <div className="grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
        <Field label={a.fieldHashtags} hint={a.requirementsHint}>
          <input type="text" name="hashtags" defaultValue={row?.requirements.hashtags.join(' ') ?? ''} placeholder="#twings #광고" className={INPUT} />
        </Field>
        <Field label={a.fieldMentions}>
          <input type="text" name="mentions" defaultValue={row?.requirements.mentions.join(' ') ?? ''} placeholder="@twings.app" className={INPUT} />
        </Field>
        <label className="flex items-center gap-2 font-mono text-code sm:col-span-2">
          <input type="checkbox" name="disclosure" defaultChecked={row ? row.requirements.disclosure : true} />
          {a.fieldDisclosure}
        </label>
      </div>
    </>
  );
}
