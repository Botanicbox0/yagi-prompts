import { describe, expect, it } from 'vitest';
import { evaluateSubscriptionAvailability, workerHeartbeatFresh, SUBSCRIPTION_RELEASE_VERSION, SUBSCRIPTION_REQUIRED_STEPS, type SubscriptionReadinessInput } from '@/lib/creator-subscriptions/availability';
import { launchConfigurationDigest, subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';
import { SUBSCRIPTION_TERMS_VERSION } from '@/lib/creator-subscriptions/legal';
import { SUBSCRIPTION_PLAN_VERSION } from '@/lib/creator-subscriptions/plans';

const ready = (): SubscriptionReadinessInput => ({
  requested: 'on', environment: 'production', billingEnvironment: 'live', cipherReady: true,
  schemaReady: true, renderReady: true, workerReady: true, premiumReady: true,
  implementationSha:'b'.repeat(40),configurationDigest:launchConfigurationDigest({}),
  evidence: SUBSCRIPTION_REQUIRED_STEPS.map(step => ({ step, planVersion: SUBSCRIPTION_PLAN_VERSION, releaseVersion: SUBSCRIPTION_RELEASE_VERSION, termsVersion: SUBSCRIPTION_TERMS_VERSION, passed: true,
    implementationSha:'b'.repeat(40),configurationDigest:launchConfigurationDigest({}),evidenceDigest:step==='terms'?subscriptionTermsDigest():'a'.repeat(64) })),
});
describe('one creator subscription launch decision', () => {
  it('uses the same one-hour heartbeat boundary for public availability and the admin proof display',()=>{
    const now=Date.parse('2028-01-01T12:00:00Z');
    expect(workerHeartbeatFresh(new Date(now-3599999),now)).toBe(true);
    for(const date of [undefined,'invalid',new Date(now+1),new Date(now-3600000)]) expect(workerHeartbeatFresh(date,now)).toBe(false);
  });
  it('opens only verified live creator and premium plans', () => {
    expect(evaluateSubscriptionAvailability(ready()).status).toBe('open');
    expect(evaluateSubscriptionAvailability(ready()).plans.premium.status).toBe('open');
  });
  it.each(SUBSCRIPTION_REQUIRED_STEPS)('missing %s evidence closes enrollment', (step) => {
    const input = ready(); input.evidence = input.evidence.filter(e => e.step !== step);
    expect(evaluateSubscriptionAvailability(input).status).toBe('preparing');
  });
  it('test keys and preview credentials never open the public offer', () => {
    expect(evaluateSubscriptionAvailability({ ...ready(), billingEnvironment: 'test' }).status).toBe('preparing');
    expect(evaluateSubscriptionAvailability({ ...ready(), environment: 'preview' }).status).toBe('preparing');
  });
  it('explicit pause blocks new enrollment without erasing existing ledgers', () => {
    expect(evaluateSubscriptionAvailability({ ...ready(), requested: 'paused' }).status).toBe('paused');
  });
  it('missing editing access closes only Premium', () => {
    const value = evaluateSubscriptionAvailability({ ...ready(), premiumReady: false });
    expect(value.plans.creator.status).toBe('open');
    expect(value.plans.premium.status).toBe('preparing');
    expect(value.editing).toBe('preparing');
  });
  it('version mismatch and claimed failed proofs cannot open enrollment', () => {
    const input = ready(); input.evidence[0]!.releaseVersion = 'old';
    expect(evaluateSubscriptionAvailability(input).status).toBe('preparing');
    const failed = ready(); failed.evidence[0]!.passed = false;
    expect(evaluateSubscriptionAvailability(failed).status).toBe('preparing');
  });
});
