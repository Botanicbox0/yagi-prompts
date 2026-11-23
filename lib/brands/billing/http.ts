import { NextResponse } from 'next/server';
import type { BrandBillingFailureCode } from './types';

export const BILLING_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export function billingJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: BILLING_HEADERS });
}

export function billingStatus(code: BrandBillingFailureCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid':
    case 'code_unavailable':
      return 400;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'unavailable':
      return 503;
    default:
      return 500;
  }
}
