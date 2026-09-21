import type { OpenAiConfig, ReferenceImage } from '@/lib/images/openai';
import { PORTRAIT_MODEL, PORTRAIT_PROMPT, PORTRAIT_SIZE } from './portrait-contract';

export class PortraitProviderError extends Error {
  constructor(readonly code: 'provider_access' | 'moderated' | 'provider_failed' | 'uncertain') { super(code); }
}
export function portraitForm(photo: ReferenceImage): FormData {
  const form=new FormData();
  form.set('model',PORTRAIT_MODEL);
  form.set('prompt',PORTRAIT_PROMPT);
  form.set('size',`${PORTRAIT_SIZE.width}x${PORTRAIT_SIZE.height}`);
  form.set('quality','max');
  form.set('moderation','auto');
  form.set('output_format','png');
  form.set('n','1');
  form.append('image[]',new Blob([new Uint8Array(photo.bytes)],{type:photo.mime}),'original-selfie');
  return form;
}
export interface PortraitProvider { generate(photo: ReferenceImage): Promise<Uint8Array> }
/** No retry, alternate model, prompt rewrite, response URL fetch or unfiltered provider errors. */
export function createPortraitProvider(config: OpenAiConfig, fetchImpl: typeof fetch=fetch): PortraitProvider {
  return {async generate(photo) {
    let response: Response;
    try {
      response=await fetchImpl(`${config.baseUrl}/images/edits`,{method:'POST',headers:{authorization:`Bearer ${config.apiKey}`},body:portraitForm(photo),signal:AbortSignal.timeout(240000)});
    } catch { throw new PortraitProviderError('uncertain'); }
    if(response.status===401 || response.status===403) throw new PortraitProviderError('provider_access');
    if(response.status>=500) throw new PortraitProviderError('uncertain');
    let body: {data?: {b64_json?: string}[];error?: {code?: string}};
    try {body=await response.json();} catch {throw new PortraitProviderError('uncertain');}
    if(!response.ok || body.error) throw new PortraitProviderError(/moderation|policy/.test(body.error?.code??'')?'moderated':'provider_failed');
    const b64=body.data?.[0]?.b64_json;
    if(typeof b64!=='string' || b64.length===0 || b64.length>40_000_000 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new PortraitProviderError('provider_failed');
    return new Uint8Array(Buffer.from(b64,'base64'));
  }};
}
