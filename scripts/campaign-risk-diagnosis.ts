/** One additional synthetic-only bounded diagnosis; no DB/queue/Slack imports or calls. */
import { writeFile } from 'node:fs/promises';
import { classifyRiskLocally, type LocalModelMetrics } from '../lib/campaigns/risk/local-model';
import { validateModelResult, RISK_VERSION } from '../lib/campaigns/risk/detector';
const model = process.env.CAMPAIGN_RISK_OLLAMA_MODEL;
if (model !== 'qwen3.8:27b-q4_K_M') throw Error('explicit_existing_model_required');
const body = 'Please transfer the money to my bank account outside this platform.';
let metrics: LocalModelMetrics | undefined;
const start = Date.now();
const record: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  model,
  detectorVersion: RISK_VERSION,
  syntheticOnly: true,
  syntheticText: body,
  request: { think: false, timeoutMs: 180000, stream: false, temperature: 0, numPredict: 700 },
  dbClaims: 0,
  slackSends: 0,
  showMetadata: { supportedThinking: [false, 'low', 'medium', 'xhigh'], defaultThinking: 'medium' },
  officialDocs: [
    'https://docs.ollama.com/capabilities/thinking',
    'https://docs.ollama.com/api/chat',
  ],
};
try {
  const output = await classifyRiskLocally(body, model, fetch, 180000, (m) => {
    metrics = m;
  });
  Object.assign(record, {
    latencyMs: Date.now() - start,
    output,
    sourceEvidenceValid: validateModelResult(body, output) !== null,
    metrics,
  });
} catch {
  Object.assign(record, {
    latencyMs: Date.now() - start,
    error: 'model_unavailable_or_invalid_json',
    metrics,
  });
}
await writeFile(
  'docs/evidence/kapier-campaign/risk-local-model-diagnosis.json',
  JSON.stringify(record, null, 2) + '\n',
);
console.log(JSON.stringify(record, null, 2));
if (record.error || !record.sourceEvidenceValid) process.exitCode = 1;
