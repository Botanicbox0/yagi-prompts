import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));

import { ANON_VIEWER } from '@/lib/auth/identity';
import { openMakerEnabled } from '@/lib/creator-platform/runtime';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { activateOpenMaker, OWL_P_ATTESTATION_VERSION } from '@/lib/makers/self-activate';
import { POST as activatePOST } from '@/app/api/makers/activate/route';
import { OpenMakerCard } from '@/components/creators/open-maker-card';
import { EarningsTable } from '@/components/creators/workspace';
import { MAKER_AV_FILE_MAX_BYTES, MAKER_FILE_MAX_BYTES, sniffMakerFile, storeMakerFile } from '@/lib/recipes/assets';
import { makerAction } from '@/lib/recipes/maker';
import { parseRecipe } from '@/lib/recipes/schema';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ko } from '@/messages/ko';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

describe('Open Maker OWL-P onboarding, audio references & accruing payout UI', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.TWINGS_OPEN_MAKER;
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-open-maker-'));
    store = createLocalRenderStore(root);
    routeMock.sql.mockResolvedValue(h.sql);
  });

  afterEach(async () => {
    delete process.env.TWINGS_OPEN_MAKER;
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('enables Open Maker by default on ready DB and respects TWINGS_OPEN_MAKER=off kill switch', async () => {
    expect(await openMakerEnabled(h.sql)).toBe(true);
    expect(await openMakerEnabled(h.sql, { TWINGS_OPEN_MAKER: 'off' })).toBe(false);
  });

  it('activates any member with 1-click OWL-P attestation, is idempotent, and blocks admin-revoked makers', async () => {
    const member = viewerOf('free');
    await expect(activateOpenMaker(h.sql, ANON_VIEWER, { rightsAgreed: true })).rejects.toThrow('sign_in_required');
    await expect(activateOpenMaker(h.sql, member, { rightsAgreed: false })).rejects.toThrow('rights_required');

    const first = await activateOpenMaker(h.sql, member, { rightsAgreed: true });
    expect(first).toEqual({
      active: true,
      contractVersion: OWL_P_ATTESTATION_VERSION,
      attestationVersion: OWL_P_ATTESTATION_VERSION,
    });

    const second = await activateOpenMaker(h.sql, member, { rightsAgreed: true });
    expect(second.active).toBe(true);

    // Admin revoking the creator prevents silent self-reactivation.
    const contracted = viewerOf('pro');
    await administerPlatform(h.sql, ADMIN_VIEWER, {
      action: 'creator',
      id: contracted.userId,
      active: false,
      contract: 'pilot-v1',
      reason: 'Policy breach test',
    });
    await expect(activateOpenMaker(h.sql, contracted, { rightsAgreed: true })).rejects.toThrow('forbidden');
  });

  it('POST /api/makers/activate rejects unauthenticated or unchecked pledges and stamps DB when agreed', async () => {
    const member = viewerOf('free');
    routeMock.viewer.mockResolvedValue(member);

    const badReq = new Request('http://localhost:3000/api/makers/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ rightsAgreed: false }),
    });
    expect((await activatePOST(badReq)).status).toBe(400);

    const okReq = new Request('http://localhost:3000/api/makers/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ rightsAgreed: true }),
    });
    const res = await activatePOST(okReq);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, active: true, contractVersion: OWL_P_ATTESTATION_VERSION });
  });

  it('sniffs MP3/WAV/M4A audio references up to 25 MiB, records containsPerson, and permits audio slots only in video steps', async () => {
    const member = viewerOf('free');
    await activateOpenMaker(h.sql, member, { rightsAgreed: true });

    const mp3 = new Uint8Array(64);
    mp3.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // ID3...
    const wav = new Uint8Array(64);
    wav.set([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]); // RIFF....WAVE
    const m4a = new Uint8Array(64);
    m4a.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]); // ....ftypM4A 

    expect(sniffMakerFile(mp3)).toBe('audio/mpeg');
    expect(sniffMakerFile(wav)).toBe('audio/wav');
    expect(sniffMakerFile(m4a)).toBe('audio/mp4');

    const formatId = randomUUID();
    const baseRecipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Portrait of {{selfie}} in daylight studio.', params: { aspect: '4:5' } }],
      output: { from: 'step1' },
    };
    await makerAction(
      { sql: h.sql, store },
      member,
      { action: 'save', id: formatId, title: 'Beat Walk', recipe: baseRecipe, example: '', disclosure: { prompts: false, assets: true }, presentation: 'make-first', royalty: 1000 },
      { creators: true },
    );

    const storedAudio = await storeMakerFile(h.sql, store, {
      formatId,
      userId: member.userId!,
      role: 'reference',
      bytes: mp3,
      containsPerson: true,
    });
    expect(storedAudio.ok).toBe(true);
    if (storedAudio.ok) {
      expect(storedAudio.asset).toMatchObject({ kind: 'audio', mime: 'audio/mpeg', containsPerson: true });
      const validVideoRecipe = {
        version: 2,
        slots: {
          selfie: { kind: 'image', source: 'user', required: true },
          bgm: { kind: 'audio', source: 'creator', asset: storedAudio.asset.id },
        },
        steps: [
          {
            id: 'step1',
            kind: 'video',
            engine: 'seedance-2.5',
            inputs: ['selfie', 'bgm'],
            prompt: 'Tracking night walk featuring {{selfie}} timed precisely to {{bgm}} mood.',
            params: { aspect: '9:16', duration: 8, resolution: '720p' },
          },
        ],
        output: { from: 'step1' },
      };
      expect(parseRecipe(validVideoRecipe).ok).toBe(true);

      const invalidImageWithAudio = {
        version: 2,
        slots: validVideoRecipe.slots,
        steps: [
          {
            id: 'step1',
            kind: 'image',
            engine: 'gpt-image-2',
            inputs: ['selfie', 'bgm'],
            prompt: 'Still shot of {{selfie}} with {{bgm}} track.',
            params: { aspect: '4:5' },
          },
        ],
        output: { from: 'step1' },
      };
      expect(parseRecipe(invalidImageWithAudio).ok).toBe(false);
    }

    // Audio over 25 MiB rejected cleanly, unknown bytes > 4 MiB still report too_large
    expect(MAKER_AV_FILE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(
      await storeMakerFile(h.sql, store, { formatId, userId: member.userId!, role: 'reference', bytes: new Uint8Array(MAKER_FILE_MAX_BYTES + 1) }),
    ).toEqual({ ok: false, code: 'too_large' });
  });

  it('renders OpenMakerCard and accruing payout status in Design System v2 without shadow clutter', () => {
    const openHtml = renderToStaticMarkup(createElement(OpenMakerCard, { locale: 'ko' }));
    expect(openHtml).toContain('data-open-maker-activate');
    expect(openHtml).toContain('data-open-maker-pledge');
    expect(openHtml).toContain('#FF58AE');
    expect(openHtml).toContain('text-[#09090B]');

    const earningsHtml = renderToStaticMarkup(createElement(EarningsTable, { earnings: [], dict: ko, locale: 'ko' }));
    expect(earningsHtml).toContain('data-maker-payout-status="accruing"');
    expect(earningsHtml).toContain('예상 수익 적립 (출금 준비 중)');
  });
});
