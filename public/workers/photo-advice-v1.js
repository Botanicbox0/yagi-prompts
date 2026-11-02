/* TWINGS photo quality hint: local pixels only; never send or store face landmarks. */
'use strict';
// The upstream SDK includes usage telemetry. This worker may only GET its own
// pinned assets; no metrics, pixels or landmarks may leave through fetch.
const assetFetch=self.fetch.bind(self);
const assetPaths=new Set(['/models/face-landmarker-float16-v1.task','/vendor/face-1.1.0/wasm/vision_wasm_internal.wasm','/vendor/face-1.1.0/wasm/vision_wasm_nosimd_internal.wasm']);
self.fetch=(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input),self.location.href);
 const method=init?.method??(input instanceof Request?input.method:'GET');
 if(url.origin!==self.location.origin||!assetPaths.has(url.pathname)||url.search||method.toUpperCase()!=='GET')return Promise.reject(new TypeError('Photo analysis network restricted'));
 return assetFetch(input,{...init,credentials:'omit',redirect:'error'});
};
self.onmessage=async({data:file})=>{
 let image,detector;
 try{
  importScripts('/vendor/face-1.1.0/vision_bundle.js');
  image=await createImageBitmap(file);
  const scale=Math.min(1,1024/Math.max(image.width,image.height));
  const canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  image.close();image=null;
  const files=await Vision.FilesetResolver.forVisionTasks('/vendor/face-1.1.0/wasm');
  detector=await Vision.FaceLandmarker.createFromOptions(files,{
   baseOptions:{modelAssetPath:'/models/face-landmarker-float16-v1.task',delegate:'CPU'},
   runningMode:'IMAGE',numFaces:2,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:true,
  });
  const result=detector.detect(canvas);
  self.postMessage({ok:true,faces:result.faceLandmarks.length,matrix:result.facialTransformationMatrixes[0]?.data});
 }catch{
  self.postMessage({ok:false});
 }finally{image?.close();detector?.close();self.close();}
};
