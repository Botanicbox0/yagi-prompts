import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneComplete, laneFail } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import { StudioProviderError, type StudioTaskStatus } from '@/lib/brand-studio/provider/types';
import type { BlockedRewrite } from '@/lib/brand-studio/enhancer/blocked';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** docs/BRAND-STUDIO-V2.md §8.4: a run the safety review stopped gets one retry with the wording looked over. */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let rewrites: string[];
let sent: string[];
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
  rewrites = [];
  sent = [];
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const image = { kind: 'image', model: 'seedream-5-pro', prompt: 'a model with bare shoulders by a window', aspect: '3:4', resolution: '1K', count: 1, enhance: false };
const REJECTED: StudioTaskStatus = { state: 'failed', code: 'provider_rejected', detail: 'unsafe_content/moderation_blocked' };
const DONE: StudioTaskStatus = { state: 'succeeded', outputs: [{ url: 'fake://image/320x180/a', mime: 'image/png' }] };

async function create(input: Record<string, unknown> = image): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function view(id: string): Promise<StudioJobView> {
  const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
  if (!poll.ok) throw new Error(poll.code);
  return poll.jobs[0]!;
}
async function settle(id: string): Promise<StudioJobView> {
  for (let i = 0; i < 8; i++) {
    await advanceStudioJobsWith(deps, { jobIds: [id] });
    const job = await view(id);
    if (['succeeded', 'failed', 'canceled'].includes(job.status)) return job;
  }
  return view(id);
}
/** The provider answers each submitted task with the next status in `answers` (the last one repeats). */
function provider(answers: StudioTaskStatus[]) {
  let n = 0;
  const byTask = new Map<string, StudioTaskStatus>();
  deps.provider.submit = async (request) => {
    sent.push(String(request.body.prompt ?? ''));
    const taskId = `task-${n}`;
    byTask.set(taskId, answers[Math.min(n, answers.length - 1)]!);
    n += 1;
    return { taskId };
  };
  deps.provider.status = async (taskId) => byTask.get(taskId) ?? { state: 'pending' };
}
function rewriter(answer: BlockedRewrite | (() => BlockedRewrite)) {
  deps.intel.rewriteBlockedPrompt = async (input) => {
    rewrites.push(input.prompt);
    return typeof answer === 'function' ? answer() : answer;
  };
}

describe('the API lane', () => {
  it('retries once with the rewritten wording and finishes', async () => {
    provider([REJECTED, DONE]);
    rewriter({ action: 'retry', prompt: 'a model in a sleeveless top by a window', source: 'model' });
    const job = await create();
    const done = await settle(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(1);
    expect(sent).toEqual(['a model with bare shoulders by a window', 'a model in a sleeveless top by a window']);
    expect(rewrites).toEqual(['a model with bare shoulders by a window']);
    // What was actually sent is what the customer can read back.
    expect(done.finalPrompt).toBe('a model in a sleeveless top by a window');
  });

  it('tries the same words again when the rewrite is unavailable', async () => {
    provider([REJECTED, DONE]);
    rewriter({ action: 'retry', prompt: image.prompt, source: 'same' });
    const done = await settle((await create()).id);
    expect(done.status).toBe('succeeded');
    expect(sent).toEqual([image.prompt, image.prompt]);
  });

  it('fails after the second block and never tries a third time', async () => {
    provider([REJECTED, REJECTED, DONE]);
    rewriter({ action: 'retry', prompt: 'a calmer wording', source: 'model' });
    const done = await settle((await create()).id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'provider_rejected' });
    expect(sent).toHaveLength(2);
    expect(rewrites).toHaveLength(1);
    // A failed run takes nothing from the allowance.
    const poll = await pollStudioJobs(deps, owner(), f.orgId, []);
    if (!poll.ok) throw new Error(poll.code);
    expect(poll.allowance.usedKrw).toBe(0);
  });

  it('does not retry a request the review exists to stop', async () => {
    provider([REJECTED, DONE]);
    rewriter({ action: 'stop' });
    const done = await settle((await create()).id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'provider_rejected' });
    expect(sent).toHaveLength(1);
  });

  it('retries a block that arrives at submit time too', async () => {
    let n = 0;
    deps.provider.submit = async (request) => {
      sent.push(String(request.body.prompt ?? ''));
      n += 1;
      if (n === 1) throw new StudioProviderError('provider_rejected', 'unsafe_content', false);
      return { taskId: 'task-ok' };
    };
    deps.provider.status = async () => DONE;
    rewriter({ action: 'retry', prompt: 'a calmer wording', source: 'model' });
    const done = await settle((await create()).id);
    expect(done.status).toBe('succeeded');
    expect(sent).toEqual([image.prompt, 'a calmer wording']);
  });

  it('leaves a run alone when only some results were blocked', async () => {
    provider([REJECTED, DONE]);
    rewriter({ action: 'retry', prompt: 'never used', source: 'model' });
    const done = await settle((await create({ ...image, count: 2 })).id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(1);
    expect(rewrites).toHaveLength(0);
  });

  it('without a rewriter a block is final, as before', async () => {
    provider([REJECTED, DONE]);
    delete deps.intel.rewriteBlockedPrompt;
    const done = await settle((await create()).id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'provider_rejected' });
  });
});

describe('the account lane', () => {
  beforeEach(async () => {
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', { host: 'test' });
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
  });

  it('puts a blocked run back for the worker with the rewritten wording, once', async () => {
    rewriter({ action: 'retry', prompt: 'a calmer wording', source: 'model' });
    const job = await create();
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const first = await laneClaim(deps, { limit: 1 });
    if (!first.ok) throw new Error();
    expect(first.jobs[0]).toMatchObject({ jobId: job.id, prompt: image.prompt });

    expect(await laneFail(deps, { jobId: job.id, code: 'provider_rejected', detail: 'moderation' })).toMatchObject({ ok: true });
    expect((await view(job.id)).status).toBe('queued');
    const second = await laneClaim(deps, { limit: 1 });
    if (!second.ok) throw new Error();
    expect(second.jobs[0]).toMatchObject({ jobId: job.id, prompt: 'a calmer wording' });

    // A second block is final.
    expect(await laneFail(deps, { jobId: job.id, code: 'provider_rejected', detail: 'moderation' })).toMatchObject({ ok: true });
    expect(await view(job.id)).toMatchObject({ status: 'failed', errorCode: 'provider_rejected' });
    expect(rewrites).toHaveLength(1);
  });

  it('finishes when the retry passes', async () => {
    rewriter({ action: 'retry', prompt: 'a calmer wording', source: 'model' });
    const job = await create();
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    await laneClaim(deps, { limit: 1 });
    await laneFail(deps, { jobId: job.id, code: 'provider_rejected', detail: 'moderation' });
    await laneClaim(deps, { limit: 1 });
    expect(await laneComplete(deps, { jobId: job.id, outputs: [{ idx: 0, url: 'fake://image/320x180/a' }] })).toMatchObject({ ok: true });
    expect((await settle(job.id)).status).toBe('succeeded');
  });
});
