import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getSqlRunner } from "@/lib/db/connect";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { requestSurface } from "@/lib/routing/request-surface";

/** Deduplicated per server render so layout and page share one viewer/session/DB lookup. */
export const brandContext = cache(async () => {
  const [viewer, sql, locale, surface] = await Promise.all([
    getViewer(),
    getSqlRunner(),
    getRequestLocale(),
    requestSurface(),
  ]);
  if (!viewer.userId) redirect("/auth/choose?next=%2Fbrand%2Fstart");
  // Auth-server-confirmed only; the service decides whether it opens the TWINGS team view.
  const verifiedEmail = await getVerifiedEmail(viewer.userId);
  const dict = getDictionary(locale);
  return {
    viewer,
    sql,
    verifiedEmail,
    brandHost: surface.brand,
    requestOrigin: surface.origin,
    locale,
    dict,
    b: dict.brandWorkspace,
  };
});

