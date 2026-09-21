import sharp from 'sharp';
import { PORTRAIT_SIZE, PORTRAIT_MODEL, PORTRAIT_SEEDREAM_SIZE, PORTRAIT_SEEDREAM_MODEL } from './portrait-contract';

/** Decode the whole image, reject animated/oversized input, strip EXIF without changing facial shape. */
export async function cleanPortraitInput(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if(!['image/png','image/jpeg','image/webp'].includes(mime) || !bytes.length || bytes.length>3_000_000) throw Error('bad_photo');
  const image=sharp(bytes,{limitInputPixels:36_000_000,failOn:'warning'});
  const meta=await image.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'') || (meta.pages??1)>1 || !meta.width || !meta.height || Math.min(meta.width,meta.height)<256) throw Error('bad_photo');
  return new Uint8Array(await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer());
}
export async function cleanPortraitResult(bytes: Uint8Array, model: string=PORTRAIT_MODEL): Promise<Uint8Array> {
  try {
  if(!bytes.length || bytes.length>30_000_000) throw Error('invalid_result');
  const size=model===PORTRAIT_MODEL?PORTRAIT_SIZE:model===PORTRAIT_SEEDREAM_MODEL?PORTRAIT_SEEDREAM_SIZE:null;
  if(!size)throw Error('invalid_result');
  const image=sharp(bytes,{limitInputPixels:size.width*size.height,failOn:'warning'});
  const meta=await image.metadata();
  if(meta.width!==size.width || meta.height!==size.height || (meta.pages??1)!==1) throw Error('invalid_result');
  return new Uint8Array(await image.removeAlpha().png().toBuffer());
  } catch { throw Error('invalid_result'); }
}
