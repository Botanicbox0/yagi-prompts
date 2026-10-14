import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {assessPhotoPose,canSubmitPortrait} from '@/lib/identity/photo-advice';
import {bypassConsumerLocale,brandRouteAllowed,adminRouteAllowed} from '@/lib/routing/surfaces';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
describe('advisory selfie assessment',()=>{
 it('blocks SDK telemetry and all upload requests before they reach the network',async()=>{
  const network=vi.fn(async()=>new Response('asset'));
  const self:{fetch:typeof fetch;location:{href:string;origin:string};onmessage?:unknown}={fetch:network,location:{href:'https://twings.app/workers/photo-advice-v1.js',origin:'https://twings.app'}};
  runInNewContext(readFileSync('public/workers/photo-advice-v1.js','utf8'),{self,URL,Request,TypeError,Promise,Set});
  await expect(self.fetch('https://odml.pa.googleapis.com/v1/log',{method:'POST'})).rejects.toThrow('network restricted');
  await expect(self.fetch('/api/upload',{method:'POST'})).rejects.toThrow('network restricted');
  await expect(self.fetch('/models/face-landmarker-float16-v1.task',{method:'POST'})).rejects.toThrow('network restricted');
  await expect(self.fetch('/models/face-landmarker-float16-v1.task?metrics=1')).rejects.toThrow('network restricted');
  expect(network).not.toHaveBeenCalled();
  await self.fetch('/models/face-landmarker-float16-v1.task');
  expect(network).toHaveBeenCalledOnce();
  expect(network).toHaveBeenCalledWith('/models/face-landmarker-float16-v1.task',{credentials:'omit',redirect:'error'});
 });
 it('serves pinned analysis assets without locale redirects or opening workspace hosts',()=>{
  for(const path of ['/workers/photo-advice-v1.js','/models/face-landmarker-float16-v1.task','/vendor/face-1.1.0/vision_bundle.js','/vendor/face-1.1.0/wasm/vision_wasm_internal.wasm']){
   expect(bypassConsumerLocale(path)).toBe(true);
   expect(brandRouteAllowed(path,'GET')).toBe(false);
   expect(adminRouteAllowed(path,'GET')).toBe(false);
  }
  expect(bypassConsumerLocale('/vendor/private.js')).toBe(false);
 });
 it('distinguishes one straight face, no face and multiple faces',()=>{
  expect(assessPhotoPose(1,identity)).toBe('ready');
  expect(assessPhotoPose(0)).toBe('noFace');
  expect(assessPhotoPose(2,identity)).toBe('multipleFaces');
 });
 it('warns for side angles, pitch and roll without approving identity',()=>{
  const yaw=[...identity];yaw[8]=0.5;yaw[10]=Math.sqrt(0.75);
  const pitch=[...identity];pitch[9]=0.5;pitch[10]=Math.sqrt(0.75);
  const roll=[...identity];roll[1]=0.5;roll[0]=Math.sqrt(0.75);
  for(const matrix of [yaw,pitch,roll])expect(assessPhotoPose(1,matrix)).toBe('angle');
 });
 it('treats missing, invalid and degenerate output as unavailable',()=>{
  for(const matrix of [undefined,[],[NaN],new Array(16).fill(0)])expect(assessPhotoPose(1,matrix)).toBe('unavailable');
 });
 it('every assessment including pending is advisory; consent and file stay required',()=>{
  for(const advice of ['checking','ready','angle','noFace','multipleFaces','unavailable'] as const){
   expect(canSubmitPortrait({hasFile:true,consent:true,busy:false,advice})).toBe(true);
   expect(canSubmitPortrait({hasFile:true,consent:false,busy:false,advice})).toBe(false);
   expect(canSubmitPortrait({hasFile:false,consent:true,busy:false,advice})).toBe(false);
   expect(canSubmitPortrait({hasFile:true,consent:true,busy:true,advice})).toBe(false);
  }
 });
});
