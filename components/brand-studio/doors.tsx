/**
 * The three doors on `/brand` (docs/BRAND-STUDIO-V2.md §5.1): 만들기 · 포맷 · 캠페인, one action each.
 * Rendered only when `studioV2Visible` is true, so a sandboxed or generation-closed brand never sees
 * a door, a link or a word about the studio. Server component.
 */
import { scopedHref, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import type { StudioCopy } from "./copy";

/** The campaign list the campaign door scrolls to when there is one. */
export const CAMPAIGN_LIST_ANCHOR = "brand-campaigns";

export function BrandDoors({
  copy,
  choice,
  hasCampaigns,
  canRequest,
}: {
  copy: StudioCopy;
  choice: Pick<BrandWorkspaceChoice, "id">;
  hasCampaigns: boolean;
  canRequest: boolean;
}) {
  const d = copy.doors;
  const campaign = hasCampaigns ? `#${CAMPAIGN_LIST_ANCHOR}` : canRequest ? scopedHref("/brand/projects/new", choice) : null;
  const doors = [
    { key: "create", href: scopedHref("/brand/studio", choice), ...d.create },
    { key: "formats", href: scopedHref("/brand/studio?tab=formats", choice), ...d.formats },
    ...(campaign ? [{ key: "campaign", href: campaign, ...d.campaign }] : []),
  ];
  return (
    <nav className="bs-doors" data-brand-doors aria-label={d.label}>
      <ul>
        {doors.map((door) => (
          <li key={door.key}>
            <a className="bs-door" href={door.href} data-brand-door={door.key}>
              <span className="bs-door-title">{door.title}</span>
              <span className="bs-door-line">{door.line}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
