import { describe, expect, it } from 'vitest';
import { checkPetPhoto, petRefusal } from '@/lib/renders/pet-photo-check';

/**
 * docs/CAST-CATEGORIES.md §3 — a pet photo skips every face rule, so it is stored only on a positive
 * "a pet, no person" answer. Everything else — a person, no animal, no key, an error, a bad answer, a
 * timeout — refuses (fail-closed). Gemini is faked at its HTTP seam; nothing is sent anywhere.
 */
const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]), mime: 'image/jpeg' };
const ENV = { GEMINI_API_KEY: 'test-key' };

function gemini(answer: unknown, status = 200): { fetch: typeof fetch; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (status !== 200) return new Response('no', { status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fake, calls };
}

describe('the pet photo check', () => {
  it('accepts a pet with no person, sending the photo to Gemini 4 Hydrogen', async () => {
    const g = gemini({ person: false, animal: true });
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: g.fetch })).toEqual({ ok: true });
    expect(g.calls[0]!.url).toContain('/models/gemini-4-hydrogen:generateContent');
    expect(g.calls[0]!.body.contents[0].parts[0].inlineData).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('refuses a person anywhere in the picture, even with a pet', async () => {
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: gemini({ person: true, animal: true }).fetch })).toEqual({ ok: false, reason: 'person' });
  });

  it('refuses a photo with no animal', async () => {
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: gemini({ person: false, animal: false }).fetch })).toEqual({ ok: false, reason: 'no_animal' });
  });

  it('fails closed: no key, an HTTP error, a malformed answer, a timeout', async () => {
    expect(await checkPetPhoto(PHOTO, { env: {}, fetch: gemini({ person: false, animal: true }).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: gemini(null, 500).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: gemini('not json').fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: gemini({ person: 'no', animal: true }).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    expect(await checkPetPhoto(PHOTO, { env: ENV, fetch: hang, timeoutMs: 20 })).toEqual({ ok: false, reason: 'unchecked' });
  });

  it('maps verdicts to the two refusal codes', () => {
    expect(petRefusal({ ok: true })).toBeNull();
    expect(petRefusal({ ok: false, reason: 'person' })).toBe('not_a_pet');
    expect(petRefusal({ ok: false, reason: 'no_animal' })).toBe('not_a_pet');
    expect(petRefusal({ ok: false, reason: 'unchecked' })).toBe('pet_check_unavailable');
  });
});
