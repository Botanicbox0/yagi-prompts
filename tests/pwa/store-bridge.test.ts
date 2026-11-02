import { describe, expect, it } from 'vitest';
import {
  buildAndroidAssetLinks,
  buildAppleAppSiteAssociation,
  DEFAULT_ANDROID_PACKAGE,
  DEFAULT_APP_BUNDLE_ID,
  DEFAULT_APPLE_TEAM_ID,
  detectStorePlatform,
  PLACEHOLDER_SHA256_FINGERPRINT,
  storeCheckoutPolicy,
} from '@/lib/mobile/store-bridge';
import { GET as getAssetLinks } from '@/app/.well-known/assetlinks.json/route';
import { GET as getAppleAssociation } from '@/app/.well-known/apple-app-site-association/route';
import { adminRouteAllowed, brandRouteAllowed, bypassConsumerLocale } from '@/lib/routing/surfaces';

describe('native store domain verification & companion checkout policy', () => {
  it('builds valid Android Digital Asset Links JSON and serves /.well-known/assetlinks.json', async () => {
    const defaultLinks = buildAndroidAssetLinks({});
    expect(defaultLinks).toHaveLength(1);
    expect(defaultLinks[0]?.target.package_name).toBe(DEFAULT_ANDROID_PACKAGE);
    expect(defaultLinks[0]?.target.sha256_cert_fingerprints).toEqual([PLACEHOLDER_SHA256_FINGERPRINT]);

    const fp = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    const customLinks = buildAndroidAssetLinks({
      ANDROID_PACKAGE_NAME: 'com.yagi.twings',
      ANDROID_SHA256_CERT_FINGERPRINTS: fp,
    });
    expect(customLinks[0]?.target.package_name).toBe('com.yagi.twings');
    expect(customLinks[0]?.target.sha256_cert_fingerprints).toEqual([fp]);

    const res = getAssetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].relation).toContain('delegate_permission/common.handle_all_urls');
  });

  it('builds valid iOS Universal Links JSON and serves /.well-known/apple-app-site-association', async () => {
    const defaultAasa = buildAppleAppSiteAssociation({});
    expect(defaultAasa.applinks.details[0]?.appIDs).toEqual([
      `${DEFAULT_APPLE_TEAM_ID}.${DEFAULT_APP_BUNDLE_ID}`,
    ]);

    const customAasa = buildAppleAppSiteAssociation({
      APPLE_TEAM_ID: '9988776655',
      IOS_BUNDLE_ID: 'app.twings.ios',
    });
    expect(customAasa.applinks.details[0]?.appIDs).toEqual(['9988776655.app.twings.ios']);
    expect(customAasa.webcredentials.apps).toEqual(['9988776655.app.twings.ios']);

    const res = getAppleAssociation();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json.applinks.details[0].components.some((c: { '/': string }) => c['/'] === '/renders/*')).toBe(true);
  });

  it('bypasses consumer locale redirect on /.well-known/* and allows YAGI mark PNGs on brand/admin hosts', () => {
    expect(bypassConsumerLocale('/.well-known/assetlinks.json')).toBe(true);
    expect(bypassConsumerLocale('/.well-known/apple-app-site-association')).toBe(true);
    expect(brandRouteAllowed('/brand/yagi-mark-white.png', 'GET')).toBe(true);
    expect(brandRouteAllowed('/brand/yagi-mark-black.png', 'GET')).toBe(true);
    expect(brandRouteAllowed('/brand/yagi-mark-mask.png', 'GET')).toBe(true);
    expect(adminRouteAllowed('/brand/yagi-mark-white.png', 'GET')).toBe(true);
  });

  it('enforces Companion Studio mode inside iOS/Android store wrappers while keeping direct Toss checkout on web/PWA', () => {
    expect(detectStorePlatform({ userAgent: 'Mozilla/5.0 TwingsIOS/1.0' })).toBe('ios-store');
    expect(detectStorePlatform({ userAgent: 'Mozilla/5.0 TwingsAndroid/1.0' })).toBe('android-store');
    expect(detectStorePlatform({ standalone: true })).toBe('pwa-standalone');
    expect(detectStorePlatform({})).toBe('web');

    expect(storeCheckoutPolicy('ios-store')).toEqual({
      platform: 'ios-store',
      allowWebPgCheckout: false,
      mode: 'companion',
    });
    expect(storeCheckoutPolicy('android-store')).toEqual({
      platform: 'android-store',
      allowWebPgCheckout: false,
      mode: 'companion',
    });
    expect(storeCheckoutPolicy('pwa-standalone')).toEqual({
      platform: 'pwa-standalone',
      allowWebPgCheckout: true,
      mode: 'direct',
    });
    expect(storeCheckoutPolicy('web')).toEqual({
      platform: 'web',
      allowWebPgCheckout: true,
      mode: 'direct',
    });
  });
});
