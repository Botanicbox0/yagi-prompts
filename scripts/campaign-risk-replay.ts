/** Offline replay of the one recorded synthetic response. Does not make a model/API/DB/Slack request. */
import { readFile, writeFile } from 'node:fs/promises';
import { classifyRiskLocally } from '../lib/campaigns/risk/local-model';
import { validateModelResult } from '../lib/campaigns/risk/detector';
const path = 'docs/evidence/kapier-campaign/risk-local-model-diagnosis.json';
const recorded = JSON.parse(await readFile(path, 'utf8'));
const fake: typeof fetch = async () =>
  new Response(
    JSON.stringify({
      done: true,
      done_reason: 'stop',
      message: { content: JSON.stringify(recorded.output) },
    }),
  );
const output = await classifyRiskLocally(recorded.syntheticText, recorded.model, fake);
const evidence = {
  checkedAt: new Date().toISOString(),
  mode: 'offline_recorded_response_replay',
  sourceEvidenceFile: path,
  newModelRequests: 0,
  dbClaims: 0,
  slackSends: 0,
  output,
  sourceEvidenceValid: validateModelResult(recorded.syntheticText, output) !== null,
};
await writeFile(
  'docs/evidence/kapier-campaign/risk-local-model-replay.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.sourceEvidenceValid) process.exitCode = 1;
