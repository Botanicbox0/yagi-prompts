import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAdminRenderBoard, loadAdminUserView } from '@/lib/admin/renders-users';
import { loadApplicationById } from '@/lib/campaigns/repo';
import { stagePromptUpload } from '@/lib/prompts/media';
import { runner } from '../helpers/pglite';
import { seedProfile } from '../helpers/billing';
import { adminHarness, ADMIN_VIEWER, expectOk, upload, type AdminHarness } from '../helpers/admin';

describe('admin 6 end-to-end operator scenarios', () => {
  let harness: AdminHarness;
  const prevFakeBilling = process.env.PLAYBOOK_FAKE_BILLING;

  beforeEach(async () => {
    process.env.PLAYBOOK_FAKE_BILLING = '1';
    harness = await adminHarness();
  });

  afterEach(async () => {
    if (prevFakeBilling === undefined) {
      delete process.env.PLAYBOOK_FAKE_BILLING;
    } else {
      process.env.PLAYBOOK_FAKE_BILLING = prevFakeBilling;
    }
    await harness.close();
  });

  it('executes manual payment reconciliation, failed render retry (blocking safety rejection), template moderation, post verification + payout, brand inquiry triage, and creator/SNS verification end-to-end', async () => {
    const sql = runner(harness.db);
    await seedProfile(sql, {
      id: ADMIN_VIEWER.userId!,
      email: ADMIN_VIEWER.email!,
      isAdmin: true,
    });

    const customerId = randomUUID();
    const creatorId = randomUUID();
    await seedProfile(sql, { id: customerId, email: 'customer@example.test' });
    await seedProfile(sql, { id: creatorId, email: 'creator@example.test' });

    // Scenario 3: Seed a pending template and approve it
    const promptId = randomUUID();
    const stagedPoster = await stagePromptUpload(harness.storage, promptId, 'poster', upload('poster.png', 'POSTER-PNG'));
    expect(stagedPoster.ok).toBe(true);
    if (!stagedPoster.ok) throw new Error('failed to stage prompt media');

    await sql.query(
      `insert into prompt_items (
        id, slug, title, title_ko, prompt_text, source, status, text_visibility, models, medium, price_cents, price_krw, media
      ) values ($1, $2, $3, $4, $5, 'community', 'pending', 'public', ARRAY['Nano Banana'], 'image', 200, 2900, $6::jsonb)`,
      [
        promptId,
        'fixture-pending-template',
        'Fixture Pending Template',
        '픽스처 검수 대기 템플릿',
        'portrait lighting studio prompt',
        JSON.stringify({
          poster: stagedPoster.value.ref,
        }),
      ],
    );

    expectOk(
      await harness.run('prompt.approve', {
        id: promptId,
        slug: 'fixture-approved-template',
        handle: 'fixture.maker',
        useCase: ['brand-ad'],
      }),
    );
    const promptCheck = await sql.query<{ status: string; slug: string }>(
      `select status, slug from prompt_items where id = $1`,
      [promptId],
    );
    expect(promptCheck.rows[0]).toEqual({
      status: 'published',
      slug: 'fixture-approved-template',
    });

    // Scenario 1 & 2: Manual Toss payment + Failed renders (retryable vs safety-rejected) + Succeeded render notification
    const orderManualId = randomUUID();
    const renderRef = randomUUID();
    await sql.query(
      `insert into billing_payments (
        id, user_id, environment, amount_krw, status, payment_type, payment_key, approved_at, consent_at,
        template_id, template_slug, order_name, aspect, locale, render_ref, input_key, input_mime,
        expires_at, failure_code, consent_version
      ) values (
        $1, $2, 'fake', 2900, 'refund_pending', 'NORMAL', 'tgen_fixture_key_001', now(), now(),
        $3, 'fixture-approved-template', 'Fixture Order', '4:5', 'ko', $4, $5, 'image/jpeg',
        now() + interval '1 hour', 'refund_manual', 'refund-2026-09-14-section-2'
      )`,
      [orderManualId, customerId, promptId, renderRef, `${renderRef}/input.jpg`],
    );

    const retryableJobId = randomUUID();
    const safetyJobId = randomUUID();
    const succeededJobId = randomUUID();

    await sql.query(
      `insert into render_jobs (
        id, user_id, template_id, template_slug, medium, engine, aspect, locale,
        status, input_key, input_mime, result_key, result_mime, result_bytes,
        share_token, share_expires_at,
        error_code, error_message, attempts, cost_usd, finished_at
      ) values
        ($1, $2, $3, 'fixture-approved-template', 'image', 'nano-banana', '4:5', 'ko',
         'failed', 'renders/inputs/retry.jpg', 'image/jpeg', null, null, null,
         null, null,
         'provider_timeout', 'upstream timed out', 3, 0.12, now()),
        ($4, $2, $3, 'fixture-approved-template', 'image', 'nano-banana', '4:5', 'ko',
         'failed', 'renders/inputs/safety.jpg', 'image/jpeg', null, null, null,
         null, null,
         'content_policy_violation', 'face safety check rejected', 1, 0, now()),
        ($5, $2, $3, 'fixture-approved-template', 'image', 'nano-banana', '4:5', 'ko',
         'succeeded', 'renders/inputs/done.jpg', 'image/jpeg', 'renders/results/done.png', 'image/png', 1024,
         'share_token_fixture_001', now() + interval '7 days',
         null, null, 1, 0.08, now())`,
      [retryableJobId, customerId, promptId, safetyJobId, succeededJobId],
    );

    const boardBefore = await loadAdminRenderBoard(sql);
    expect(boardBefore.summary.paymentsManual).toBe(1);
    expect(boardBefore.summary.failed).toBe(2);
    expect(boardBefore.jobs.find((j) => j.id === retryableJobId)?.retryable).toBe(true);
    expect(boardBefore.jobs.find((j) => j.id === safetyJobId)?.retryable).toBe(false);

    // Scenario 1: Reconcile manual payments
    expectOk(await harness.run('payment.reconcile', {}));

    // Scenario 2a: Retry provider_timeout render -> queued
    expectOk(
      await harness.run('render.retry', {
        id: retryableJobId,
        reason: 'Provider timeout resolved, retrying render',
        _confirm: 'true',
      }),
    );
    const retriedCheck = await sql.query<{ status: string }>(
      `select status from render_jobs where id = $1`,
      [retryableJobId],
    );
    expect(retriedCheck.rows[0]?.status).toBe('queued');

    // Scenario 2b: Safety-rejected render must be refused by render.retry
    const safetyAttempt = await harness.run('render.retry', {
      id: safetyJobId,
      reason: 'Attempt retry on safety refusal',
      _confirm: 'true',
    });
    expect(safetyAttempt.ok).toBe(false);

    // Scenario 2c: Resend completion notification on succeeded render
    expectOk(await harness.run('render.resendNotification', { id: succeededJobId }));

    // Scenario 4: Campaign post verification & payout settlement
    const campaignId = randomUUID();
    const appId = randomUUID();
    await sql.query(
      `insert into campaigns (
        id, slug, status, title, summary, host_name, host_kind, platforms, deliverable,
        slots, applications_close_at, post_deadline_at, published_at, payout, requirements
      ) values (
        $1, 'fixture-e2e-campaign', 'running',
        '{"en":"Fixture Campaign","ko":"픽스처 캠페인"}'::jsonb,
        '{"en":"Summary EN","ko":"요약 KO"}'::jsonb,
        'Fixture Brand', 'brand', ARRAY['instagram'], 'reel', 5,
        now() - interval '2 days', now() + interval '5 days', now(),
        '{"model":"flat","flatCents":50000,"perThousandViewsCents":0,"minCents":0,"maxCents":null,"currency":"KRW","holdDays":0}'::jsonb,
        '{"hashtags":["#twings"],"disclosure":true}'::jsonb
      )`,
      [campaignId],
    );
    await sql.query(
      `insert into campaign_applications (
        id, campaign_id, creator_id, status, pitch, sns_url, follower_count,
        selected_at, post_url, post_platform, posted_at, views_snapshot
      ) values (
        $1, $2, $3, 'posted', 'Ready to post', 'https://www.instagram.com/fixture.creator', 18000,
        now() - interval '2 days', 'https://www.instagram.com/reel/Cfixture123/', 'instagram', now() - interval '1 day', 24000
      )`,
      [appId, campaignId, creatorId],
    );

    const postedApp = await loadApplicationById(sql, appId);
    expect(postedApp).not.toBeNull();
    expectOk(await harness.run('campaignApplication.verify', { id: appId, version: postedApp!.version }));
    await sql.query(`update campaign_applications set hold_until = now() - interval '1 hour' where id = $1`, [appId]);
    const verifiedApp = await loadApplicationById(sql, appId);
    expectOk(
      await harness.run('campaignApplication.pay', {
        id: appId,
        version: verifiedApp!.version,
        payoutRef: 'TRANSFER-20261031-01',
      }),
    );
    const appCheck = await sql.query<{ status: string; payout_cents: number; payout_ref: string }>(
      `select status, payout_cents::int as payout_cents, payout_ref from campaign_applications where id = $1`,
      [appId],
    );
    expect(appCheck.rows[0]).toEqual({
      status: 'paid',
      payout_cents: 50000,
      payout_ref: 'TRANSFER-20261031-01',
    });

    // Scenario 5: Brand inquiry triage (new -> contacted -> closed)
    const inquiryId = randomUUID();
    await sql.query(
      `insert into brand_inquiries (
        id, company, contact_name, email, budget_band, message, locale, consent_at, status
      ) values ($1, 'Fixture Beauty', 'Kim Manager', 'kim@fixture.test', '3m_10m', 'Need 20 creator reels', 'ko', now(), 'new')`,
      [inquiryId],
    );
    expectOk(await harness.run('brandInquiry.status', { id: inquiryId, status: 'contacted' }));
    expectOk(await harness.run('brandInquiry.status', { id: inquiryId, status: 'closed' }));
    const inqCheck = await sql.query<{ status: string; contacted_at: string | null }>(
      `select status, contacted_at::text from brand_inquiries where id = $1`,
      [inquiryId],
    );
    expect(inqCheck.rows[0]?.status).toBe('closed');
    expect(inqCheck.rows[0]?.contacted_at).toBeTruthy();

    // Scenario 6: Creator application & SNS follower verification
    const creatorAppId = randomUUID();
    await sql.query(
      `insert into platform_creator_applications (
        id, user_id, display_name, portfolio_url, sample_urls, mediums, tools, message
      ) values (
        $1, $2, 'Fixture Maker', 'https://example.com/portfolio',
        ARRAY['https://www.instagram.com/reel/Cfixture123/'], ARRAY['video'], 'Seedance 2.0', 'Experienced AI director'
      )`,
      [creatorAppId, creatorId],
    );
    expectOk(
      await harness.run('platform.manage', {
        action: 'application',
        id: creatorAppId,
        decision: 'approve',
        contract: 'v1.0',
        note: 'Portfolio verified',
        reason: 'Approved after studio portfolio check',
      }),
    );

    const socialId = randomUUID();
    await sql.query(
      `insert into social_accounts (
        id, user_id, platform, handle, profile_url, claimed_count, status
      ) values ($1, $2, 'instagram', 'fixture.creator', 'https://www.instagram.com/fixture.creator/', 18000, 'submitted')`,
      [socialId, creatorId],
    );
    expectOk(
      await harness.run('social.verify', {
        id: socialId,
        followerCount: '18500',
      }),
    );

    const userView = await loadAdminUserView(sql, { role: 'influencer' });
    const verifiedCreator = userView.users.find((u) => u.id === creatorId);
    expect(verifiedCreator).toBeDefined();
    expect(verifiedCreator?.isMaker).toBe(true);
    expect(verifiedCreator?.isInfluencer).toBe(true);
    expect(verifiedCreator?.emailMasked).toBe('c***@example.test');
  });
});
