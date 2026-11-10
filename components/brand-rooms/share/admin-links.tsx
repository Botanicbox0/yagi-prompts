import { OpForm } from "@/components/admin/chrome";
import { AdminTable, StatusPill, type AdminTone } from "@/components/admin/patterns";
import type { ShareLink, ShareState } from "@/lib/brand-rooms/share-contracts";
import type { roomsReviewEn } from "@/messages/rooms-review";

/**
 * The share links of one draft on the team's review page (docs/BRAND-ROOMS.md §6): state, options,
 * views, expiry, who made it, and the kill switch (`brand_rooms.share.revoke`). Never a token.
 */
const TONES: Record<ShareState, AdminTone> = { live: "action", expired: "hold", revoked: "done" };

export function AdminShareLinks({ shares, reviewId, locale, copy }: { shares: ShareLink[]; reviewId: string; locale: "ko" | "en"; copy: typeof roomsReviewEn }) {
  const a = copy.admin;
  const s = copy.share;
  const date = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" });
  return (
    <section className="mt-4" data-admin-share-links aria-label={a.sharesTitle}>
      <h2>{a.sharesTitle}</h2>
      <AdminTable
        caption={a.sharesTitle}
        columns={[
          { key: "state", label: a.shareColumns.state },
          { key: "options", label: a.shareColumns.options },
          { key: "views", label: a.shareColumns.views, numeric: true },
          { key: "expires", label: a.shareColumns.expires },
          { key: "by", label: a.shareColumns.by },
          { key: "action", label: a.shareColumns.action },
        ]}
        rows={shares.map((link) => ({
          key: link.id,
          data: { "data-admin-share": link.id },
          cells: {
            state: <StatusPill tone={TONES[link.state]}>{s.state[link.state]}</StatusPill>,
            options: [link.hasPassphrase && s.withPassphrase, link.allowComments && s.withComments, link.allowDownload && s.withDownload].filter(Boolean).join(" · ") || "—",
            views: String(link.views),
            expires: date.format(new Date(link.expiresAt)),
            by: a.madeBy[link.createdRole],
            action:
              link.state === "live" ? (
                <OpForm op="brand_rooms.share.revoke" back={`/admin/brand-studio/reviews/${reviewId}`}>
                  <input type="hidden" name="shareId" value={link.id} />
                  <button className="bw-button" type="submit" data-admin-share-revoke={link.id}>
                    {a.revoke}
                  </button>
                </OpForm>
              ) : (
                "—"
              ),
          },
        }))}
        empty={a.noShares}
      />
    </section>
  );
}
