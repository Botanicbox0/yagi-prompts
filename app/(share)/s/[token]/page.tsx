import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSqlRunner } from "@/lib/db/connect";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { isShareToken } from "@/lib/brand-rooms/share-contracts";
import { loadSharePage } from "@/lib/brand-rooms/shares";
import { SharedPage } from "@/components/brand-rooms/share/shared-page";

/**
 * `/s/<token>` — one shared draft or storyboard (docs/BRAND-ROOMS.md §6, §9-3). No sign-in: the token is
 * the key. An unknown, malformed, revoked or expired token, a closed brand, an item that is gone, and
 * BRAND_ROOMS off all answer the same 404. Nothing of the organization or the project is rendered beyond
 * the item's own title. Never indexed (layout metadata; the brand host also sends `X-Robots-Tag`).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isShareToken(token)) notFound();
  const sql = await getSqlRunner();
  if (!sql) notFound();
  const jar = await cookies();
  const view = await loadSharePage({ sql, media: createStudioMediaStore() }, token, { get: (name) => jar.get(name)?.value });
  if (!view) notFound();
  const locale = (await getRequestLocale()) === "en" ? "en" : "ko";
  const dict = getDictionary(locale);
  return <SharedPage token={token} view={view} locale={locale} copy={dict.roomsReview} reviewCopy={dict.studioReview} storyboardCopy={dict.roomsStoryboard} />;
}
