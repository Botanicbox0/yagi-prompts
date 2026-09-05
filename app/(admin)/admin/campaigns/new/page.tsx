import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { loadPublishedPrompts } from '@/lib/prompts/repo';
import { ADMIN_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { AdminShell, BUTTON_PRIMARY, OpForm, OutcomeBanner } from '@/components/admin/chrome';
import { CampaignFields } from '@/components/admin/campaign-fields';

/** `/admin/campaigns/new` — one form, one POST; the campaign is born a draft and opens in its editor. */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const styleSlugs = sql === null ? [] : (await loadPublishedPrompts(sql)).map((prompt) => prompt.slug);

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

      <OpForm op="campaign.create" back="/admin/campaigns/new" className="mt-8 flex flex-col gap-5">
        <CampaignFields row={null} dict={dict} styleSlugs={styleSlugs} />
        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.createCampaign}
          </button>
        </div>
      </OpForm>
    </AdminShell>
  );
}
