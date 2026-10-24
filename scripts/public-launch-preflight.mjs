#!/usr/bin/env node
/**
 * TWINGS Public Launch & Store Submission Preflight Check
 * (`node scripts/public-launch-preflight.mjs`)
 *
 * Rule (AGENTS.md §0): NEVER print secret values. Output boolean/kind status only.
 */

const env = process.env;

function classifyTossKey(raw, prefixType) {
  const val = (raw ?? '').trim();
  if (!val) return 'missing';
  if (val.includes('_docs_')) return 'docs_example';
  if (val.startsWith(`live_${prefixType}_`)) return 'live';
  if (val.startsWith(`test_${prefixType}_`)) return 'test';
  return 'unrecognized';
}

const clientKeyKind = classifyTossKey(env.TOSS_CLIENT_KEY, 'gck');
const secretKeyKind = classifyTossKey(env.TOSS_SECRET_KEY, 'gsk');
const renderMode = (env.RENDER_PIPELINE_PUBLIC ?? 'off').trim().toLowerCase();

const checks = {
  publicSales: {
    RENDER_PIPELINE_PUBLIC: renderMode,
    TOSS_CLIENT_KEY_KIND: clientKeyKind,
    TOSS_SECRET_KEY_KIND: secretKeyKind,
    readyForPublicOn: clientKeyKind === 'live' && secretKeyKind === 'live',
    safeInCurrentReviewMode:
      renderMode === 'review' && (clientKeyKind === 'test' || clientKeyKind === 'docs_example'),
  },
  webPush: {
    WEB_PUSH_PUBLIC_KEY: Boolean(env.WEB_PUSH_PUBLIC_KEY?.trim()),
    WEB_PUSH_PRIVATE_KEY: Boolean(env.WEB_PUSH_PRIVATE_KEY?.trim()),
    WEB_PUSH_SUBJECT: Boolean(env.WEB_PUSH_SUBJECT?.trim()),
  },
  storeVerification: {
    APPLE_TEAM_ID: Boolean(env.APPLE_TEAM_ID?.trim()),
    IOS_BUNDLE_ID: env.IOS_BUNDLE_ID?.trim() || 'app.twings.client (default)',
    ANDROID_PACKAGE_NAME: env.ANDROID_PACKAGE_NAME?.trim() || 'app.twings.client (default)',
    ANDROID_SHA256_CERT_FINGERPRINTS: Boolean(env.ANDROID_SHA256_CERT_FINGERPRINTS?.trim()),
  },
};

console.log(JSON.stringify(checks, null, 2));
