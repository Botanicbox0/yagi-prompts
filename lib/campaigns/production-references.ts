import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';
import type { RenderStore } from '@/lib/renders/store';
import { cleanEditReferences } from '@/lib/premium-editing/guard';
import type { EditReference } from '@/lib/premium-editing/contract';
import { campaignProductionSchemaReady } from './production';

/** Studio-selected ready product images only, scoped to the template's own project. No URLs from a creator. */
export async function campaignProductReferences(sql: SqlRunner, templateId: string, ids: string[], storage?: Pick<StorageDriver, 'read'>): Promise<EditReference[]> {
  if (!ids.length) return [];
  if (!storage || ids.length > 3) throw Error('campaign_reference_unavailable');
  const rows = (await sql.query<{ id: string; storage_key: string; mime: string; size_bytes: number; sha256: string | null }>(`select a.id,a.storage_key,a.mime,a.size_bytes,a.sha256 from brand_attachments a
    join brand_production_contracts c on c.project_id=a.project_id join brand_production_templates t on t.contract_id=c.id
    where t.id=$1 and a.id=any($2::uuid[]) and a.status='ready' and a.access_scope='workspace' and a.mime in ('image/jpeg','image/png','image/webp') and a.size_bytes<=2000000`, [templateId, ids])).rows;
  if (rows.length !== ids.length) throw Error('campaign_reference_unavailable');
  const references = await Promise.all(ids.map(async id => {
    const row = rows.find(r => r.id === id)!;
    if (!row.sha256) throw Error('campaign_reference_unavailable');
    const bytes = await storage.read(STAGING_BUCKET, row.storage_key);
    if (bytes.length !== Number(row.size_bytes)) throw Error('campaign_reference_unavailable');
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw Error('campaign_reference_tampered');
    return { bytes, mime: row.mime };
  }));
  const cleaned = await cleanEditReferences(references);
  if (!cleaned.ok) throw Error('campaign_reference_unavailable');
  return cleaned.references;
}

/** Immutable per-job product copies go to the provider only; no browser sees a storage key or base recipe. */
export async function campaignRenderReferenceUrls(sql: SqlRunner, store: RenderStore, id: string): Promise<string[]> {
  if (!await campaignProductionSchemaReady(sql)) return [];
  const row = (await sql.query<{ reference_keys: string[] }>('select reference_keys from campaign_render_jobs where render_id=$1', [id])).rows[0];
  if (!row) return [];
  if (!Array.isArray(row.reference_keys) || row.reference_keys.length > 3) throw Error('campaign_reference_unavailable');
  return Promise.all(row.reference_keys.map(async (key, index) => {
    if (key !== `${id}/product${String.fromCharCode(97 + index)}.jpg`) throw Error('campaign_reference_unavailable');
    const bytes = await store.read(key);
    if (!bytes.length || bytes.length > 2_000_000) throw Error('campaign_reference_unavailable');
    return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
  }));
}
