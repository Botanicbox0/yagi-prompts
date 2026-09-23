import { redirectRetiredSubscriptionPage } from '../retired';

/** Retired with the $9/month subscription (audit P1-4); see ../retired.ts. */
export const dynamic = 'force-dynamic';

export default async function RetiredBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectRetiredSubscriptionPage(searchParams);
}
