import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { loadPublishedPrompts } from '@/lib/prompts/repo';
import { ADMIN_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { AdminShell, BUTTON_PRIMARY, OpForm, OutcomeBanner } from '@/components/admin/chrome';
import { CampaignFields } from '@/components/admin/campaign-fields';
import { loadCampaignPrefill } from '@/components/admin/campaign-prefill';
import { getViewer } from '@/lib/auth/viewer';
import { interpolate } from '@/lib/i18n/format';

/**
 * `/admin/campaigns/new` — one form, one POST; the campaign is born a draft and opens in its editor.
 * `?project=<id>` starts the form from that brand's wizard request (docs/PLATFORM-2.0.md §16.3): the
 * same `campaign.create` operation, only its inputs pre-filled.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql, viewer] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner(), getViewer()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const styleSlugs = sql === null ? [] : (await loadPublishedPrompts(sql)).map((prompt) => prompt.slug);
  const requested = one(params, 'project');
  const from = sql === null ? null : await loadCampaignPrefill(sql, viewer, requested);
  const audience = from ? dict.brandWorkspace.wizard.audience.modes[from.prefill.audience === 'invited' ? 'invited' : from.prefill.audience === 'influencers' ? 'criteria' : 'all'] : '';

  return (
    <AdminShell dict={a} locale={locale} active="campaigns">
      <a href={ADMIN_CAMPAIGNS_PATH} className="font-label text-eyebrow uppercase opacity-60">
        ← {a.backToCampaigns}
      </a>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{a.newCampaignHeading}</h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.newCampaignLede}</p>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      {from && (
        <div data-campaign-prefill={from.projectId} className="mt-6 max-w-detail border border-hairline p-4 text-body">
          <p>{interpolate(a.campaignPrefillNote, { project: from.projectTitle })}</p>
          <p className="mt-2 opacity-70">{interpolate(a.campaignPrefillAudience, { audience })}</p>
          <p className="mt-2 opacity-70">{a.campaignPrefillBind} <a className="underline" href={`/admin/brand-workspace/${from.projectId}`}>{from.projectTitle} →</a></p>
        </div>
      )}
      {requested && !from && <p data-campaign-prefill-missing className="mt-6 text-body opacity-70">{a.campaignPrefillMissing}</p>}

      <OpForm op="campaign.create" back={from ? `/admin/campaigns/new?project=${from.projectId}` : '/admin/campaigns/new'} className="mt-8 flex flex-col gap-5">
        <CampaignFields row={null} prefill={from?.prefill ?? null} dict={dict} styleSlugs={styleSlugs} />
        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.createCampaign}
          </button>
        </div>
      </OpForm>
    </AdminShell>
  );
}
