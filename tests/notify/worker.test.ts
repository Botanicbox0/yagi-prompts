import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { runNotifyPass, type NotifyWorkerOptions } from '@/lib/notify/worker';
import { adminHarness, expectOk, type AdminHarness } from '../helpers/admin';
import { createDraft } from '../helpers/factory';
import { runner } from '../helpers/pglite';
import { ageClaim, deliveries, jobs, seedRecipient } from '../helpers/notify';

/**
 * PLAN §8 M5 acceptance, in full:
 *
 *   "publish → exactly one delivery per opted-in Pro user; job re-run + worker re-claim = zero
 *    duplicate sends; recovery sweep re-queues abandoned leases"
 *
 * Everything runs against real PGlite through the real admin publish path — no test enqueues a job
 * by hand, so the RPC, the flag and the kind derivation are all in the loop.
 *
 * §11 execution note: PGlite is single-connection, so real concurrency cannot be staged. The
 * claim/lease semantics are therefore exercised LOGICALLY — two sequential claimers over the same
 * queue, and an expired lease returning to the pool — which is what the `SKIP LOCKED` batch
 * discipline actually has to guarantee. The SQL itself carries `FOR UPDATE ... SKIP LOCKED` and is
 * parsed and executed here, so the statement that will meet real concurrency is the tested one.
 */

const SITE = 'https://playbook.test';

describe('notification worker (§3.5)', () => {
  let harness: AdminHarness;
  let mailer: FakeMailer;

  beforeEach(async () => {
    harness = await adminHarness();
    mailer = createFakeMailer();
  });

  afterEach(async () => {
    await harness.close();
  });

  function pass(overrides: Partial<NotifyWorkerOptions> = {}) {
    return runNotifyPass({ sql: runner(harness.db), mailer, siteUrl: SITE, ...overrides });
  }

  /** Publish a fresh playbook through the admin operation, with the notify checkbox ticked. */
  async function publishWithNotify(slug = 'worker-fixture') {
    const draft = await createDraft(harness.db, harness.storage, {
      slug,
      isShowcase: true,
      blocks: [{ kind: 'prompt', content: { text: 'gated prompt' } }],
    });
    expectOk(
      await harness.run('revision.publish', {
        playbookId: draft.playbookId,
        revisionId: draft.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );
    return draft;
  }

  // -------------------------------------------------------------------------
  // expansion
  // -------------------------------------------------------------------------

  it('expands a job into exactly one delivery per opted-in Pro user', async () => {
    const wanted = await seedRecipient(harness.db, { email: 'wants@x.test', notifNew: true });
    const alsoWanted = await seedRecipient(harness.db, {
      email: 'wants-ko@x.test',
      locale: 'ko',
      notifNew: true,
    });
    // Every reason NOT to be in the set, one each.
    await seedRecipient(harness.db, { email: 'optedout@x.test', notifNew: false });
    await seedRecipient(harness.db, { email: 'free@x.test', entitled: false, notifNew: true });
    await seedRecipient(harness.db, {
      email: 'lapsed@x.test',
      status: 'canceled',
      notifNew: true,
    });
    // Opted in to the OTHER toggle only.
    await seedRecipient(harness.db, { email: 'updates-only@x.test', notifUpdates: true });

    await publishWithNotify();
    const report = await pass();

    expect(report.expanded).toBe(2);
    expect(report.sent).toBe(2);
    const rows = await deliveries(harness.db);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.user_id))).toEqual(new Set([wanted, alsoWanted]));
    expect(rows.every((row) => row.status === 'sent')).toBe(true);
  });

  it('is exactly-once at the database after a double run', async () => {
    await seedRecipient(harness.db, { email: 'once@x.test', notifNew: true });
    await publishWithNotify();

    const first = await pass();
    expect(first.expanded).toBe(1);
    expect(first.sent).toBe(1);

    const second = await pass();
    // The acceptance criterion, both halves: no new rows AND no new mail.
    expect(second.expanded).toBe(0);
    expect(second.claimed).toBe(0);
    expect(second.sent).toBe(0);

    const rows = await deliveries(harness.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.attempts).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.duplicateKeys()).toEqual([]);
  });

  it('stamps the provider idempotency key as job_id:user_id', async () => {
    const user = await seedRecipient(harness.db, { email: 'key@x.test', notifNew: true });
    await publishWithNotify();
    await pass();

    const [job] = await jobs(harness.db);
    expect(mailer.idempotencyKeys()).toEqual([`${job!.id}:${user}`]);
    // The one-click header the live mailer promotes to List-Unsubscribe.
    expect(mailer.sent[0]!.unsubscribeUrl).toContain(`${SITE}/api/notify/unsubscribe?t=`);
  });

  // -------------------------------------------------------------------------
  // claim-time re-checks (§3.5 "Preference AND Pro entitlement are checked at claim time")
  // -------------------------------------------------------------------------

  it('refuses to claim a delivery whose owner unsubscribed after expansion', async () => {
    const user = await seedRecipient(harness.db, { email: 'flips@x.test', notifNew: true });
    await publishWithNotify();

    // Expand only: a batch of zero leaves the rows pending without sending them.
    const expandOnly = await pass({ batchSize: 0 });
    expect(expandOnly.expanded).toBe(1);
    expect(expandOnly.claimed).toBe(0);

    await harness.db.query('update profiles set notif_new_playbook = false where id = $1', [user]);

    const second = await pass();
    expect(second.claimed).toBe(0);
    expect(second.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect((await deliveries(harness.db))[0]!.status).toBe('pending');
  });

  it('refuses to claim a delivery whose owner lost entitlement after expansion', async () => {
    const user = await seedRecipient(harness.db, { email: 'lapses@x.test', notifNew: true });
    await publishWithNotify();

    expect((await pass({ batchSize: 0 })).expanded).toBe(1);
    await harness.db.query(`update subscriptions set status = 'canceled' where user_id = $1`, [
      user,
    ]);

    const second = await pass();
    expect(second.claimed).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect((await deliveries(harness.db))[0]!.status).toBe('pending');
  });

  // -------------------------------------------------------------------------
  // attempts + backoff
  // -------------------------------------------------------------------------

  it('spends one attempt per claim, backs off, and gives up after three', async () => {
    const user = await seedRecipient(harness.db, { email: 'flaky@x.test', notifNew: true });
    await publishWithNotify();

    mailer.failNext({ retryable: true, error: 'provider 503' });
    const first = await pass();
    expect(first.deferred).toBe(1);
    let row = (await deliveries(harness.db))[0]!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);

    // Immediately again: the backoff window (5 minutes after one failure) is closed.
    const tooSoon = await pass();
    expect(tooSoon.claimed).toBe(0);

    await ageClaim(harness.db, user, 6);
    mailer.failNext({ retryable: true, error: 'provider 503' });
    const second = await pass();
    expect(second.deferred).toBe(1);
    expect((await deliveries(harness.db))[0]!.attempts).toBe(2);

    // Second backoff is 20 minutes.
    expect((await pass()).claimed).toBe(0);
    await ageClaim(harness.db, user, 21);
    mailer.failNext({ retryable: true, error: 'provider 503' });
    const third = await pass();
    expect(third.failed).toBe(1);

    row = (await deliveries(harness.db))[0]!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);

    // Budget spent: nothing claims it again, however long we wait.
    await ageClaim(harness.db, user, 500);
    expect((await pass()).claimed).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('burns a permanently rejected message immediately rather than retrying it', async () => {
    await seedRecipient(harness.db, { email: 'bad-address@x.test', notifNew: true });
    await publishWithNotify();

    mailer.failNext({ retryable: false, error: 'validation_error: invalid to address' });
    const report = await pass();

    expect(report.failed).toBe(1);
    expect(report.deferred).toBe(0);
    const row = (await deliveries(harness.db))[0]!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
  });

  // -------------------------------------------------------------------------
  // lease recovery
  // -------------------------------------------------------------------------

  it('re-queues a lease abandoned mid-send, and gives up once the budget is spent', async () => {
    const user = await seedRecipient(harness.db, { email: 'abandoned@x.test', notifNew: true });
    await publishWithNotify();
    await pass({ batchSize: 0 });

    // Exactly the state a worker killed between claim and mark leaves behind.
    await harness.db.query(
      `update notification_deliveries
          set status = 'sending', attempts = 1, claimed_at = now() - interval '11 minutes'
        where user_id = $1`,
      [user],
    );

    const recovered = await pass({ batchSize: 0 });
    expect(recovered.recovered).toBe(1);
    expect(recovered.abandoned).toBe(0);
    expect((await deliveries(harness.db))[0]!.status).toBe('pending');

    // A lease still inside its 10 minutes is left alone — that worker may well be alive.
    await harness.db.query(
      `update notification_deliveries
          set status = 'sending', claimed_at = now() - interval '2 minutes'
        where user_id = $1`,
      [user],
    );
    expect((await pass({ batchSize: 0 })).recovered).toBe(0);
    expect((await deliveries(harness.db))[0]!.status).toBe('sending');

    // Abandoned with the budget already spent: terminal, not an infinite loop.
    await harness.db.query(
      `update notification_deliveries
          set status = 'sending', attempts = 3, claimed_at = now() - interval '11 minutes'
        where user_id = $1`,
      [user],
    );
    const gaveUp = await pass({ batchSize: 0 });
    expect(gaveUp.abandoned).toBe(1);
    expect((await deliveries(harness.db))[0]!.status).toBe('failed');
  });

  // -------------------------------------------------------------------------
  // batching + two sequential claimers
  // -------------------------------------------------------------------------

  it('hands disjoint batches to two claimers over the same queue', async () => {
    for (const n of [1, 2, 3, 4]) {
      await seedRecipient(harness.db, { email: `batch-${n}@x.test`, notifNew: true });
    }
    await publishWithNotify();

    const first = await pass({ batchSize: 2 });
    expect(first.claimed).toBe(2);
    expect(first.sent).toBe(2);

    const second = await pass({ batchSize: 2 });
    expect(second.expanded).toBe(0);
    expect(second.claimed).toBe(2);
    expect(second.sent).toBe(2);

    expect((await pass()).claimed).toBe(0);
    expect(mailer.sent).toHaveLength(4);
    expect(mailer.duplicateKeys()).toEqual([]);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(4);
  });

  // -------------------------------------------------------------------------
  // degradation
  // -------------------------------------------------------------------------

  it('changes nothing at all when no mailer is configured (§11)', async () => {
    await seedRecipient(harness.db, { email: 'nomailer@x.test', notifNew: true });
    await publishWithNotify();

    const report = await runNotifyPass({ sql: runner(harness.db), mailer: null, siteUrl: SITE });
    expect(report.mailer).toBe('unconfigured');
    expect(report.expanded).toBe(0);
    expect(report.claimed).toBe(0);
    expect(await deliveries(harness.db)).toHaveLength(0);
  });

  it('never claims a delivery whose job has gone stale', async () => {
    await seedRecipient(harness.db, { email: 'stale@x.test', notifNew: true });
    await publishWithNotify();
    await pass({ batchSize: 0 });

    await harness.db.query(
      `update notification_jobs set created_at = now() - interval '30 days'`,
    );
    const report = await pass();
    expect(report.claimed).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});
