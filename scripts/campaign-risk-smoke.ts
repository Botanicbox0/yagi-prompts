/** Synthetic-only local adapter check. This script never imports a DB, risk queue or Slack sender. */
import { writeFile, mkdir } from 'node:fs/promises';
import { classifyRiskLocally, LOCAL_MODEL_TIMEOUT_MS } from '../lib/campaigns/risk/local-model';
import { validateModelResult, RISK_VERSION } from '../lib/campaigns/risk/detector';
async function main() {
  const model = process.env.CAMPAIGN_RISK_OLLAMA_MODEL;
  if (!model) throw Error('explicit_model_required');
  const fixtures = [
    {
      name: 'external_payment_request',
      body: 'Please transfer the money to my bank account outside this platform.',
    },
    {
      name: 'benign_budget_discussion',
      body: 'The campaign video budget is approved. Please send the storyboard image for review.',
    },
  ];
  const results: Array<Record<string, unknown>> = [];
  for (const f of fixtures) {
    const started = Date.now();
    try {
      const raw = await classifyRiskLocally(f.body, model, fetch, LOCAL_MODEL_TIMEOUT_MS);
      results.push({
        fixture: f.name,
        syntheticText: f.body,
        latencyMs: Date.now() - started,
        output: raw,
        sourceEvidenceValid: validateModelResult(f.body, raw) !== null,
      });
    } catch {
      results.push({
        fixture: f.name,
        latencyMs: Date.now() - started,
        error: 'model_unavailable_or_invalid_json',
      });
      break;
    }
  }
  const evidence = {
    checkedAt: new Date().toISOString(),
    model,
    detectorVersion: RISK_VERSION,
    adapter: 'localhost:11434/api/chat',
    syntheticOnly: true,
    dbClaims: 0,
    slackSends: 0,
    results,
  };
  await mkdir('docs/evidence/kapier-campaign', { recursive: true });
  await writeFile(
    'docs/evidence/kapier-campaign/risk-local-model-synthetic.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (results.some((r) => r.error || !r.sourceEvidenceValid)) process.exitCode = 1;
}
main().catch(() => {
  console.error('Synthetic risk check failed before inference');
  process.exitCode = 1;
});
