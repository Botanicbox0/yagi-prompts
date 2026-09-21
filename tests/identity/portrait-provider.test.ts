import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PORTRAIT_MODEL, PORTRAIT_SIZE, PORTRAIT_FREE_LIMIT, PORTRAIT_PROMPT } from '@/lib/identity/portrait-contract';
import { createPortraitProvider, portraitForm, PortraitProviderError } from '@/lib/identity/portrait-provider';

const photo = { bytes: new Uint8Array([1,2,3]), mime: 'image/png' as const };
describe('the fixed identity portrait request', () => {
  it('preserves the founder prompt without template substitutions and includes the first generation in two', () => {
    const source=readFileSync('docs/product/prompts/identity-portrait-v1.md','utf8').split('```text')[1]!.split('```')[0]!.trim();
    expect(PORTRAIT_PROMPT).toBe(source.replace(/\r\n/g,'\n'));
    expect(PORTRAIT_FREE_LIMIT).toBe(2);
  });
  it('sends exactly one original reference to Sunburst at exact 2:3 size, with moderation', () => {
    const form=portraitForm(photo);
    expect(form.get('model')).toBe('gpt-image-2.5-sunburst');
    expect(form.get('size')).toBe('1344x2016');
    expect(form.get('quality')).toBe('max');
    expect(form.get('moderation')).toBe('auto');
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(PORTRAIT_SIZE.width/PORTRAIT_SIZE.height).toBe(2/3);
  });
  it('never falls back on model rejection or leaks provider details', async () => {
    let calls=0;
    const provider=createPortraitProvider({apiKey:'test-only',baseUrl:'https://example.test/v1'},async()=>{calls++;return new Response(JSON.stringify({error:{message:'private provider detail'}}),{status:403});});
    await expect(provider.generate(photo)).rejects.toMatchObject({code:'provider_access',message:'provider_access'});
    expect(calls).toBe(1);
    expect(PORTRAIT_MODEL).toBe('gpt-image-2.5-sunburst');
  });
  it('marks timeouts and server errors uncertain, rather than automatically retrying a billed request', async () => {
    const provider=createPortraitProvider({apiKey:'test-only',baseUrl:'https://example.test/v1'},async()=>{throw new Error('network error')});
    await expect(provider.generate(photo)).rejects.toEqual(expect.objectContaining({code:'uncertain'}));
    expect(new PortraitProviderError('uncertain').message).toBe('uncertain');
  });
});
