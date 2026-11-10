import "@/app/globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { fontVariables } from "@/app/fonts";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Root layout for share links (`/s/<token>`, docs/BRAND-ROOMS.md §6): a separate root so nothing of the
 * workspace (navigation, rail, organization picker, support) is ever rendered around a shared item.
 * Never indexed, never followed, and the address (which holds the token) is never sent as a referrer.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#f6f7f9" };

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getRequestLocale());
  return {
    title: { default: dict.roomsReview.page.title, template: `%s · ${dict.meta.siteName}` },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
  };
}

export default async function ShareRootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} className={fontVariables}>
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-dynamic-subset.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
