import { describe, expect, it } from 'vitest';
import { checkPartnerPhoto, partnerRefusal } from '@/lib/renders/partner-photo-check';

/**
 * docs/PERSONAL-STUDIO.md §6.2 — the partner photo is stored only on a positive answer to four questions:
 * one person, one clear face, not likely a minor, not a photo of a screen or a print. Anything else — a
 * refusal, no key, an HTTP error, a malformed or extra field, a timeout — refuses (fail-closed). The check
 * never identifies anyone: the request says so and asks for nothing beyond the four fields. Gemini is
 * faked at its HTTP seam; nothing is sent anywhere.
 */
const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]), mime: 'image/jpeg' };
const ENV = { GEMINI_API_KEY: 'test-key' };
const PASS = { people: 1, face_clear: true, minor_likely: false, recapture: false };

function gemini(answer: unknown, status = 200): { fetch: typeof fetch; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (status !== 200) return new Response('no', { status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fake, calls };
}

describe('the partner photo check', () => {
  it('accepts one clear adult face that is not a recapture, sending the photo inline', async () => {
    const g = gemini(PASS);
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: g.fetch })).toEqual({ ok: true });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.url).toContain(':generateContent');
    expect(g.calls[0]!.body.contents[0].parts[0].inlineData).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('refuses each failing answer with its own reason', async () => {
    const check = (answer: Record<string, unknown>) => checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini({ ...PASS, ...answer }).fetch });
    expect(await check({ people: 0 })).toEqual({ ok: false, reason: 'not_one_person' });
    expect(await check({ people: 2 })).toEqual({ ok: false, reason: 'not_one_person' });
    expect(await check({ recapture: true })).toEqual({ ok: false, reason: 'screen' });
    expect(await check({ minor_likely: true })).toEqual({ ok: false, reason: 'minor' });
    expect(await check({ face_clear: false })).toEqual({ ok: false, reason: 'unclear' });
  });

  it('fails closed: no key, an HTTP error, a malformed answer, an extra field, a timeout', async () => {
    expect(await checkPartnerPhoto(PHOTO, { env: {}, fetch: gemini(PASS).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini(null, 500).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini('not json').fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini({ ...PASS, people: 'one' }).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini({ ...PASS, people: 1.5 }).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    // An answer that names or describes the person is not accepted, even when the four fields pass.
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: gemini({ ...PASS, name: 'someone' }).fetch })).toEqual({ ok: false, reason: 'unchecked' });
    const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    expect(await checkPartnerPhoto(PHOTO, { env: ENV, fetch: hang, timeoutMs: 20 })).toEqual({ ok: false, reason: 'unchecked' });
  });

  it('never asks who the person is: the instruction forbids it and the answer schema holds only the four fields', async () => {
    const g = gemini(PASS);
    await checkPartnerPhoto(PHOTO, { env: ENV, fetch: g.fetch });
    const body = g.calls[0]!.body;
    const instruction: string = body.systemInstruction.parts.map((part: { text: string }) => part.text).join('\n');
    expect(instruction).toMatch(/do not identify/i);
    expect(instruction).toMatch(/never return any other field/i);
    const schema = body.generationConfig.responseJsonSchema;
    expect(Object.keys(schema.properties).sort()).toEqual(['face_clear', 'minor_likely', 'people', 'recapture']);
    expect(schema.additionalProperties).toBe(false);
    // Nothing in the request asks for a name, identity, age, gender, ethnicity or a description.
    const userText: string = body.contents[0].parts.filter((part: { text?: string }) => part.text).map((part: { text: string }) => part.text).join('\n');
    const asked = `${JSON.stringify(schema)}\n${userText}`;
    expect(asked).not.toMatch(/\b(name|identity|identify|who|gender|ethnic|race|describe|description|age)\b/i);
    // The only text part sent beside the photo is a one-line request.
    expect(userText).toBe('Check this photo.');
  });

  it('maps verdicts to the refusal codes the routes answer with', () => {
    expect(partnerRefusal({ ok: true })).toBeNull();
    expect(partnerRefusal({ ok: false, reason: 'not_one_person' })).toBe('partner_not_one_person');
    expect(partnerRefusal({ ok: false, reason: 'unclear' })).toBe('partner_unclear');
    expect(partnerRefusal({ ok: false, reason: 'minor' })).toBe('partner_minor');
    expect(partnerRefusal({ ok: false, reason: 'screen' })).toBe('partner_screen');
    expect(partnerRefusal({ ok: false, reason: 'unchecked' })).toBe('partner_check_unavailable');
  });
});
