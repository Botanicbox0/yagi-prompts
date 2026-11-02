import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import type { EditPlan, EditScope, PublicEditSummary } from './contract';

export interface SubscriptionRenderRequest {
  render_ref: string; user_id: string; environment: 'test' | 'live'; request_id: string;
  fingerprint: string; base_prompt: string; runtime_seconds: number; edit_text: string | null;
  allowed_scopes: EditScope[]; reference_keys: string[];
  edit_status: 'not_requested' | 'pending' | 'preparing' | 'prepared' | 'failed';
  prepared_plan: EditPlan | null; failure_code: string | null; prepare_started_at: string | Date | null;
}
const PRIVATE_COLUMNS = 'render_ref,user_id,environment,request_id,fingerprint,base_prompt,runtime_seconds,edit_text,allowed_scopes,reference_keys,edit_status,prepared_plan,failure_code,prepare_started_at';

/** A deployment can run its legacy renderer before these optional migrations have landed. */
export async function subscriptionRenderSchemaReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(`select exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_roles service on service.rolname='service_role'
      join pg_roles anon_role on anon_role.rolname='anon'
      join pg_roles auth_role on auth_role.rolname='authenticated'
    where n.nspname='public' and c.relname='creator_subscription_renders' and c.relkind='r'
      and c.relrowsecurity and c.relforcerowsecurity and service.rolbypassrls
      and has_table_privilege(service.oid,c.oid,'SELECT') and has_table_privilege(service.oid,c.oid,'INSERT')
      and has_table_privilege(service.oid,c.oid,'UPDATE') and has_table_privilege(service.oid,c.oid,'DELETE')
      and not has_table_privilege(anon_role.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege(auth_role.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE')
      and not has_any_column_privilege(anon_role.oid,c.oid,'SELECT,INSERT,UPDATE')
      and not has_any_column_privilege(auth_role.oid,c.oid,'SELECT,INSERT,UPDATE')
      and not exists(select 1 from pg_policy policy where policy.polrelid=c.oid)
      and not exists(select 1 from unnest($1::text[]) needed(name) where not exists(
        select 1 from pg_attribute a where a.attrelid=c.oid and a.attname=needed.name and not a.attisdropped))
      and to_regclass('public.creator_subscription_usage') is not null
      and exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.creator_subscriptions') and a.attname='premium_edit_limit' and not a.attisdropped)
      and (select count(*)=2 from pg_attribute a where a.attrelid=to_regclass('public.render_jobs') and a.attname in ('provider_completion_tokens','cost_source') and not a.attisdropped)
    ) as ready`, [['render_ref','user_id','environment','request_id','fingerprint','base_prompt','runtime_seconds','edit_text','allowed_scopes','reference_keys','guide_version','edit_status','prepared_plan','prepare_token','prepare_started_at','edit_request_started_at','dispatch_attempt','dispatch_started_at','model','input_tokens','cached_input_tokens','output_tokens','references_expire_at','references_deleted_at']]);
  return rows[0]?.ready === true;
}

/** Minimal presence probe for distinguishing a legacy queue from paid subscription jobs when
 * the stronger private-schema permission probe fails. It never selects private instructions.
 */
export async function subscriptionUsageTrackingPresent(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ present: boolean }>(`select (select count(*)=2 from pg_attribute a
    where a.attrelid=to_regclass('public.creator_subscription_usage') and a.attname in ('render_ref','state') and not a.attisdropped) as present`);
  return rows[0]?.present === true;
}

export async function loadSubscriptionRender(sql: SqlRunner, renderId: string): Promise<SubscriptionRenderRequest | null> {
  const { rows } = await sql.query<SubscriptionRenderRequest>(`select ${PRIVATE_COLUMNS} from creator_subscription_renders where render_ref=$1`, [renderId]);
  return rows[0] ?? null;
}

/** A finite vocabulary is the only edit information allowed in the public owner projection. */
export async function loadOwnEditSummary(sql: SqlRunner, userId: string, renderId: string, environment: 'test' | 'live'): Promise<PublicEditSummary | null> {
  const { rows } = await sql.query<Pick<SubscriptionRenderRequest, 'edit_status' | 'prepared_plan' | 'failure_code'>>('select edit_status,prepared_plan,failure_code from creator_subscription_renders where user_id=$1 and render_ref=$2 and environment=$3', [userId, renderId, environment]);
  const row = rows[0];
  if (!row || row.edit_status === 'not_requested') return null;
  const { validateEditPlan } = await import('./guard');
  const plan = row.prepared_plan ? validateEditPlan(row.prepared_plan, ['wardrobe_color', 'prop_color', 'background_palette', 'lighting_mood']) : null;
  return { status: row.edit_status, changes: plan?.changes ?? [], errorCode: ['edit_refused', 'edit_invalid', 'edit_unavailable', 'edit_request_limit'].includes(row.failure_code ?? '') ? row.failure_code : null };
}

/** Accept only the exact server-owned optional reference slots, never identity/result keys,
 * external URLs, filenames or keys from a different render. Validate before deleting bytes.
 */
export function validatedEditReferenceKeys(renderId: string, keys: unknown): string[] | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(renderId) || !Array.isArray(keys) || keys.length > 3) return null;
  if (keys.some((key, index) => typeof key !== 'string' || key !== `${renderId}/reference${String.fromCharCode(97 + index)}.jpg`)) return null;
  return [...keys];
}

/** References are private and retained for seven days; queued jobs keep them until they settle.
 * Only stored, server-generated keys are deleted. The main identity and result objects stay put.
 */
export async function deleteExpiredEditReferences(sql: SqlRunner, store: RenderStore, now: Date): Promise<number> {
  if (!store.delete) return 0;
  const { rows } = await sql.query<{ render_ref: string; reference_keys: string[] }>(`select e.render_ref,e.reference_keys from creator_subscription_renders e join render_jobs j on j.id=e.render_ref
    where e.references_deleted_at is null and e.references_expire_at <= $1 and (j.status in ('succeeded','failed') or e.edit_status='prepared') limit 20`, [now]);
  const targets = rows.map(row => ({ ...row, keys: validatedEditReferenceKeys(row.render_ref, row.reference_keys) }));
  if (targets.some(row => row.keys === null)) throw new Error('invalid_private_reference_key');
  let deleted = 0;
  for (const row of targets) {
    for (const key of row.keys!) {
      await store.delete(key);
    }
    await sql.query('update creator_subscription_renders set reference_keys=\'[]\'::jsonb,references_deleted_at=$2 where render_ref=$1', [row.render_ref, now]);
    deleted += 1;
  }
  return deleted;
}
