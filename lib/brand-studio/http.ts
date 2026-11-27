import { NextResponse } from 'next/server';
import type { StudioErrorCode } from '@/lib/brand-studio/contracts';

/** Every studio answer is private and never cached or indexed. */
export const STUDIO_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export function studioJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: STUDIO_HEADERS });
}

/**
 * HTTP status per contract code. A closed feature, a closed studio and a missing organization are all
 * 404: the brand host never confirms what it hides.
 */
export function studioStatus(code: StudioErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
    case 'feature_unavailable':
    case 'studio_closed':
      return 404;
    case 'invalid':
      return 400;
    case 'conflict':
    case 'model_unavailable':
    case 'allowance_closed':
    case 'allowance_exhausted':
    case 'asset_limit':
    case 'storage_quota_exceeded':
      return 409;
    case 'file_too_large':
      return 413;
    case 'unsupported_file':
      return 415;
    case 'reference_missing':
    case 'reference_unreadable':
    case 'provider_rejected':
    case 'region_misaligned':
      return 422;
    case 'too_many_running':
      return 429;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}
