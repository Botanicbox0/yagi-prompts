import { NextResponse } from 'next/server';
import { SUBSCRIPTION_HEADERS } from './runtime';

export const MAX_SUBSCRIPTION_JSON_BYTES = 4096;
export const MAX_SUBSCRIPTION_FORM_BYTES = 4_000_000;
export function subscriptionJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SUBSCRIPTION_HEADERS });
}
export function subscriptionFailure(code: string) {
  const status = code === 'sign_in_required' ? 401 : code === 'not_found' ? 404 :
    ['not_open','forbidden','subscription_required','premium_required','store_companion'].includes(code) ? 403 :
    ['unavailable'].includes(code) ? 503 : code === 'rate_limited' ? 429 :
    code.endsWith('_pending') ? 202 : ['usage_exhausted','subscription_exists','conflict','already_processed'].includes(code) ? 409 : 400;
  return subscriptionJson({ok:false,code},status);
}
/** Bound actual bytes, not just a forgeable Content-Length header. */
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const body = new Uint8Array(size); let offset=0;
    for (const part of parts) {body.set(part,offset); offset+=part.byteLength;}
    return body;
  } finally { reader.releaseLock(); }
}
export async function readSubscriptionJson(request: Request): Promise<Record<string,unknown> | null> {
  try {
    const bytes = await readBoundedBody(request,MAX_SUBSCRIPTION_JSON_BYTES);
    if (!bytes) return null;
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null;
  } catch { return null; }
}
