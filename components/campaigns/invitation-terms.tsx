import type { CreatorCampaign } from "@/lib/campaigns/service";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { localize, interpolate } from "@/lib/i18n/format";
import { formatCampaignDateTime } from "@/lib/campaigns/dates";
import { payoutSentence } from "@/lib/campaigns/copy";
import { campaignLabels } from "@/components/campaigns/labels";
import { Markdown } from "@/components/playbook/markdown";
import { collaborationCopy } from "@/messages/campaign-collaboration";
export function InvitationTerms({
  campaign: c,
  locale,
  dict,
}: {
  campaign: CreatorCampaign;
  locale: "ko" | "en";
  dict: Dictionary;
}) {
  const labels = campaignLabels(dict),
    t = collaborationCopy(locale),
    brief = c.brief ? localize(c.brief, locale) : "";
  return (
    <section
      className="mb-8 rounded-xl border border-hairline p-5"
      data-campaign-invitation-terms
    >
      <h2 className="font-semibold">{localize(c.title, locale)}</h2>
      <p className="mt-3 whitespace-pre-wrap text-sm">
        {localize(c.summary, locale)}
      </p>
      {brief && (
        <section
          className="mt-5 border-t border-hairline pt-5"
          data-campaign-invitation-brief
        >
          <h3 className="font-semibold">{dict.campaigns.briefHeading}</h3>
          <div className="mt-3 text-sm leading-relaxed">
            <Markdown source={brief} />
          </div>
        </section>
      )}
      {c.payout && (
        <p className="mt-4 text-sm">
          {payoutSentence(c.payout, locale, labels.payout)}
        </p>
      )}
      <dl className="mt-4 grid gap-2 text-sm">
        <dt className="opacity-60">{dict.campaigns.timelineHeading}</dt>
        <dd>
          {interpolate(labels.applyBy, {
            date: formatCampaignDateTime(c.applicationsCloseAt, locale) ?? "—",
          })}
          <br />
          {interpolate(labels.postBy, {
            date: formatCampaignDateTime(c.postDeadlineAt, locale) ?? "—",
          })}
        </dd>
        <dt className="mt-2 opacity-60">{dict.campaigns.reqPlatforms}</dt>
        <dd>
          {c.platforms.map((p) => labels.platform[p]).join(" · ")} ·{" "}
          {labels.deliverable[c.deliverable]}
        </dd>
        <dt className="mt-2 opacity-60">{dict.campaigns.slotsLabel}</dt>
        <dd>
          {interpolate(labels.slotsLine, {
            left: String(Math.max(0, c.slots - c.slotsTaken)),
            slots: String(c.slots),
          })}
        </dd>
      </dl>
      <p className="mt-3 text-sm">
        {[
          ...(c.requirements.disclosure ? [dict.campaigns.reqDisclosure] : []),
          ...c.requirements.hashtags.map((h) => `#${h}`),
          ...c.requirements.mentions.map((m) => `@${m}`),
        ].join(" · ")}
      </p>
      <a
        href={`/${locale}/campaigns/${encodeURIComponent(c.slug)}`}
        className="mt-4 inline-block text-sm text-accent underline"
      >
        {t.back}
      </a>
    </section>
  );
}
