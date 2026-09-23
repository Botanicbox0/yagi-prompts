import { brandContext } from "@/components/brand-workspace/context";
import { UsageReturn } from "@/components/brand-workspace/usage-return";

/** Where the payment provider returns a secondary-usage payment. Confirms once, then leaves. */
export const dynamic = "force-dynamic";
export default async function UsageReturnPage() {
  const { b } = await brandContext();
  return <UsageReturn copy={b.secondaryUsage.payment} />;
}
