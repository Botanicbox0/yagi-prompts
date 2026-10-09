import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { RenderFailure } from '@/lib/renders/engines';
import type { SubscriptionRenderRequest } from './repo';
import { applyEditPlan, validateEditPlan } from './guard';
import { createPremiumEditClient, PremiumEditFailure, premiumEditConfigFromEnv, type PremiumEditClient } from './provider';
import { claimPremiumEditRequest } from './budget';

/** A prepared plan survives all rendering retries. A paid interpretation is attempted once.
 * If a worker dies after dispatch but before saving its answer, mark it uncertain/failed after
 * its lease expires; never repeat an ambiguous paid request automatically.
 */
export async function prepareSubscriptionPrompt(sql: SqlRunner, store: RenderStore, request: SubscriptionRenderRequest, now: Date, editor?: PremiumEditClient | null): Promise<{ promptText: string; seconds: number }> {
  const ready = (plan: unknown) => {
    const verified = validateEditPlan(plan, request.allowed_scopes);
    if (!verified?.approved) throw new RenderFailure('edit_invalid', 'edit_invalid', false);
    return { promptText: applyEditPlan(request.base_prompt, verified), seconds: request.runtime_seconds };
  };
  if (request.edit_status === 'not_requested') return { promptText: request.base_prompt, seconds: request.runtime_seconds };
  if (request.edit_status === 'prepared') return ready(request.prepared_plan);
  if (request.edit_status === 'failed') {
    const code = request.failure_code === 'edit_invalid' || request.failure_code === 'edit_unavailable' || request.failure_code === 'edit_request_limit' ? request.failure_code : 'edit_refused';
    throw new RenderFailure(code, code, false);
  }
  if (request.edit_status === 'preparing') {
    const since = new Date(request.prepare_started_at ?? 0).getTime();
    if (now.getTime() - since <= 20 * 60 * 1000) throw new RenderFailure('edit_in_progress', 'edit_in_progress', true);
    await sql.query("update creator_subscription_renders set edit_status='failed',failure_code='edit_unavailable' where render_ref=$1 and edit_status='preparing'", [request.render_ref]);
    throw new RenderFailure('edit_unavailable', 'edit_unavailable', false);
  }
  const token = randomUUID();
  const claim = await sql.query<{ render_ref: string }>("update creator_subscription_renders set edit_status='preparing',prepare_token=$2,prepare_started_at=$3 where render_ref=$1 and edit_status='pending' returning render_ref", [request.render_ref, token, now]);
  if (!claim.rows.length) throw new RenderFailure('edit_in_progress', 'edit_in_progress', true);
  try {
    const config = editor === undefined ? premiumEditConfigFromEnv() : null;
    const client = editor === undefined ? config && createPremiumEditClient(config) : editor;
    if (!client) throw new PremiumEditFailure('edit_unavailable');
    const references = [];
    for (const [index, key] of request.reference_keys.entries()) {
      if (index > 2 || key !== `${request.render_ref}/reference${String.fromCharCode(97 + index)}.jpg`) throw new PremiumEditFailure('edit_invalid');
      references.push({ bytes: await store.read(key), mime: 'image/jpeg' as const });
    }
    const attempt = await claimPremiumEditRequest(sql, { renderId: request.render_ref, userId: request.user_id, environment: request.environment, prepareToken: token, now });
    if (!attempt.ok) throw new RenderFailure(attempt.code, attempt.code, attempt.code === 'edit_in_progress');
    const prepared = await client.prepare({ renderId: request.render_ref, requestText: request.edit_text!, allowedScopes: request.allowed_scopes, references });
    // The injectable seam receives the same validation as the production adapter.
    const verified = validateEditPlan(prepared.plan, request.allowed_scopes);
    if (!verified?.approved) throw new PremiumEditFailure('edit_invalid');
    const saved = await sql.query<{ render_ref: string }>(`update creator_subscription_renders set edit_status='prepared',prepared_plan=$3::jsonb,model=$4,input_tokens=$5,cached_input_tokens=$6,output_tokens=$7,prepared_at=$8
      where render_ref=$1 and prepare_token=$2 and edit_status='preparing' returning render_ref`, [request.render_ref, token, JSON.stringify(verified), prepared.model, prepared.usage.inputTokens, prepared.usage.cachedInputTokens, prepared.usage.outputTokens, now]);
    if (!saved.rows.length) throw new PremiumEditFailure('edit_unavailable');
    return ready(verified);
  } catch (error) {
    const code = error instanceof PremiumEditFailure || error instanceof RenderFailure ? error.code : 'edit_unavailable';
    const telemetry = error instanceof PremiumEditFailure ? error.telemetry : null;
    await sql.query("update creator_subscription_renders set edit_status='failed',failure_code=$3,model=$4,input_tokens=$5,cached_input_tokens=$6,output_tokens=$7 where render_ref=$1 and prepare_token=$2 and edit_status='preparing'", [request.render_ref, token, code, telemetry?.model ?? null, telemetry?.usage.inputTokens ?? 0, telemetry?.usage.cachedInputTokens ?? 0, telemetry?.usage.outputTokens ?? 0]);
    throw new RenderFailure(code, code, false);
  }
}
