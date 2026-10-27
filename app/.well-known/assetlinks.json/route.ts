import { NextResponse } from 'next/server';
import { buildAndroidAssetLinks } from '@/lib/mobile/store-bridge';

/**
 * `GET /.well-known/assetlinks.json`
 * Required by Google Play Trusted Web Activity (TWA / Bubblewrap) and Android App Links
 * to verify ownership of `https://twings.app` and hide the Chrome URL bar in the Play Store app.
 */
export function GET() {
  return NextResponse.json(buildAndroidAssetLinks(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
