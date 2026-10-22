import { isEmbeddedWebView } from '@/lib/auth/webview';

/**
 * Which "add to home screen" path this browser has (docs/PLATFORM-2.0.md §5.2): Safari on iOS
 * through the share sheet, Android through Chrome's saved `beforeinstallprompt`. Everything else —
 * desktop, other iOS browsers, in-app WebViews (KakaoTalk, Instagram…) — gets no install card.
 */

export type InstallPlatform = 'ios-safari' | 'android' | 'other';

export interface PlatformNavigator {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** iPhone, iPod, iPad — including iPadOS, which reports itself as a Mac with a touch screen. */
export function isIosDevice(nav: PlatformNavigator): boolean {
  return /iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

export function installPlatform(nav: PlatformNavigator): InstallPlatform {
  const ua = nav.userAgent;
  if (isEmbeddedWebView(ua)) return 'other';
  if (isIosDevice(nav)) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua) ? 'other' : 'ios-safari';
  return /Android/i.test(ua) ? 'android' : 'other';
}
