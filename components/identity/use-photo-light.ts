'use client';
import {useEffect,useState} from 'react';
import {assessPhotoLight,type LightAdvice} from '@/lib/identity/photo-advice';

/**
 * Exposure hint computed on this device from a 64×64 downscale of the chosen file. Nothing leaves
 * the browser and nothing is stored; the result is advice next to the pose check, never a gate.
 */
export function usePhotoLight(file:File|null):LightAdvice|'checking' {
 const [result,setResult]=useState<{file:File;advice:LightAdvice}|null>(null);
 useEffect(()=>{
  if(!file)return;
  let active=true;
  (async()=>{
   try{
    const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'} as ImageBitmapOptions);
    const size=64,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('canvas');
    context.drawImage(bitmap,0,0,size,size);bitmap.close();
    const {data}=context.getImageData(0,0,size,size);
    let sum=0,high=0,low=0;const n=size*size;
    for(let i=0;i<data.length;i+=4){
     const luma=0.2126*data[i]!+0.7152*data[i+1]!+0.0722*data[i+2]!;
     sum+=luma;if(luma>=245)high++;if(luma<=12)low++;
    }
    if(active)setResult({file,advice:assessPhotoLight({mean:sum/n,clippedHigh:high/n,clippedLow:low/n})});
   }catch{if(active)setResult({file,advice:'unavailable'});}
  })();
  return()=>{active=false;};
 },[file]);
 return !file?'unavailable':result?.file===file?result.advice:'checking';
}
