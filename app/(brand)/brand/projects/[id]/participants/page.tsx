import { redirect } from "next/navigation";
import { projectTabPath } from "@/lib/brands/workspace/links";
export const dynamic = "force-dynamic";
/** Absorbed into the campaign page's applicants tab (docs/PLATFORM-2.0.md §16.4); old links still land there. */
export default async function BrandParticipants({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(projectTabPath(id, "applicants"));
}
