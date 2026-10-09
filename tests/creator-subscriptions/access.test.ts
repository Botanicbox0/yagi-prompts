import { describe, expect, it } from 'vitest';
import { subscriptionQaAllowed, mayEnrollSubscription } from '@/lib/creator-subscriptions/access';
import { PREPARING_SUBSCRIPTION_AVAILABILITY, type PublicSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';
import { ANON_VIEWER, type Viewer } from '@/lib/auth/identity';

const viewer: Viewer = { ...ANON_VIEWER, userId: '00000000-0000-4000-8000-000000000001', tier: 'free' };
const live: PublicSubscriptionAvailability = { ...PREPARING_SUBSCRIPTION_AVAILABILITY, status:'open',plans:{creator:{status:'open'},premium:{status:'preparing'}} };
describe('subscription entry is server controlled', () => {
  it('never allows an anonymous enrollment', () => {
    expect(mayEnrollSubscription(ANON_VIEWER,'creator',live,'live',{})).toBe(false);
  });
  it('allows a verified live creator offer but not an unready premium offer', () => {
    expect(mayEnrollSubscription(viewer,'creator',live,'live',{})).toBe(true);
    expect(mayEnrollSubscription(viewer,'premium',live,'live',{})).toBe(false);
  });
  it('closed test mode is limited to actual administrators with explicit QA flag', () => {
    const env={CREATOR_SUBSCRIPTION_QA:'on'};
    expect(mayEnrollSubscription(viewer,'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'test',env)).toBe(false);
    expect(mayEnrollSubscription({...viewer,isAdmin:true},'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'test',env)).toBe(true);
    expect(subscriptionQaAllowed({...viewer,isAdmin:true},{})).toBe(false);
  });
  it('an explicit pause also blocks administrator new enrollment', () => {
    const paused={...PREPARING_SUBSCRIPTION_AVAILABILITY,status:'paused' as const};
    expect(mayEnrollSubscription({...viewer,isAdmin:true},'creator',paused,'test',{CREATOR_SUBSCRIPTION_QA:'on'})).toBe(false);
  });
  it('preview test credentials cannot enroll a normal visitor despite stale open UI', () => {
    expect(mayEnrollSubscription(viewer,'creator',live,'test',{})).toBe(false);
  });
  it('live QA needs an admin, both explicit QA flags and verified current evidence',()=>{
    const admin={...viewer,isAdmin:true};const env={CREATOR_SUBSCRIPTION_QA:'on',CREATOR_SUBSCRIPTION_LIVE_QA:'on'};
    expect(mayEnrollSubscription(admin,'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'live',env,true)).toBe(true);
    expect(mayEnrollSubscription(admin,'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'live',env,false)).toBe(false);
    expect(mayEnrollSubscription(viewer,'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'live',env,true)).toBe(false);
    expect(mayEnrollSubscription(admin,'creator',PREPARING_SUBSCRIPTION_AVAILABILITY,'live',{CREATOR_SUBSCRIPTION_LIVE_QA:'on'},true)).toBe(false);
  });
});
