import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { makeSingleConnectionRunner } from '@/lib/db/sql-runner';
import { billingConfigFromEnv } from '@/lib/creator-subscriptions/gateway';
import { createBillingKeyCipher } from '@/lib/creator-subscriptions/crypto';
import { getCreatorSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';
import { currentImplementationSha, launchConfigurationDigest, premiumConfigurationDigest, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';
import { premiumEditConfigFromEnv } from '@/lib/premium-editing/provider';
import { configuredPremiumEditLimit } from '@/lib/premium-editing/budget';

/** Read-only deployment preflight: no payment, model, storage, evidence or environment mutation. */
loadEnv({ path: ['.env.local', '.env'], quiet: true });
const present = (name: string) => Boolean(process.env[name]?.trim());
let billing: 'test' | 'live' | null = null; let cipher = false;
try { billing = billingConfigFromEnv()?.kind ?? null; } catch { /* invalid is a failed check */ }
try { createBillingKeyCipher(process.env.TOSS_BILLING_ENCRYPTION_KEY ?? ''); cipher = true; } catch { /* no key output */ }
const report = {
  readOnly: true,
  deployment: { production: process.env.VERCEL_ENV === 'production', implementationSha: currentImplementationSha() },
  credentials: { database: present('DATABASE_URL'), billingConfigured: billing !== null, billingLive: billing === 'live', cipher,
    renderApi: present('ARK_API_KEY'), identityApi: present('ARK_ACCESS_KEY') && present('ARK_SECRET_KEY'),
    cron: present('CRON_SECRET'), openai: Boolean(premiumEditConfigFromEnv()) },
  publicConfiguration: { requested: process.env.CREATOR_SUBSCRIPTION_PUBLIC ?? 'off', premiumEnabled: process.env.PREMIUM_EDITING_ENABLED === 'on',
    premiumEditRequestsPerPeriod: configuredPremiumEditLimit(), termsDigest: subscriptionTermsDigest(),
    configurationDigest: launchConfigurationDigest(), premiumConfigurationDigest: premiumConfigurationDigest() },
  databaseChecked: false,
  availability: await getCreatorSubscriptionAvailability(null),
};
if (present('DATABASE_URL')) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 10_000,
    connectionTimeoutMillis: 10_000, options: '-c default_transaction_read_only=on' });
  try {
    await client.connect();
    const sql = makeSingleConnectionRunner(async <T>(text: string, params: unknown[] = []) => {
      const response = await client.query(text, params); return { rows: response.rows as T[] };
    });
    report.availability = await getCreatorSubscriptionAvailability(sql); report.databaseChecked = true;
  } catch { /* Never echo a connection URI, SQL parameter, secret or remote error. */ }
  finally { await client.end().catch(() => undefined); }
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.databaseChecked && report.availability.plans.creator.status === 'open' ? 0 : 2;
