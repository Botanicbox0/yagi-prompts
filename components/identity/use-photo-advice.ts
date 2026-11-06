'use client';
import {useEffect,useState} from 'react';
import {assessPhotoPose,type PhotoAdvice} from '@/lib/identity/photo-advice';

export function usePhotoAdvice(file:File|null):PhotoAdvice {
 const [result,setResult]=useState<{file:File;advice:PhotoAdvice}|null>(null);
 useEffect(()=>{
  if(!file)return;
  let active=true,worker:Worker|undefined;
  const finish=(advice:PhotoAdvice)=>{if(active)setResult({file,advice});worker?.terminate();clearTimeout(timer);};
  const timer=setTimeout(()=>finish('unavailable'),15_000);
  try{
   // A classic worker keeps synchronous WASM inference off the UI thread.
   worker=new Worker('/workers/photo-advice-v1.js');
   worker.onmessage=event=>{
    const data=event.data;
    finish(data?.ok===true?assessPhotoPose(data.faces,data.matrix,data.size):'unavailable');
   };
   worker.onerror=()=>finish('unavailable');
   worker.postMessage(file);
  }catch{finish('unavailable');}
  // Changing the file or leaving the screen discards the old pixels and result.
  return()=>{active=false;clearTimeout(timer);worker?.terminate();};
 },[file]);
 return !file?'unavailable':result?.file===file?result.advice:'checking';
}
