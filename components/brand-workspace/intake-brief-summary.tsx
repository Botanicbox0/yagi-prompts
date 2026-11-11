import type { IntakeBrief } from '@/lib/brands/workspace/intake-brief';
import type { IntakeBriefCopy } from '@/messages/intake-brief';
import { intakeBriefEn, intakeBriefKo } from '@/messages/intake-brief';
import { interpolate } from '@/lib/i18n/format';

function ratioLabel(copy: IntakeBriefCopy, ratio: IntakeBrief['deliverables']['aspectRatios'][number]): string {
  switch (ratio) {
    case '9:16':
      return copy.ratios.r9x16;
    case '4:5':
      return copy.ratios.r4x5;
    case '1:1':
      return copy.ratios.r1x1;
    case '16:9':
      return copy.ratios.r16x9;
  }
}

export function IntakeBriefSummary({
  brief,
  locale = 'ko',
  copy: providedCopy,
}: {
  brief: IntakeBrief;
  locale?: string;
  copy?: IntakeBriefCopy;
}) {
  const copy = providedCopy ?? (locale === 'en' ? intakeBriefEn : intakeBriefKo);
  const s = copy.summaryCard;
  const d = brief.deliverables;
  const deliverableParts = [
    d.kind,
    d.duration,
    d.aspectRatios.map((r) => ratioLabel(copy, r)).join(', '),
    d.quantity !== null ? interpolate(s.quantityUnit, { count: d.quantity }) : '',
    d.channels.map((ch) => copy.channels[ch]).join(', '),
  ].filter(Boolean);

  const scheduleLine =
    brief.schedule.startsOn || brief.schedule.dueOn
      ? `${brief.schedule.startsOn ?? s.unspecified} ~ ${brief.schedule.dueOn ?? s.unspecified}`
      : s.unspecified;

  return (
    <dl className="bw-meta bw-terms-summary" data-intake-brief-summary>
      <div>
        <dt>{s.track}</dt>
        <dd>
          <strong>{copy.tracks[brief.track].title}</strong>
        </dd>
      </div>
      <div>
        <dt>{s.goal}</dt>
        <dd className="bw-prose">{brief.summary}</dd>
      </div>
      {brief.briefText ? (
        <div>
          <dt>{s.briefNotes}</dt>
          <dd className="bw-prose" style={{ whiteSpace: 'pre-wrap' }}>
            {brief.briefText}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{s.deliverables}</dt>
        <dd>{deliverableParts.length > 0 ? deliverableParts.join(' · ') : s.unspecified}</dd>
      </div>
      <div>
        <dt>{s.schedule}</dt>
        <dd>{scheduleLine}</dd>
      </div>
      <div>
        <dt>{s.budget}</dt>
        <dd>{copy.budgets[brief.budgetBand]}</dd>
      </div>
      <div>
        <dt>{s.contact}</dt>
        <dd>
          {brief.contact.name} · {copy.contactChannels[brief.contact.channel]} ({brief.contact.value})
          {brief.contact.approver ? ` · ${s.approverPrefix}: ${brief.contact.approver}` : ''}
        </dd>
      </div>
      {brief.briefFileNames.length > 0 ? (
        <div>
          <dt>{s.files}</dt>
          <dd>{brief.briefFileNames.join(', ')}</dd>
        </div>
      ) : null}
      {brief.studioAssetIds.length > 0 ? (
        <div>
          <dt>{interpolate(s.brandAssets, { count: brief.studioAssetIds.length })}</dt>
          <dd>{brief.studioAssetIds.length}</dd>
        </div>
      ) : null}
    </dl>
  );
}
