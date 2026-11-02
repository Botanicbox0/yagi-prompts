import { NextResponse } from 'next/server';
import { buildAppleAppSiteAssociation } from '@/lib/mobile/store-bridge';

/**
 * `GET /.well-known/apple-app-site-association`
 * Required by iOS App Store Universal Links (`applinks`) and Shared Web Credentials (`webcredentials`).
 * Apple's CDN fetches this path directly over HTTPS without redirects.
 */
export function GET() {
  return NextResponse.json(buildAppleAppSiteAssociation(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
