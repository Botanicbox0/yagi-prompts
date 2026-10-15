import { getTossGateway, tossConfigFromEnv } from "@/lib/billing/toss-gateway";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { FundingDeps } from "./core";
export function fundingRuntime(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: env.CAMPAIGN_FUNDING_PUBLIC === "on",
    policyReady: env.CAMPAIGN_FUNDING_POLICY_READY === "on",
    production: env.VERCEL_ENV === "production",
  };
}
export function fundingDeps(sql: SqlRunner): FundingDeps | null {
  try {
    const gateway = getTossGateway();
    return gateway ? { sql, gateway, ...fundingRuntime() } : null;
  } catch {
    return null;
  }
}
export function fundingClientKey() {
  try {
    return tossConfigFromEnv()?.clientKey ?? null;
  } catch {
    return null;
  }
}
