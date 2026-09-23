import "server-only";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getSqlRunner } from "@/lib/db/connect";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function brandContext() {
  const [viewer, sql, locale] = await Promise.all([
    getViewer(),
    getSqlRunner(),
    getRequestLocale(),
  ]);
  if (!viewer.userId) redirect("/auth/choose?next=%2Fbrand");
  // Auth-server-confirmed only; the service decides whether it opens the TWINGS team view.
  const verifiedEmail = await getVerifiedEmail(viewer.userId);
  const dict = getDictionary(locale);
  return { viewer, sql, verifiedEmail, locale, dict, b: dict.brandWorkspace };
}
