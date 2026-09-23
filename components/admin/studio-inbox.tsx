import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { StudioInboxEntry } from '@/lib/brands/workspace/inbox';
import { formatCampaignDateTime } from '@/lib/campaigns/dates';
import { interpolate } from '@/lib/i18n/format';

/**
 * P1-2: "답장 대기" on /admin/brand-workspace — every brand thread whose latest message is the
 * brand's, oldest first, each linking to the page where the studio answers it.
 */
export function StudioInboxPanel({ entries, admin, locale }: { entries: StudioInboxEntry[]; admin: Dictionary['admin']; locale: string }) {
  return (
    <section className="bw-panel" id="studio-inbox" data-studio-inbox={entries.length}>
      <div className="bw-section-heading"><h2>{admin.inboxHeading} ({entries.length})</h2></div>
      <p className="bw-muted">{entries.length === 0 ? admin.inboxEmpty : admin.inboxLede}</p>
      {entries.length > 0 && (
        <ul className="bw-brand-list">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.projectId ?? entry.organizationId}`} data-studio-inbox-entry={entry.kind}>
              <a href={entry.href}>
                <strong>{entry.kind === 'project' ? `${entry.organizationName} · ${entry.projectTitle}` : entry.organizationName}</strong>
                <span>
                  {entry.kind === 'project' ? admin.inboxProject : admin.inboxSupport}
                  {' · '}
                  {interpolate(admin.inboxSince, { date: formatCampaignDateTime(entry.lastMessageAt, locale) ?? '' })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
