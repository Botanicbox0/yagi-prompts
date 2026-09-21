import type { OpenAiConfig, ReferenceImage } from '@/lib/images/openai';
import { PORTRAIT_MODEL, PORTRAIT_PROMPT, PORTRAIT_SIZE, PORTRAIT_SEEDREAM_MODEL } from './portrait-contract';
import type { SeedreamConfig } from '@/lib/images/seedream';

export class PortraitProviderError extends Error {
  constructor(readonly code: 'provider_access' | 'moderated' | 'provider_failed' | 'uncertain' | 'identity_required') { super(code); }
}
/** Asset registration has not submitted an image generation. Safe to poll registration again. */
export class PortraitReferencePending extends Error {}
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
export interface PortraitProviderContext { userId:string; inputKey:string; attemptId:string }
export interface PortraitProvider { generate(photo: ReferenceImage, context?:PortraitProviderContext): Promise<Uint8Array> }
export function seedreamPortraitBody(reference:string){
  if(!/^asset:\/\/[A-Za-z0-9_-]+$/.test(reference)) throw new PortraitProviderError('identity_required');
  return {model:PORTRAIT_SEEDREAM_MODEL,prompt:PORTRAIT_PROMPT,image:reference,
    size:`${PORTRAIT_SIZE.width}x${PORTRAIT_SIZE.height}`,output_format:'png',response_format:'b64_json',
    watermark:false};
}
export function createSeedreamPortraitProvider(config:SeedreamConfig,reference:(photo:ReferenceImage,context:PortraitProviderContext)=>Promise<string>,fetchImpl:typeof fetch=fetch):PortraitProvider{
 return {async generate(photo,context){
  if(!context)throw new PortraitProviderError('identity_required');
  const asset=await reference(photo,context);
  let response:Response;
  try{response=await fetchImpl(`${config.baseUrl}/images/generations`,{method:'POST',headers:{authorization:`Bearer ${config.apiKey}`,'content-type':'application/json'},body:JSON.stringify(seedreamPortraitBody(asset)),signal:AbortSignal.timeout(240000)});}
  catch{throw new PortraitProviderError('uncertain');}
  if(response.status===401||response.status===403)throw new PortraitProviderError('provider_access');
  if(response.status>=500)throw new PortraitProviderError('uncertain');
  let body:{data?:{b64_json?:string}[];error?:{code?:string}};
  try{body=await response.json();}catch{throw new PortraitProviderError('uncertain');}
  if(!response.ok||body.error)throw new PortraitProviderError(/SensitiveContent|moderation|policy/i.test(body.error?.code??'')?'moderated':'provider_failed');
  const b64=body.data?.[0]?.b64_json;
  if(body.data?.length!==1||typeof b64!=='string'||!b64.length||b64.length>40_000_000||!/^[A-Za-z0-9+/=\s]+$/.test(b64))throw new PortraitProviderError('provider_failed');
  return new Uint8Array(Buffer.from(b64,'base64'));
 }};
}
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
