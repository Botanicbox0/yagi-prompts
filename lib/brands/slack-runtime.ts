import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createSlackInquirySender, slackInquiryConfigFromEnv, type SlackInquiryConfig } from './slack';
import { runBrandInquiryDeliveryPass } from './slack-delivery';

export function runLiveBrandInquiryDelivery(sql: SqlRunner, options: { inquiryId?: string; limit?: number } = {}) {
  // Even a copied enabled webhook must never send from Preview, development or local builds.
  // Pure transport tests inject a fake fetcher directly, independently of this live boundary.
  const config: SlackInquiryConfig = process.env.VERCEL_ENV === 'production'
    ? slackInquiryConfigFromEnv(process.env) : { status: 'disabled' };
  return runBrandInquiryDeliveryPass({
    sql, ...options, configuration: config.status,
    sender: config.status === 'configured' ? createSlackInquirySender({ webhookUrl: config.webhookUrl }) : null,
  });
}
