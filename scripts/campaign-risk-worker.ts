import { readBoundedResponse } from '../lib/campaigns/risk/transport';
/** Explicit one-shot worker. Run with `npx tsx scripts/campaign-risk-worker.ts`; schedule externally only after approval. */
import { classifyRiskLocally } from '../lib/campaigns/risk/local-model';
import { RISK_VERSION } from '../lib/campaigns/risk/detector';
import type { RiskClaim } from '../lib/campaigns/risk/worker';
async function main() {
  const origin = process.env.CAMPAIGN_RISK_API_ORIGIN;
  const secret = process.env.CAMPAIGN_RISK_WORKER_SECRET;
  const model = process.env.CAMPAIGN_RISK_OLLAMA_MODEL;
  const workerId = process.env.CAMPAIGN_RISK_WORKER_ID;
  if (!origin || !secret || secret.length < 32 || !model || !workerId)
    throw Error('worker_configuration_required');
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw Error('invalid_api_origin');
  async function api(action: string, body: unknown) {
    const r = await fetch(new URL(`/api/campaign-risk-worker/${action}`, url), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error('worker_api_unavailable');
    const raw = await readBoundedResponse(r, 200000);
    return JSON.parse(raw);
  }
  const heartbeat = await api('heartbeat', { id: workerId, version: RISK_VERSION, modelId: model });
  if (!heartbeat.ok) throw Error('worker_configuration_rejected');
  // One inference at a time protects the shared model; claim only the job we can start now.
  for (let n = 0; n < 10; n++) {
    const response = await api('claim', { limit: 1 });
    const jobs = response.jobs as RiskClaim[];
    if (!jobs.length) break;
    // A 180-second model deadline plus two 15-second API calls fits the five-minute lease.
    for (const job of jobs) {
      let result: unknown;
      try {
        result = await classifyRiskLocally(job.body, model);
      } catch {
        const failureReport = await api('complete', {
          id: job.id,
          leaseToken: job.leaseToken,
          modelId: model,
          error: 'model_unavailable',
        });
        if (!failureReport.ok) throw Error('worker_failure_not_recorded');
        // Stop the one-shot pass after an outage; do not queue more work on the shared model.
        throw Error('local_model_unavailable');
      }
      const completion = await api('complete', {
        id: job.id,
        leaseToken: job.leaseToken,
        modelId: model,
        result,
      });
      if (!completion.ok) throw Error('worker_result_rejected');
    }
    await api('heartbeat', { id: workerId, version: RISK_VERSION, modelId: model });
  }
  // Sender remains off unless independently configured by the server.
  await api('slack', {});
  console.log('campaign-risk worker pass completed');
}
main().catch(() => {
  console.error(
    'campaign-risk worker pass failed (configuration, API, or local model unavailable)',
  );
  process.exitCode = 1;
});
