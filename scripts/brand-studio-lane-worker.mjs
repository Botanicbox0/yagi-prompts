#!/usr/bin/env node
/**
 * Account-lane worker for brand studio v2 (docs/BRAND-STUDIO-V2.md §7, docs/BRAND-STUDIO-LANE-WORKER.md).
 *
 * Runs on the workstation where the `sunra` CLI is signed in. It asks the app for jobs routed to the
 * `sunra_mcp` lane, runs each one through the CLI (which spends the signed-in account's credits),
 * and reports the result files back. The app downloads and stores them; this worker keeps nothing.
 *
 * Plain Node, no dependencies, so it can run from any checkout:
 *   node scripts/brand-studio-lane-worker.mjs [--env-file <path>] [--once]
 *
 * Environment (from the process, or from --env-file; values are never printed):
 *   STUDIO_LANE_URL            app origin, e.g. https://twings.app or http://localhost:3321
 *   BRAND_STUDIO_LANE_SECRET   the same secret the app holds
 *   STUDIO_LANE_MAX            jobs this worker runs at once (default 8; the account allows 20 in total
 *                              and other tools share it)
 *   STUDIO_LANE_POLL_MS        idle poll interval (default 5000)
 *   STUDIO_LANE_PROJECT_ID     Sunra project to file generations under (default: find or create
 *                              "TWINGS Brand Studio")
 *   SUNRA_BIN                  CLI command (default "sunra")
 *
 * How a job becomes a CLI call (and how its reference videos are uploaded first) is in
 * ./brand-studio-lane-mapping.mjs, which must sit next to this file.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliRefusal, ReferenceCdnCache, createOnce, draftTaskIdOf, failureCodeOf, mimeOf, redactUrls, toolCall, withUploadedVideos } from './brand-studio-lane-mapping.mjs';

// 2: reference videos are uploaded to the account first; a run that follows its source is never a preview.
// 3 (2026-11-19): a busy reference copy is retried (createOnce), pictures already on the provider's CDN are reused,
//    every picture create carries a request_id, and GPT Image 2.6 gets its reasoning_effort.
const VERSION = '3';
const PROJECT_NAME = 'TWINGS Brand Studio';
const JOB_TIMEOUT_MS = 25 * 60 * 1000;
const args = process.argv.slice(2);
const once = args.includes('--once');
const envFileAt = args.indexOf('--env-file');

function loadEnvFile(path) {
  if (!existsSync(path)) throw new Error(`env file not found: ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (envFileAt >= 0) loadEnvFile(args[envFileAt + 1]);

const BASE = (process.env.STUDIO_LANE_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.BRAND_STUDIO_LANE_SECRET ?? '';
const MAX = Math.max(1, Math.min(20, Number(process.env.STUDIO_LANE_MAX ?? 8) || 8));
const POLL_MS = Math.max(1000, Number(process.env.STUDIO_LANE_POLL_MS ?? 5000) || 5000);
const SUNRA = process.env.SUNRA_BIN ?? 'sunra';
const WORK_DIR = join(homedir(), '.twings-studio-lane');
if (!BASE || !SECRET) {
  console.error('STUDIO_LANE_URL and BRAND_STUDIO_LANE_SECRET are required.');
  process.exit(2);
}
mkdirSync(WORK_DIR, { recursive: true });

const log = (event, detail = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...detail }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ app */

async function lane(op, body = {}) {
  const res = await fetch(`${BASE}/api/brand-studio/lane`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ op, ...body }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* a non-JSON answer is reported by status below */
  }
  if (!res.ok || !json?.ok) throw new Error(`lane ${op} -> ${res.status} ${json?.code ?? ''}`.trim());
  return json;
}

/* ------------------------------------------------------------------ CLI */

/** Run one CLI tool with its arguments on stdin (no shell quoting of customer text). */
function sunra(tool, input, { spend = false } = {}) {
  return new Promise((resolve, reject) => {
    // --no-download: the CLI would otherwise save every finished file here first, and the provider's file
    // host is slow per connection (measured 2026-11-10: a 2 MB picture held a get_job call for 50 s).
    // The app fetches the result itself, in parallel pieces.
    const argv = ['call', tool, '-', '--json', '--no-download', ...(spend ? ['--yes'] : [])];
    // The CLI is an npm shim (.cmd) on Windows, which needs a shell; every argument here is fixed text.
    const child = spawn(SUNRA, argv, { cwd: WORK_DIR, shell: process.platform === 'win32', windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      // A finished job prints the JSON and then "Saved: <file>" lines for media it downloaded.
      const text = out.split(/\r?\nSaved: /)[0].trim();
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        return reject(new Error(`sunra ${tool}: unreadable output: ${(text || err).slice(0, 300)}`));
      }
      const part = envelope?.content?.find?.((c) => c.type === 'text')?.text ?? '';
      if (envelope?.isError) return reject(new CliRefusal(part || 'refused'));
      try {
        resolve(JSON.parse(part));
      } catch {
        resolve({ text: part });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

let projectId = process.env.STUDIO_LANE_PROJECT_ID ?? null;
async function ensureProject() {
  if (projectId) return projectId;
  const listed = await sunra('list_projects', {});
  const found = (listed.projects ?? []).find((p) => p.name === PROJECT_NAME);
  projectId = found?.project_id ?? (await sunra('create_project', { name: PROJECT_NAME })).project_id;
  if (!projectId) throw new Error('could not find or create the Sunra project');
  return projectId;
}

/** Reference videos go to the account first: it takes no video from another address. */
const uploadDeps = { fetch: (url, init) => fetch(url, init), uploadSlot: (input) => sunra('get_upload_url', input) };

/** Our picture address -> the provider's CDN copy, for this process only (createOnce). */
const cdnCache = new ReferenceCdnCache();

async function waitFor(taskId) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let misses = 0;
  for (;;) {
    await sleep(5000);
    let job;
    try {
      job = await sunra('get_job', { task_id: taskId });
      misses = 0;
    } catch (error) {
      // A refusal is an answer. Anything else (the provider answering 5xx, an unreadable line) is a bad
      // moment, and the task is already paid for: keep asking instead of throwing the result away.
      // Seen in production on 2026-11-10: one "HTTP 520" from the provider failed a finished picture.
      if (error instanceof CliRefusal) throw error;
      misses += 1;
      log('poll_retry', { misses, message: redactUrls(error instanceof Error ? error.message : error).slice(0, 120) });
      if (misses >= 12 || Date.now() > deadline) throw error;
      await sleep(Math.min(30_000, 5000 * misses));
      continue;
    }
    const status = String(job.status ?? '').toUpperCase();
    if (status === 'COMPLETED') {
      const url = job.urls?.[0] ?? job.out_video ?? job.out_image;
      if (!url) throw new Error('completed without a file');
      return { url, type: job.output_type ?? null };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED' || status === 'ERROR') {
      throw new CliRefusal(String(job.error ?? job.message ?? job.failure_reason ?? status).slice(0, 500));
    }
    if (Date.now() > deadline) throw new Error('timed out waiting for the result');
  }
}

/* ----------------------------------------------------------------- jobs */

/** Map<jobId, slotCount>: tracks actual output slots so multi-image runs never exceed STUDIO_LANE_MAX. */
const running = new Map();
const activeSlots = () => {
  let total = 0;
  for (const slots of running.values()) total += slots;
  return total;
};

async function runJob(job) {
  const started = Date.now();
  try {
    const project = await ensureProject();
    // Before anything is spent: a video that cannot be uploaded fails the run with nothing charged.
    const ready = await withUploadedVideos(job, uploadDeps);
    if (ready.uploads > 0) log('references_uploaded', { jobId: job.jobId, videos: ready.uploads, bytes: ready.bytes, seconds: Math.round((Date.now() - started) / 1000) });
    const call = toolCall(ready.job, project);
    const slots = job.outputs.length ? job.outputs : [{ idx: 0 }];
    // One request identity per result slot for this run: a retried create is the same request to the provider.
    // A later claim of the same job (requeued, failed over) is a new run and gets a new one.
    const runTag = randomUUID().slice(0, 8);
    let credits = 0;
    const outputs = await Promise.all(
      slots.map(async (slot) => {
        // The job stays `running` while this waits: the lane's heartbeat comes from the claim loop, not from here,
        // and a running job is only given up after 6 h (or 30 min without heartbeats), far past three retries (~34 s).
        const created = await createOnce(
          call,
          { create: (input) => sunra(call.tool, input, { spend: true }), sleep, log, cache: cdnCache },
          { requestId: `${job.jobId}:${slot.idx}:${runTag}`, log: { jobId: job.jobId, slot: slot.idx } },
        );
        if (!created.task_id) throw new Error('create returned no task id');
        credits += Number(created.estimated_credits ?? 0) || 0;
        const done = await waitFor(created.task_id);
        // A draft id only for a run sent as a preview: a final is made from it, and the provider refuses any other.
        const draftTaskId = draftTaskIdOf(call, created);
        return { idx: slot.idx, url: done.url, mime: mimeOf(done.url, done.type), ...(draftTaskId ? { draftTaskId } : {}) };
      }),
    );
    // One account credit is priced at one US cent of list price; the app turns that into usage.
    await lane('complete', { jobId: job.jobId, outputs, costUsd: Math.round(credits) / 100 });
    log('job_done', { jobId: job.jobId, kind: job.kind, outputs: outputs.length, credits, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    // No signed address (a query string) reaches the log or the app.
    const message = redactUrls(error instanceof Error ? error.message : String(error));
    const code = failureCodeOf(error);
    log('job_failed', { jobId: job.jobId, kind: job.kind, code, message: message.slice(0, 200) });
    try {
      await lane('fail', { jobId: job.jobId, code, detail: message.slice(0, 900) });
    } catch (report) {
      log('fail_report_failed', { jobId: job.jobId, message: String(report).slice(0, 160) });
    }
  } finally {
    running.delete(job.jobId);
    // The CLI saves finished media under ./sunra; the app has its own copy by now.
    try {
      if (running.size === 0) rmSync(join(WORK_DIR, 'sunra'), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

async function tick() {
  const usedSlots = activeSlots();
  const free = MAX - usedSlots;
  const info = { version: VERSION, running: running.size, runningSlots: usedSlots, max: MAX };
  if (free <= 0) {
    await lane('heartbeat', { info });
    return 0;
  }
  const { jobs } = await lane('claim', { limit: free, info });
  for (const job of jobs ?? []) {
    const slots = Math.max(1, Array.isArray(job.outputs) ? job.outputs.length : 1);
    running.set(job.jobId, slots);
    log('job_claimed', { jobId: job.jobId, kind: job.kind, model: job.model, slots });
    void runJob(job);
  }
  return jobs?.length ?? 0;
}

log('worker_started', { base: BASE, max: MAX, pollMs: POLL_MS });
let failures = 0;
for (;;) {
  try {
    await tick();
    failures = 0;
  } catch (error) {
    failures += 1;
    log('tick_failed', { message: String(error instanceof Error ? error.message : error).slice(0, 200), failures });
  }
  if (once) {
    while (running.size > 0) await sleep(1000);
    break;
  }
  await sleep(Math.min(60_000, POLL_MS * (failures > 3 ? 6 : 1)));
}
