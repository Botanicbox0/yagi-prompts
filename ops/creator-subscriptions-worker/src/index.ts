/** Prepared source only. No account identifier or secret belongs in this package. */
export const TICK_URL='https://twings.app/api/creator-subscriptions/tick';
export const REQUEST_TIMEOUT_MS=270_000;
export const CRON_WALL_BUDGET_MS=840_000;
const MAX_BATCHES=3;
interface WorkerEnv {CRON_SECRET?:string;SUBSCRIPTION_WORKER_ENABLED?:string;[key:string]:string|undefined}
type StopReason='disabled'|'misconfigured'|'complete'|'batch_limit'|'budget'|'request_failed'|'unavailable'|'invalid_response';
export interface WorkerReport {batches:number;stopped:StopReason}

async function readResult(response:Response):Promise<{ok:true;hasMore:boolean}|null> {
  if (!response.body) return null;
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try {
    for (;;) {
      const {done,value}=await reader.read();if (done) break;
      size+=value.byteLength;
      if (size>2048) {await reader.cancel();return null;}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const body=JSON.parse(new TextDecoder().decode(bytes)) as {ok?:unknown;hasMore?:unknown}|null;
    return body?.ok===true && typeof body.hasMore==='boolean' ? {ok:true,hasMore:body.hasMore} : null;
  } catch {return null;} finally {reader.releaseLock();}
}

/** No network retries: only a successful server response can authorize the next bounded batch. */
export async function runScheduledRenewals(env:WorkerEnv,options:{fetcher?:typeof fetch;now?:()=>number}={}):Promise<WorkerReport> {
  if (env.SUBSCRIPTION_WORKER_ENABLED!=='on') return {batches:0,stopped:'disabled'};
  const secret=env.CRON_SECRET?.trim();
  if (!secret) return {batches:0,stopped:'misconfigured'};
  const now=options.now ?? Date.now;const started=now();const fetcher=options.fetcher ?? fetch;
  let batches=0;
  while (batches<MAX_BATCHES) {
    if (now()-started+REQUEST_TIMEOUT_MS>CRON_WALL_BUDGET_MS) return {batches,stopped:'budget'};
    let response:Response;
    try {
      response=await fetcher(TICK_URL,{method:'POST',redirect:'error',cache:'no-store',
        headers:{Authorization:`Bearer ${secret}`,'Accept':'application/json'},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    } catch {return {batches,stopped:'request_failed'};}
    if (!response.ok) {
      try {await response.body?.cancel();} catch { /* No error body is read or logged. */ }
      return {batches,stopped:'unavailable'};
    }
    const result=await readResult(response);
    if (!result) return {batches,stopped:'invalid_response'};
    batches++;
    if (!result.hasMore) return {batches,stopped:'complete'};
  }
  return {batches,stopped:'batch_limit'};
}

export default {
  async scheduled(_controller:{cron:string;scheduledTime:number},env:WorkerEnv):Promise<void> {
    const result=await runScheduledRenewals(env);
    if (['misconfigured','request_failed','unavailable','invalid_response'].includes(result.stopped))
      throw new Error(`subscription_scheduler_${result.stopped}`);
  },
};
