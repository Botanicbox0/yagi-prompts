/**
 * The one gate every brand-studio screen passes before it renders (docs/BRAND-STUDIO-V3.md §9-1).
 *
 * `/brand/studio` keeps its own copy of these checks because it still falls back to the legacy page;
 * every newer route (`/brand/studio/video`, `/brand/studio/review`, …) calls this and gets either a
 * context or a 404. A sandboxed client, a brand whose policy closes generative media, a campaign-only
 * invitee and a deployment with the flag off all see the same thing: no page.
 */
import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope, selectedAccess } from "@/components/brand-workspace/scope";
import { featureDenied, isSandboxedClientOrganization } from "@/lib/brands/features";
import { studioShowroomVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { brandStudioV2Open } from "@/lib/flags";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { StudioLocale } from "./copy";

export async function studioRouteOrShowroom(organizationId: string | string[] | undefined) {
  const { sql, viewer, verifiedEmail, brandHost, requestOrigin, locale } = await brandContext();
  if (!sql) notFound();
  const { selection, choice, projectOrganizations } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable" || !choice) notFound();
  // Sandbox first: nothing below may run for a sandboxed client.
  if (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, "generative_media")) notFound();
  const access = selectedAccess(choice, Object.values(projectOrganizations).filter((o) => o === choice.id));
  if (access.projectScopedOnly) notFound();
  if (!brandStudioV2Open()) notFound();
  const studioLocale: StudioLocale = locale === "en" ? "en" : "ko";
  if (studioShowroomVisible(choice, true) && !access.staff) {
    return {
      kind: "showroom" as const,
      deps: { sql, verifiedEmail },
      viewer,
      choice,
      access,
      locale: studioLocale,
      brandHost,
      requestOrigin: requestOrigin ?? null,
      dict: getDictionary(studioLocale),
    };
  }
  if (!studioV2Visible(choice, true)) notFound();
  return {
    kind: "studio" as const,
    deps: { sql, verifiedEmail },
    viewer,
    choice,
    access,
    locale: studioLocale,
    brandHost,
    requestOrigin: requestOrigin ?? null,
    dict: getDictionary(studioLocale),
  };
}

export async function studioRouteContext(organizationId: string | string[] | undefined) {
  const resolved = await studioRouteOrShowroom(organizationId);
  if (resolved.kind !== "studio") notFound();
  const { kind: _kind, ...rest } = resolved;
  return rest;
}

export type StudioRouteContext = Awaited<ReturnType<typeof studioRouteContext>>;
