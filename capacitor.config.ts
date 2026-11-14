/**
 * Root Capacitor configuration mirroring `mobile/capacitor.config.json` so native iOS (App Store)
 * and Android (Google Play) wrapper builds share the exact production origin, allowNavigation rules,
 * Sign in with Apple domain allowance, and native store User-Agent markers.
 */
const config = {
  appId: 'app.twings.client',
  appName: 'TWINGS',
  webDir: 'mobile/www',
  bundledWebRuntime: false,
  server: {
    url: 'https://twings.app/ko/video?source=pwa',
    cleartext: false,
    allowNavigation: [
      'twings.app',
      '*.twings.app',
      '*.supabase.co',
      'accounts.google.com',
      'kauth.kakao.com',
      'logins.daum.net',
      'appleid.apple.com',
    ],
  },
  ios: {
    appendUserAgent: 'TwingsIOS/1.0',
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
    preferredContentMode: 'mobile',
  },
  android: {
    appendUserAgent: 'TwingsAndroid/1.0',
    backgroundColor: '#ffffff',
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
} as const;

export default config;
