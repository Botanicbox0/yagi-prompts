import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PORTRAIT_MODEL, PORTRAIT_SIZE, PORTRAIT_FREE_LIMIT, PORTRAIT_PROMPT, PORTRAIT_SEEDREAM_PROMPT } from '@/lib/identity/portrait-contract';
import { createPortraitProvider,createSeedreamPortraitProvider,seedreamPortraitBody, portraitForm, PortraitProviderError } from '@/lib/identity/portrait-provider';

const photo = { bytes: new Uint8Array([1,2,3]), mime: 'image/png' as const };
describe('the fixed identity portrait request', () => {
  it('preserves the founder prompt and bounds two initial candidates plus one retry', () => {
    const source=readFileSync('docs/product/prompts/identity-portrait-v1.md','utf8').split('```text')[1]!.split('```')[0]!.trim();
    expect(PORTRAIT_PROMPT).toBe(source.replace(/\r\n/g,'\n'));
    expect(PORTRAIT_FREE_LIMIT).toBe(3);
  });
  it('sends the original bytes using the documented Seedream image input and 2K portrait size',async()=>{
    const body=seedreamPortraitBody(photo);
    const source=readFileSync('docs/product/prompts/identity-seedream-v1.md','utf8').split('```text')[1]!.split('```')[0]!.trim();
    expect(PORTRAIT_SEEDREAM_PROMPT).toBe(source.replace(/\r\n/g,'\n'));
    expect(PORTRAIT_SEEDREAM_PROMPT).not.toBe(PORTRAIT_PROMPT);
    expect(body).toMatchObject({model:'dola-seedream-5-0-pro-260628',prompt:PORTRAIT_SEEDREAM_PROMPT,image:'data:image/png;base64,AQID',size:'1664x2496'});
    // Live API rejects this field even when set to disabled (2026-09-22).
    expect(body).not.toHaveProperty('sequential_image_generation');
    expect(body).not.toHaveProperty('moderation');
    let calls=0;const provider=createSeedreamPortraitProvider({apiKey:'test-only',baseUrl:'https://example.test'},async()=>{calls++;return new Response('{}',{status:503})});
    await expect(provider.generate(photo,{userId:'user',inputKey:'input',attemptId:'attempt'})).rejects.toMatchObject({code:'uncertain'});
    expect(calls).toBe(1);
  });
  it('uses the same request at the HTTP boundary without requiring Seedance asset credentials',async()=>{
    let sent:Record<string,unknown>|undefined;
    const provider=createSeedreamPortraitProvider({apiKey:'test-only',baseUrl:'https://example.test/v3'},async(url,init)=>{
      expect(url).toBe('https://example.test/v3/images/generations');sent=JSON.parse(String(init?.body));
      return new Response(JSON.stringify({data:[{b64_json:'AQID'}]}));
    });
    expect(await provider.generate(photo)).toEqual(new Uint8Array([1,2,3]));
    expect(sent).toEqual(seedreamPortraitBody(photo));
  });
  it('preserves Seedream moderation rejections without fallback or repeated requests',async()=>{
    let calls=0;
    const provider=createSeedreamPortraitProvider({apiKey:'test-only',baseUrl:'https://example.test'},async()=>{
      calls++;return new Response(JSON.stringify({error:{code:'InputImageSensitiveContentDetected.PrivacyInformation',message:'private detail'}}),{status:400});
    });
    await expect(provider.generate(photo)).rejects.toMatchObject({code:'moderated',message:'moderated'});
    expect(calls).toBe(1);
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
