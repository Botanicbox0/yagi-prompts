import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { privateStorageR2Config } from '../lib/runtime-mode';
import { STAGING_BUCKET } from '../lib/storage';
import { createR2PrivateStorageDriver } from '../lib/storage/r2-private';
import { createSupabaseStorageDriver } from '../lib/storage/supabase-driver';

/**
 * `npm run r2:migrate-private` — copies remaining private `content` objects (e.g. brand attachments)
 * from Supabase Storage into `R2_PRIVATE_BUCKET` (`twings-private-apac`) and verifies SHA-256 byte-for-byte.
 * Does NOT delete Supabase originals unless `--delete-verified` is explicitly passed after founder approval.
 */
loadEnv({ path: process.env.R2_ENV_FILE || '.env.local' });

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function listAllSupabaseKeys(
  supabase: { storage: SupabaseClient['storage'] },
  bucket: string,
  prefix = '',
): Promise<string[]> {
  const keys: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 200,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list failed (${prefix}): ${error.message}`);
    for (const item of data) {
      if (item.name === '.emptyFolderPlaceholder') continue;
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        keys.push(...(await listAllSupabaseKeys(supabase, bucket, full)));
      } else {
        keys.push(full);
      }
    }
    if (data.length < 200) break;
  }
  return keys;
}

async function main(): Promise<void> {
  const r2Cfg = privateStorageR2Config({ ...process.env, PLAYBOOK_MODE: 'cloud', STORAGE_DRIVER: 'r2' });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!r2Cfg || !supabaseUrl || !serviceKey) {
    throw new Error('Requires R2_PRIVATE_BUCKET + R2 credentials + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  }

  const deleteVerified = process.argv.includes('--delete-verified');
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const source = createSupabaseStorageDriver();
  const dest = createR2PrivateStorageDriver(r2Cfg);

  const keys = await listAllSupabaseKeys(supabase, STAGING_BUCKET);
  let copied = 0;
  let alreadyThere = 0;
  let removed = 0;

  for (const key of keys) {
    const srcBytes = await source.read(STAGING_BUCKET, key);
    if (await dest.exists(STAGING_BUCKET, key)) {
      alreadyThere += 1;
    } else {
      await dest.putStaging(key, srcBytes, 'application/octet-stream');
      copied += 1;
    }
    const dstBytes = await dest.read(STAGING_BUCKET, key);
    if (sha256(srcBytes) !== sha256(dstBytes)) {
      throw new Error(`SHA-256 mismatch after copying ${key}`);
    }
    if (deleteVerified) {
      await source.releaseStaging?.(key);
      removed += 1;
    }
  }

  console.log(JSON.stringify({ totalScanned: keys.length, copied, alreadyThere, removed, deleteVerified }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
