import type { BrandCopy } from "./action-form";
import { formatKrw, interpolate } from "@/lib/i18n/format";
import type { CampaignTerms, WizardStep } from "@/lib/brands/workspace/campaign-terms";

type Copy = BrandCopy["wizard"];
/** Platform names are brand names: the same in both languages. */
export const PLATFORM_NAMES = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/** The request as the brand will see it again on the campaign page (overview tab). */
export function CampaignTermsSummary({ t, b, locale, title, objective, organizationName, terms, onEdit, formatTitle }: {
  t: Copy; b: BrandCopy; locale: string; title: string; objective: string; organizationName?: string; terms: CampaignTerms;
  onEdit?: (s: WizardStep) => void; formatTitle?: string | null;
}) {
  const r = terms.reward, a = terms.audience, s = terms.schedule, none = t.review.none;
  const krw = (n: number) => formatKrw(n, locale);
  const edit = (step: WizardStep) => onEdit && <button type="button" className="bw-button bw-wizard-edit" onClick={() => onEdit(step)}>{t.edit}<span className="sr-only"> · {t.steps[step]}</span></button>;
  const platforms = a.mode === "criteria" ? a.platforms.map((p) => PLATFORM_NAMES[p]).join(", ") : "";
  return (
    <dl className="bw-meta bw-terms-summary" data-campaign-terms>
      {organizationName !== undefined && <div><dt>{t.review.organization}</dt><dd>{organizationName}</dd></div>}
      <div><dt>{t.steps.format}</dt><dd>
        <strong>{title}</strong><p className="bw-prose">{objective}</p>
        <p>{terms.format.kind === "template" ? `${terms.format.source === "yagi" ? t.format.originals : t.format.creators} · ${formatTitle ?? terms.format.slug}` : `${t.format.custom} · ${terms.format.note}`}</p>
        {edit("format")}
      </dd></div>
      <div><dt>{t.steps.reward}</dt><dd>
        <p>{t.reward.models[r.model]} · {interpolate(t.review.perCreator, { min: krw(r.rewardMinKrw), max: krw(r.rewardMaxKrw) })}{r.perThousandViewsKrw ? ` · ${interpolate(t.review.perK, { amount: krw(r.perThousandViewsKrw) })}` : ""}</p>
        <p>{interpolate(t.review.slots, { count: r.slots })} · {krw(r.totalBudgetKrw)} ({t.reward.tax[r.taxBasis]})</p>
        {edit("reward")}
      </dd></div>
      <div><dt>{t.steps.audience}</dt><dd>
        <p>{t.audience.modes[a.mode]}</p>
        {a.mode === "criteria" && <p>{[platforms, a.minFollowers !== null ? interpolate(t.review.followersAtLeast, { count: a.minFollowers.toLocaleString(locale) }) : "", a.gender !== "any" ? t.audience.genders[a.gender] : "", a.regions.join(", ")].filter(Boolean).join(" · ")}</p>}
        {a.mode === "invited" && <p className="bw-muted">{t.audience.modeHints.invited}</p>}
        {edit("audience")}
      </dd></div>
      <div><dt>{t.steps.schedule}</dt><dd>
        <p>{t.schedule.closeOn} {s.applicationsCloseOn} · {t.schedule.postBy} {s.postDeadlineOn}</p>
        <p>{t.schedule.hashtags}: {s.hashtags.map((h) => `#${h}`).join(" ") || none}</p>
        <p>{t.schedule.mentions}: {s.mentions.map((m) => `@${m}`).join(" ") || none}</p>
        <p>{t.schedule.disclosure}: {t.schedule.disclosureFixed}</p>
        <p>{t.schedule.prohibited}: {s.prohibited || none}</p>
        {edit("schedule")}
      </dd></div>
    </dl>
  );
}
