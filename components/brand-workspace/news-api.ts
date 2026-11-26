/**
 * The home's news slot, browser side (docs/BRAND-PROJECT-SPINE.md §6, slice 3b): close the announcement for this
 * person (`news.dismiss` on `POST /api/brand-workspace`). The line is drawn from the server's answer
 * (lib/brand-news/service.ts `loadHomeAnnouncement`); this is the only call the browser makes.
 *
 * Answers:
 *  - `{ ok: true }`: closed (again, when it already was);
 *  - `not_found`: this person could not have been shown it (made up, ended, another audience, not a member);
 *  - `closed`: the slot is switched off here (the server answered like an unknown operation);
 *  - `sign_in_required`, `failed` (anything else the server said), `offline` (no answer).
 * Whatever the answer, the screen hides the line it was asked to close.
 */
import { BRAND_NEWS_DISMISS_OPERATION, type BrandNewsDismissOutcome } from "@/lib/brand-news/contracts";

export type BrandNewsDismissResult = BrandNewsDismissOutcome | { ok: false; code: "closed" | "sign_in_required" | "failed" | "offline" };

export async function dismissBrandAnnouncement(
  organizationId: string,
  announcementId: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<BrandNewsDismissResult> {
  try {
    const response = await fetcher("/api/brand-workspace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ operation: BRAND_NEWS_DISMISS_OPERATION, input: { organizationId, announcementId } }),
    });
    const body = (await response.json().catch(() => null)) as { ok?: unknown; code?: unknown } | null;
    if (response.ok && body?.ok === true) return { ok: true };
    if (response.status === 404 && body?.code === "not_found") return { ok: false, code: "not_found" };
    if (response.status === 400 && body?.code === "invalid") return { ok: false, code: "closed" };
    if (response.status === 401) return { ok: false, code: "sign_in_required" };
    return { ok: false, code: "failed" };
  } catch {
    return { ok: false, code: "offline" };
  }
}
