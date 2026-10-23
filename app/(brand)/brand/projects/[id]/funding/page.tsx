import { redirect } from "next/navigation";
import { projectTabPath } from "@/lib/brands/workspace/links";
export const dynamic = "force-dynamic";
/**
 * Absorbed into the campaign page's payment tab (docs/PLATFORM-2.0.md §16.4). The payment provider's
 * fail URL still points here (`?failed=1`), so that one flag is carried over; nothing else is.
 */
export default async function FundingProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string | string[] }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  redirect(projectTabPath(id, "payments", search.failed ? { failed: "1" } : undefined));
}
