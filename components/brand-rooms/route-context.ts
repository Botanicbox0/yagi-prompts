/**
 * The one gate every room screen passes before it renders (docs/BRAND-ROOMS.md §9-1).
 *
 * Flag off, a sandboxed client, a brand whose policy closes generation, or no seat: the same 404.
 * A campaign-only invitee is let through here; the page must then keep them to `invitedProjectIds`
 * (the API does the same with `requireRoomProject`), so they only ever see a room they were invited to.
 */
import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope, selectedAccess } from "@/components/brand-workspace/scope";
import { featureDenied, isSandboxedClientOrganization } from "@/lib/brands/features";
import { brandRoomsOpen } from "@/lib/flags";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function roomRouteContext(organizationId: string | string[] | undefined) {
  if (!brandRoomsOpen()) notFound();
  const { sql, viewer, verifiedEmail, brandHost, locale } = await brandContext();
  if (!sql || !viewer.userId) notFound();
  const { selection, choice, projectOrganizations } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable" || !choice) notFound();
  // Sandbox first: nothing below may run for a sandboxed client.
  if (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, "generative_media")) notFound();
  const invitedProjectIds = Object.entries(projectOrganizations)
    .filter(([, org]) => org === choice.id)
    .map(([project]) => project);
  const access = selectedAccess(choice, invitedProjectIds.map(() => choice.id));
  const roomLocale: "ko" | "en" = locale === "en" ? "en" : "ko";
  return {
    deps: { sql, verifiedEmail },
    viewer,
    userId: viewer.userId,
    choice,
    access,
    /** Project ids this viewer was invited to in the selected brand (a guest is limited to these). */
    invitedProjectIds,
    locale: roomLocale,
    brandHost,
    dict: getDictionary(roomLocale),
  };
}

export type RoomRouteContext = Awaited<ReturnType<typeof roomRouteContext>>;
