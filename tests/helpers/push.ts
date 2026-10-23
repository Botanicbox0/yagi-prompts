import { createECDH, randomBytes } from 'node:crypto';

/**
 * A browser-shaped push subscription's keys, made fresh on every run: the uncompressed P-256 public
 * point (65 bytes, base64url) and the 16-byte auth secret that `PushSubscription.toJSON()` carries.
 * Never a literal — a long base64url string in the repo reads as a leaked key to the secret scan
 * (Gitleaks `generic-api-key`, .github/workflows/security.yml), and these are throwaway anyway.
 */
export function testPushKeys(): { p256dh: string; auth: string } {
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  return { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}
