import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { AwsClient } from 'aws4fetch';
import {
  buildMultiBrandR2CorsXml,
  buildMultiBrandR2LifecycleXml,
} from '../lib/storage/r2-private';

/**
 * `npm run r2:configure` — idempotently applies the multi-brand CORS policy and the lifecycle document
 * (`AbortIncompleteMultipartUpload: 1 day`, nothing else) to `R2_PUBLIC_BUCKET` and (when set)
 * `R2_PRIVATE_BUCKET`, then reads the lifecycle rules back and prints their ids.
 *
 * No rule here deletes objects by age: long-lived brand files sit under `staging/` in the private bucket
 * (see `buildMultiBrandR2LifecycleXml`). Writing the lifecycle document replaces every rule on the bucket,
 * so a rule added by hand in the Cloudflare dashboard is removed by this script.
 *
 * Requires an R2 API token with `Admin Read & Write` scope (`R2_ADMIN_ACCESS_KEY_ID` /
 * `R2_ADMIN_SECRET_ACCESS_KEY`, falling back to `R2_PRIVATE_ACCESS_KEY_ID` / `R2_ACCESS_KEY_ID`).
 * Never prints secret values.
 */
loadEnv({ path: process.env.R2_ENV_FILE || '.env.local' });

function md5Base64(xml: string): string {
  return createHash('md5').update(xml, 'utf8').digest('base64');
}

async function applyBucketPolicies(r2: AwsClient, accountId: string, bucket: string): Promise<void> {
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const corsXml = buildMultiBrandR2CorsXml();
  const lifecycleXml = buildMultiBrandR2LifecycleXml();

  const corsRes = await r2.fetch(`${base}?cors`, {
    method: 'PUT',
    body: corsXml,
    headers: {
      'Content-Type': 'application/xml',
      'Content-MD5': md5Base64(corsXml),
    },
  });
  if (!corsRes.ok) {
    throw new Error(
      `[${bucket}] PutBucketCors failed (${corsRes.status}) — ensure token has R2 Admin Read & Write permission.`,
    );
  }

  const lcRes = await r2.fetch(`${base}?lifecycle`, {
    method: 'PUT',
    body: lifecycleXml,
    headers: {
      'Content-Type': 'application/xml',
      'Content-MD5': md5Base64(lifecycleXml),
    },
  });
  if (!lcRes.ok) {
    throw new Error(`[${bucket}] PutBucketLifecycleConfiguration failed (${lcRes.status})`);
  }

  // Read the rules back: what the bucket holds now, not what was sent.
  const readRes = await r2.fetch(`${base}?lifecycle`, { method: 'GET' });
  const readXml = readRes.ok ? await readRes.text() : '';
  const lifecycleRuleIds = [...readXml.matchAll(/<ID>([^<]*)<\/ID>/g)].map((m) => m[1]);
  const deletesByAge = /<Days>|<Date>/.test(readXml.replace(/<AbortIncompleteMultipartUpload>[\s\S]*?<\/AbortIncompleteMultipartUpload>/g, ''));

  console.log(
    JSON.stringify({
      bucket,
      corsApplied: true,
      lifecycleApplied: true,
      lifecycleReadBack: readRes.ok,
      lifecycleRuleIds,
      deletesByAge,
    }),
  );
  if (deletesByAge) {
    throw new Error(`[${bucket}] a lifecycle rule still deletes objects by age`);
  }
}

async function main(): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId =
    process.env.R2_ADMIN_ACCESS_KEY_ID?.trim() ||
    process.env.R2_PRIVATE_ACCESS_KEY_ID?.trim() ||
    process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    process.env.R2_ADMIN_SECRET_ACCESS_KEY?.trim() ||
    process.env.R2_PRIVATE_SECRET_ACCESS_KEY?.trim() ||
    process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2_ACCOUNT_ID or R2 credentials in environment.');
  }

  const r2 = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const publicBucket = process.env.R2_PUBLIC_BUCKET?.trim();
  const privateBucket = process.env.R2_PRIVATE_BUCKET?.trim();
  if (!publicBucket && !privateBucket) {
    throw new Error('Neither R2_PUBLIC_BUCKET nor R2_PRIVATE_BUCKET is set.');
  }

  if (publicBucket) await applyBucketPolicies(r2, accountId, publicBucket);
  if (privateBucket) await applyBucketPolicies(r2, accountId, privateBucket);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
