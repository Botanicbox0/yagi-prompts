import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "@/lib/i18n/config";
import {
  isAdminPath,
  isBrandPath,
  resolveRequestUrl,
  sameOriginMutation,
} from "@/lib/routing/surfaces";
import { safeReturnPath } from "@/lib/auth/return-path";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const url = resolveRequestUrl(new URL(request.url), request.headers),
    headers = { "Cache-Control": "private, no-store" };
  if (!url || !sameOriginMutation(url, request.headers))
    return new Response(null, { status: 403, headers });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const locale = form.get("locale");
  if (!isLocale(locale)) return new Response(null, { status: 400, headers });
  const path = safeReturnPath(form.get("next"), "/brand"),
    pathname = new URL(path, url).pathname;
  const allowed =
    url.hostname === "admin.twings.app"
      ? isAdminPath(pathname)
      : url.hostname === "brand.twings.app"
        ? isBrandPath(pathname)
        : isBrandPath(pathname) || isAdminPath(pathname);
  const destination = allowed
    ? path
    : url.hostname === "admin.twings.app"
      ? "/admin"
      : "/brand";
  const viewer = await getViewer();
  if (viewer.userId) {
    try {
      const sql = await getSqlRunner();
      await sql?.query("update profiles set locale=$2 where id=$1", [
        viewer.userId,
        locale,
      ]);
    } catch {
      /* Cookie preference still works when the profile store is unavailable. */
    }
  }
  const response = NextResponse.redirect(new URL(destination, url), {
    status: 303,
    headers,
  });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    secure: url.protocol === "https:",
  });
  return response;
}
